import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createS3ArtifactDestination } from "../dist/index.js";

const execFileAsync = promisify(execFile);
const image = process.env.FACTA_TEST_S3_IMAGE ?? "chrislusf/seaweedfs:latest";
const containerName = `facta-sdk-s3-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(join(tmpdir(), "facta-sdk-s3-"));
const accessKeyId = randomBytes(16).toString("hex").toUpperCase();
const secretAccessKey = randomBytes(32).toString("base64");
const configPath = join(directory, "s3.json");
const bucket = `facta-sdk-${randomUUID().replaceAll("-", "")}`;
const objectPath = `sdk-test/${randomUUID()}/invoice.json`;
let containerStarted = false;
let failure;

const identityConfig = {
  identities: [{
    name: "facta-sdk-local-test",
    credentials: [{ accessKey: accessKeyId, secretKey: secretAccessKey }],
    actions: ["Admin", "Read", "List", "Tagging", "Write"],
  }],
};

try {
  await writeFile(configPath, JSON.stringify(identityConfig), { mode: 0o600 });
  await execFileAsync("docker", ["info"], { timeout: 10_000 });
  await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::8333",
    "--mount",
    `type=bind,source=${configPath},target=/etc/seaweedfs/s3.json,readonly`,
    image,
    "server",
    "-s3",
    "-s3.port=8333",
    "-s3.config=/etc/seaweedfs/s3.json",
    "-s3.autoCreateBucket=true",
    "-dir=/data",
    "-ip=0.0.0.0",
  ], { timeout: 120_000 });
  containerStarted = true;

  const { stdout: mapping } = await execFileAsync("docker", [
    "port",
    containerName,
    "8333/tcp",
  ], { timeout: 10_000 });
  const port = /127\.0\.0\.1:(\d+)/.exec(mapping)?.[1];
  if (!port) throw new Error("The temporary S3 service did not publish a loopback port.");
  const endpoint = `http://127.0.0.1:${port}`;
  if (await waitForS3(endpoint) !== 403) {
    throw new Error("The temporary S3 service did not enforce its configured credentials.");
  }

  const bytes = new TextEncoder().encode('{"test":"authenticated S3 round trip"}');
  const changedBytes = new TextEncoder().encode('{"test":"must not replace stored bytes"}');
  const artifact = {
    codigoGeneracion: randomUUID().toUpperCase(),
    kind: "json",
    filename: "invoice.json",
    contentType: "application/json",
    bytes,
    sha256: await sha256(bytes),
  };
  const destination = createS3ArtifactDestination({
    id: "local-seaweedfs-authenticated-s3",
    label: "Temporary authenticated S3 service",
    config: {
      bucket,
      region: "us-east-1",
      accessKeyId,
      secretAccessKey,
      endpoint,
      pathStyle: true,
      allowInsecureEndpoint: true,
    },
    pathForArtifact: () => objectPath,
  });

  const firstWrite = await destination.write(artifact);
  const readBack = await destination.check(artifact);
  const repeatedWrite = await destination.write(artifact);
  const conflict = await destination.write({
    ...artifact,
    bytes: changedBytes,
    sha256: await sha256(changedBytes),
  });
  const preserved = await destination.check(artifact);
  if (
    firstWrite !== "stored" || readBack !== "stored" ||
    repeatedWrite !== "stored" || conflict !== "unknown" ||
    preserved !== "stored"
  ) {
    throw new Error(
      `Unexpected local S3 outcomes: ${firstWrite}, ${readBack}, ${repeatedWrite}, ${conflict}, ${preserved}.`,
    );
  }

  console.log(
    "Authenticated local S3 passed: SigV4 write/read, idempotent retry, and mismatched-write preservation.",
  );
} catch (cause) {
  failure = cause instanceof Error
    ? new Error(`Local S3 integration check failed: ${cause.message}`)
    : new Error("Local S3 integration check failed.");
} finally {
  if (containerStarted) {
    try {
      await execFileAsync("docker", ["stop", containerName], { timeout: 30_000 });
    } catch {
      failure ??= new Error("The temporary S3 container could not be stopped.");
    }
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    failure ??= new Error("The temporary S3 credentials could not be removed.");
  }
}

if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}

async function waitForS3(endpoint) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 200 || response.status === 403) return response.status;
    } catch {
      // The container may need a few seconds to start its S3 gateway.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The temporary S3 service did not become ready within 20 seconds.");
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
