import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const apiKey = process.env.STAGING_FACTA_API_KEY;
const signKey = process.env.STAGING_FACTA_SIGN_KEY;
const unlockKey = process.env.STAGING_FACTA_UNLOCK_KEY;
const apiBaseUrl = process.env.STAGING_FACTA_API_BASE_URL;
const runId = process.env.GITHUB_RUN_ID;
const EXPECTED_STAGING_API_BASE_URL =
  "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

for (const [name, value] of [
  ["STAGING_FACTA_API_KEY", apiKey],
  ["STAGING_FACTA_SIGN_KEY", signKey],
  ["STAGING_FACTA_UNLOCK_KEY", unlockKey],
  ["STAGING_FACTA_API_BASE_URL", apiBaseUrl],
  ["GITHUB_RUN_ID", runId],
]) {
  if (!value) throw new Error(`Required integration input is unavailable: ${name}`);
}

// Fail closed before constructing the client or making any API request.
if (!apiKey.startsWith("facta_test_")) {
  throw new Error("Refusing integration run: the API key is not a test key.");
}
if (!signKey.startsWith("factask_")) {
  throw new Error("Refusing integration run: signing credential has an unexpected type.");
}
if (!unlockKey.startsWith("factauk_")) {
  throw new Error("Refusing integration run: unlock credential has an unexpected type.");
}
if (apiBaseUrl !== EXPECTED_STAGING_API_BASE_URL) {
  throw new Error("Refusing integration run: API base URL must exactly match the approved staging project.");
}

const { Facta } = await import("../dist/index.js");
const { FileInvoiceArchive } = await import("../dist/node.js");
const scratch = await mkdtemp(join(tmpdir(), "facta-sdk-integration-"));
const archivePassphrase = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");

try {
  const archive = await FileInvoiceArchive.open({
    directory: join(scratch, "archive"),
    passphrase: archivePassphrase,
  });
  const facta = new Facta({
    apiKey,
    signKey,
    unlockKey,
    baseUrl: apiBaseUrl,
    config: {
      version: 1,
      expectedEnvironment: "00",
      requiredScopes: ["issue", "query", "download"],
      timeoutMs: 90_000,
      maxRetries: 1,
    },
    runtime: { version: 1, archive },
  });

  const health = await facta.status();
  assert.equal(health.ok, true, "API status must report healthy");
  assert.equal(health.ambiente, "00", "API status must confirm the test environment");
  assert.equal(health.emisor?.ambiente, "00", "issuer must also be in the test environment");
  console.log("PASS status: healthy test environment confirmed");

  const diagnostics = await facta.diagnose({
    archive,
    dteType: "01",
    expectedEnvironment: "00",
    requiredScopes: ["issue", "query", "download"],
  });
  if (!diagnostics.canIssue || !diagnostics.canQuery || !diagnostics.canDownload || !diagnostics.canIssueAndArchive) {
    const failedChecks = diagnostics.checks
      .filter((check) => check.state === "blocked")
      .map((check) => check.id)
      .join(", ");
    throw new Error(`Preflight blocked the test invoice (${failedChecks || diagnostics.overall}).`);
  }
  console.log("PASS diagnose: issue, query, download, and local archive are ready");

  // These are read-only vault reads. Never log decrypted customer/product or destination data.
  let catalogRead = "unavailable";
  try {
    const catalog = await facta.syncCatalog();
    catalogRead = `ready (${catalog.customers.length} customers, ${catalog.products.length} products)`;
  } catch (error) {
    catalogRead = `unavailable (${safeCode(error)})`;
  }
  let destinationRead = "unavailable";
  try {
    const destinations = await facta.syncDestinations();
    destinationRead = `ready (${destinations.destinos.length} destinations)`;
  } catch (error) {
    destinationRead = `unavailable (${safeCode(error)})`;
  }
  console.log(`READ catalog: ${catalogRead}`);
  console.log(`READ destinations: ${destinationRead}`);

  const operationId = `sdk-live-${runId}`;
  const idempotencyKey = `sdk-live-${runId}`;
  const result = await facta.issueAndArchive({
    tipoDte: "01",
    items: [{ descripcion: "Facta API SDK integration test", cantidad: 1, precioUni: 0.01 }],
  }, {
    operationId,
    idempotencyKey,
    ticketPaperWidthMm: 58,
  });

  assert.equal(result.emission.ambiente, "00", "issued document must be in test environment");
  assert.equal(result.emission.tipoDte, "01", "issued document must be FE");
  if (result.archive.state !== "complete") {
    throw new Error(`Invoice was accepted, but SDK archiving is ${result.archive.state}.`);
  }
  console.log(`PASS issueAndArchive: ${result.emission.estado}; archive complete`);

  const [documentStatus, legalJson, pdf, ticket] = await Promise.all([
    facta.getDocumentStatus(result.emission.codigoGeneracion),
    facta.downloadDocument(result.emission.codigoGeneracion, "json"),
    facta.downloadDocument(result.emission.codigoGeneracion, "pdf"),
    facta.downloadDocument(result.emission.codigoGeneracion, "ticket", { paperWidthMm: 58 }),
  ]);

  assert.equal(documentStatus.codigoGeneracion, result.emission.codigoGeneracion);
  assert.equal(documentStatus.ambiente, "00");
  let listed = false;
  for (let attempt = 0; attempt < 6 && !listed; attempt++) {
    const page = await facta.listDocuments({ tipoDte: "01", limit: 20 });
    listed = page.documentos.some((document) => document.codigoGeneracion === result.emission.codigoGeneracion);
    if (!listed && attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert(listed, "the new FE must appear in the document list");
  assert(legalJson.bytes.byteLength > 0, "legal JSON download must be non-empty");
  assert.match(legalJson.contentType, /json/i, "legal JSON must have a JSON content type");
  const parsedJson = JSON.parse(new TextDecoder().decode(legalJson.bytes));
  assert.equal(typeof parsedJson.jws, "string", "legal JSON must contain the signed JWS");
  assert(pdf.bytes.byteLength > 0, "PDF download must be non-empty");
  assert.match(pdf.contentType, /pdf/i, "document download must have a PDF content type");
  assert(ticket.bytes.byteLength > 0, "ticket PDF download must be non-empty");
  assert.match(ticket.contentType, /pdf/i, "ticket download must have a PDF content type");
  console.log(`PASS query/download: ${documentStatus.estado}; list match; JSON, PDF, and ticket retrieved`);

  for (const kind of ["json", "pdf", "jws", "ticket"]) {
    const archived = await archive.getArtifact(result.emission.codigoGeneracion, kind);
    assert(archived && archived.bytes.byteLength > 0, `SDK archive must retain ${kind}`);
  }
  const pending = await facta.listPendingOperations();
  assert(!pending.some((operation) => operation.id === operationId), "completed operation must leave no pending archive journal");
  console.log("PASS archive recovery: exact JSON/PDF/JWS/ticket retained; operation journal completed");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function safeCode(error) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unavailable";
}
