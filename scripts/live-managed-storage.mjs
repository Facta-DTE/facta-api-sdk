/** Verify only the explicitly issued test document; never emit a second request identity. */
export async function validateLiveManagedStorage(facta, { emission, request, idempotencyKey, artifacts, checks, onCheck = (_check) => {} }) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  onCheck("managed-receipt");
  require(!emission.storageErrorCode && emission.storage?.destination === "managed", "Managed storage receipt is required.");
  let receipt = emission.storage;
  if ([receipt.json, receipt.pdf].some(artifact => artifact.state !== "stored")) receipt = await facta.retryDocumentStorage(emission.codigoGeneracion);
  require(receipt.json.state === "stored" && receipt.pdf.state === "stored", "Managed copies must be durable before validation completes.");
  checks["managed-receipt"] = "Passed";
  onCheck("managed-readback");
  const copies = await facta.getDocumentCopies({ generationCode: emission.codigoGeneracion });
  for (const kind of ["json", "pdf"]) {
    const local = artifacts[kind];
    const expectedDigest = await digest(local.bytes);
    const copy = copies.find(copy => copy.kind === kind);
    require(copy?.state === "stored" && copy.sha256 === expectedDigest && copy.bytes === local.bytes.byteLength, "Managed copy metadata must match exact local bytes.");
    require(receipt[kind].sha256 === expectedDigest && receipt[kind].bytes === local.bytes.byteLength, "Receipt must match exact local bytes.");
    const downloaded = await facta.downloadDocument(emission.codigoGeneracion, kind);
    require(downloaded.storageSource === "managed" && await digest(downloaded.bytes) === expectedDigest, "Managed read-back must preserve exact bytes.");
  }
  checks["managed-readback"] = "Passed";
  onCheck("managed-replay-repair");
  const before = await facta.getStorageStatus();
  const replay = await facta.issue(request, { idempotencyKey });
  require(replay.codigoGeneracion.toUpperCase() === emission.codigoGeneracion.toUpperCase() && !replay.storageErrorCode, "Idempotent replay must identify the original invoice.");
  const repaired = await facta.retryDocumentStorage(emission.codigoGeneracion);
  require(repaired.json.state === "stored" && repaired.pdf.state === "stored", "Copy repair must retain durable copies.");
  const after = await facta.getStorageStatus();
  require(before.managed.usedBytesTotal === after.managed.usedBytesTotal && before.managed.reservedBytesTotal === after.managed.reservedBytesTotal, "Replay and repair must not increase managed accounting.");
  checks["managed-replay-repair"] = "Passed";
}
