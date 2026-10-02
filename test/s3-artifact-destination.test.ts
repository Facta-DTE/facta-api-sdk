import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { createS3ArtifactDestination } from "../src/s3-artifact-destination.ts";
import { signS3Request } from "../src/s3-artifact-destination.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const bytes = new TextEncoder().encode("signed DTE bytes");

async function sha256(value: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        value.slice().buffer as ArrayBuffer,
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function artifact(): Promise<ArchiveArtifact> {
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "json",
    filename: "invoice.json",
    contentType: "application/json",
    bytes,
    sha256: await sha256(bytes),
  };
}

const config = {
  bucket: "private-dtes",
  region: "auto",
  accessKeyId: "facta-test-key",
  secretAccessKey: "facta-test-secret-key-123456",
  endpoint: "http://127.0.0.1:9100",
  allowInsecureEndpoint: true,
  prefix: "tenant-a",
} as const;

Deno.test("SigV4 signer matches AWS's published GET Object vector", async () => {
  const headers = await signS3Request({
    method: "GET",
    path: "/test.txt",
    host: "examplebucket.s3.amazonaws.com",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    body: new Uint8Array(),
    extraHeaders: { range: "bytes=0-9" },
    now: new Date("2013-05-24T00:00:00Z"),
  });

  assertEquals(
    headers["x-amz-content-sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assertEquals(
    headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
});

Deno.test("S3 artifact destination signs requests and conditionally writes then verifies bytes", async () => {
  const remote = new Map<string, Uint8Array>();
  const methods: string[] = [];
  const destination = createS3ArtifactDestination({
    id: "s3-test",
    label: "Local S3",
    config,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      methods.push(init?.method ?? "GET");
      const headers = new Headers(init?.headers);
      assertStringIncludes(
        headers.get("authorization") ?? "",
        "AWS4-HMAC-SHA256",
      );
      const key = decodeURIComponent(
        url.pathname.split("/").slice(2).join("/"),
      );
      if (init?.method === "PUT") {
        assertEquals(headers.get("if-none-match"), "*");
        if (remote.has(key)) return new Response("exists", { status: 412 });
        remote.set(
          key,
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response(null, { status: 200 });
      }
      const value = remote.get(key);
      return value
        ? new Response(Uint8Array.from(value).buffer as ArrayBuffer)
        : new Response("missing", { status: 404 });
    },
  });

  const current = await artifact();
  assertEquals(await destination.write(current), "stored");
  assertEquals(await destination.write(current), "stored");
  assertEquals(methods, ["GET", "PUT", "GET", "GET"]);
  assertEquals(remote.size, 1);
});

Deno.test("S3 conditional conflict never overwrites a different remote artifact", async () => {
  const other = new TextEncoder().encode("other DTE bytes");
  let reads = 0;
  let puts = 0;
  const destination = createS3ArtifactDestination({
    id: "s3-race",
    label: "Racing S3",
    config,
    fetch: async (_input, init) => {
      if (init?.method === "PUT") {
        puts += 1;
        return new Response("precondition failed", { status: 412 });
      }
      reads += 1;
      return reads === 1
        ? new Response("missing", { status: 404 })
        : new Response(Uint8Array.from(other).buffer as ArrayBuffer);
    },
  });

  assertEquals(await destination.write(await artifact()), "unknown");
  assertEquals(puts, 1);
  assertEquals(reads, 2);
});

Deno.test("S3 destination rejects insecure non-local endpoints before requests", async () => {
  assertThrows(() =>
    createS3ArtifactDestination({
      id: "s3-insecure",
      label: "Insecure",
      config: {
        ...config,
        endpoint: "http://storage.example.com",
        allowInsecureEndpoint: true,
      },
    })
  );
});
