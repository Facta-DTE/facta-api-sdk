import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createStorageArtifactDestination } from "../src/storage-adapter.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const bytes = new TextEncoder().encode("exact signed document bytes");
const hash = async (value: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(value).buffer as ArrayBuffer,
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

function notFound() {
  return Object.assign(new Error("missing"), { code: "NOT_FOUND" });
}

Deno.test("storage adapter creates, reads back, and idempotently confirms identical bytes", async () => {
  const objects = new Map<string, Uint8Array>();
  let writes = 0;
  const artifact: ArchiveArtifact = {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "json",
    filename: "invoice.json",
    contentType: "application/json",
    bytes,
    sha256: await hash(bytes),
  };
  const destination = createStorageArtifactDestination({
    id: "store-1",
    kind: "s3",
    label: "Private bucket",
    pathForArtifact: (value) =>
      `invoices/${value.codigoGeneracion}/${value.kind}`,
    isNotFound: (error) => (error as { code?: string }).code === "NOT_FOUND",
    store: {
      async get(path) {
        const found = objects.get(path);
        if (!found) throw notFound();
        return found.slice();
      },
      async put(path, value, contentType) {
        assertEquals(contentType, "application/json");
        writes += 1;
        objects.set(path, value.slice());
      },
    },
  });

  assertEquals(await destination.check!(artifact), "missing");
  assertEquals(await destination.write(artifact), "stored");
  assertEquals(await destination.check!(artifact), "stored");
  assertEquals(await destination.write(artifact), "stored");
  assertEquals(writes, 1);
});

Deno.test("storage adapter never overwrites a mismatched object and treats auth failures as unknown", async () => {
  const existing = new Uint8Array([1, 2, 3]);
  let writes = 0;
  let failRead = false;
  const artifact: ArchiveArtifact = {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "pdf",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    bytes,
    sha256: await hash(bytes),
  };
  const destination = createStorageArtifactDestination({
    id: "store-2",
    kind: "supabase",
    label: "Customer storage",
    pathForArtifact: () => "invoices/signed.pdf",
    isNotFound: (error) => (error as { code?: string }).code === "NOT_FOUND",
    store: {
      async get() {
        if (failRead) throw new Error("forbidden");
        return existing;
      },
      async put() {
        writes += 1;
      },
    },
  });

  assertEquals(await destination.check!(artifact), "unknown");
  assertEquals(await destination.write(artifact), "unknown");
  assertEquals(writes, 0);
  failRead = true;
  assertEquals(await destination.check!(artifact), "unknown");
  assertEquals(await destination.write(artifact), "unknown");
  assertEquals(writes, 0);
});

Deno.test("storage adapter stops on abort and rejects traversal object keys", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  const artifact: ArchiveArtifact = {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "json",
    filename: null,
    contentType: "application/json",
    bytes,
    sha256: await hash(bytes),
  };
  const destination = createStorageArtifactDestination({
    id: "store-3",
    kind: "test",
    label: "Test",
    pathForArtifact: () => "invoices/one.json",
    isNotFound: () => false,
    store: {
      async get(_path, options) {
        if (options?.signal?.aborted) throw options.signal.reason;
        throw new Error("unexpected");
      },
      async put() {
        throw new Error("must not write after cancellation");
      },
    },
  });
  await assertRejects(() =>
    destination.check!(artifact, { signal: controller.signal })
  );
  const invalid = createStorageArtifactDestination({
    id: "store-4",
    kind: "test",
    label: "Test",
    isNotFound: () => false,
    pathForArtifact: () => "../outside",
    store: {
      async get() {
        throw new Error();
      },
      async put() {},
    },
  });
  await assertRejects(() => invalid.check!(artifact));
});
