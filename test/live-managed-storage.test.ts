import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { validateLiveManagedStorage } from "../scripts/live-managed-storage.mjs";
import { createValidationResults, renderLiveReport } from "../scripts/live-report.mjs";

Deno.test("managed live checks read exact bytes and replay only the original idempotency identity", async () => {
  const bytes = new TextEncoder().encode("PRIVATE-INVOICE");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const artifact = { state: "stored", bytes: bytes.length, sha256: hash };
  const emission = { codigoGeneracion: "PRIVATE-GENERATION", storage: { destination: "managed", json: artifact, pdf: artifact } };
  const calls: string[] = [];
  const facta = {
    getDocumentCopies: () => Promise.resolve(["json", "pdf"].map(kind => ({ kind, ...artifact }))),
    downloadDocument: (_code: string, kind: string) => { calls.push(`download:${kind}`); return Promise.resolve({ bytes, storageSource: "managed" }); },
    getStorageStatus: () => Promise.resolve({ managed: { usedBytesTotal: bytes.length * 2, reservedBytesTotal: 0 } }),
    issue: (_request: unknown, options: { idempotencyKey: string }) => { calls.push(options.idempotencyKey); return Promise.resolve(emission); },
    retryDocumentStorage: () => { calls.push("repair"); return Promise.resolve(emission.storage); },
  };
  const checks = createValidationResults();
  await validateLiveManagedStorage(facta, { emission, request: {}, idempotencyKey: "stable-original", artifacts: { json: { bytes }, pdf: { bytes } }, checks });
  assertEquals(calls, ["download:json", "download:pdf", "stable-original", "repair"]);
  assertEquals(renderLiveReport(checks).includes("PRIVATE"), false);
  facta.downloadDocument = () => Promise.resolve({ bytes: new Uint8Array(), storageSource: "managed" });
  const error = await assertRejects(() => validateLiveManagedStorage(facta, { emission, request: {}, idempotencyKey: "stable-original", artifacts: { json: { bytes }, pdf: { bytes } }, checks }), Error);
  assertEquals(error.message.includes("PRIVATE"), false);
});
