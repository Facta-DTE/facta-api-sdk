import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createSupabaseArtifactDestination } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const status = readLocalSupabaseStatus();
const apiUrl = new URL(status.API_URL);
if (
  apiUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "::1", "[::1]"].includes(apiUrl.hostname)
) {
  throw new Error(
    "Refusing to run: Supabase CLI did not report an HTTP loopback API URL.",
  );
}
if (typeof status.SERVICE_ROLE_KEY !== "string" || !status.SERVICE_ROLE_KEY) {
  throw new Error("Supabase CLI did not report its local service role key.");
}

const serviceKey = status.SERVICE_ROLE_KEY;
const bucket = `facta-sdk-test-${randomUUID()}`;
const artifactPath = `sdk-test/${randomUUID()}/invoice.json`;
const originalBytes = new TextEncoder().encode(
  '{"test":"local Supabase Storage round trip"}',
);
const conflictingBytes = new TextEncoder().encode(
  '{"test":"must not replace the stored object"}',
);
const artifact = {
  codigoGeneracion: randomUUID().toUpperCase(),
  kind: "json",
  filename: "invoice.json",
  contentType: "application/json",
  bytes: originalBytes,
  sha256: await sha256(originalBytes),
};

let bucketCreated = false;
let testError;
try {
  // If the request fails after the server creates the bucket, still attempt
  // to remove the unique name during cleanup. A definite client-side conflict
  // means the name belongs to an existing bucket, so never delete it.
  bucketCreated = true;
  const createResponse = await storageRequest("/bucket", {
    method: "POST",
    body: JSON.stringify({ id: bucket, name: bucket, public: false }),
  });
  if (!createResponse.ok && createResponse.status < 500) bucketCreated = false;
  assertSuccessful(createResponse, "create temporary bucket");
  await createResponse.body?.cancel().catch(() => undefined);

  const destination = createSupabaseArtifactDestination({
    id: "local-supabase-storage-check",
    label: "Temporary local Supabase bucket",
    config: {
      url: status.API_URL,
      serviceKey,
      bucket,
      allowInsecureLocalhost: true,
    },
    pathForArtifact: () => artifactPath,
  });

  assertEqual(await destination.write(artifact), "stored", "initial write");
  assertEqual(await destination.check(artifact), "stored", "read-back");
  assertEqual(await destination.write(artifact), "stored", "idempotent retry");
  assertEqual(
    await destination.write({
      ...artifact,
      bytes: conflictingBytes,
      sha256: await sha256(conflictingBytes),
    }),
    "unknown",
    "mismatched retry",
  );

  const storedResponse = await storageRequest(
    `/object/${encodeURIComponent(bucket)}/${encodeObjectPath(artifactPath)}`,
  );
  assertSuccessful(storedResponse, "read stored object after conflict");
  const storedBytes = new Uint8Array(await storedResponse.arrayBuffer());
  assertEqual(
    await sha256(storedBytes),
    artifact.sha256,
    "preserved object hash",
  );
  console.log(
    "Local Supabase Storage passed: exact write/read bytes, idempotent retry, and mismatched-write preservation.",
  );
} catch (error) {
  testError = error;
} finally {
  if (bucketCreated) {
    try {
      const deleteObject = await storageRequest(
        `/object/${encodeURIComponent(bucket)}/${
          encodeObjectPath(artifactPath)
        }`,
        { method: "DELETE" },
      );
      if (
        !deleteObject.ok && deleteObject.status !== 404 &&
        !(await isMissingObject(deleteObject))
      ) {
        throw new Error(
          `delete test object returned HTTP ${deleteObject.status}`,
        );
      }
      await deleteObject.body?.cancel().catch(() => undefined);
      const deleteBucket = await storageRequest(
        `/bucket/${encodeURIComponent(bucket)}`,
        { method: "DELETE" },
      );
      if (!deleteBucket.ok && deleteBucket.status !== 404) {
        throw new Error(
          `delete temporary bucket returned HTTP ${deleteBucket.status}`,
        );
      }
      await deleteBucket.body?.cancel().catch(() => undefined);
      console.log("Temporary bucket and test object removed.");
    } catch (error) {
      testError ??= error;
    }
  }
}

if (testError) {
  console.error(
    testError instanceof Error ? testError.message : "Storage check failed.",
  );
  process.exitCode = 1;
}

function readLocalSupabaseStatus() {
  try {
    const output = execFileSync(
      "pnpm",
      ["exec", "supabase", "status", "--workdir", repositoryRoot, "-o", "json"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return JSON.parse(output);
  } catch {
    throw new Error(
      "Could not read local Supabase status. Start the local stack, then retry.",
    );
  }
}

async function storageRequest(path, init = {}) {
  const base = new URL(status.API_URL);
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/storage/v1${path}`;
  const headers = new Headers(init.headers);
  headers.set("apikey", serviceKey);
  headers.set("authorization", `Bearer ${serviceKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return await fetch(base, { ...init, headers });
}

function assertSuccessful(response, action) {
  if (!response.ok) {
    throw new Error(`${action} returned HTTP ${response.status}.`);
  }
}

function assertEqual(actual, expected, action) {
  if (actual !== expected) {
    throw new Error(
      `${action} failed: expected ${expected}, received ${actual}.`,
    );
  }
}

function encodeObjectPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function isMissingObject(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const payload = await response.clone().json();
    return payload.statusCode === "404" &&
      (payload.error === "not_found" || payload.code === "NoSuchKey");
  } catch {
    return false;
  }
}

async function sha256(bytes) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
