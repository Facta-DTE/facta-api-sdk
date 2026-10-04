import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createValidationResults, renderLiveReport, safeFailureCode } from "./live-report.mjs";
import { validateLiveManagedStorage } from "./live-managed-storage.mjs";
import { requireLiveSnapshots, validateLiveCatalogReads } from "./live-preflight.mjs";
import {
  assertRelatedTestDocuments,
  assertLiveRunWithinIdempotencyWindow,
  assessLiveDteFixtureMatrix,
  LIVE_DTE_FIXTURE_TYPES,
  parseLiveDteFixtures,
  relatedGenerationCodes,
  requireCompleteLiveDteFixtureMatrix,
} from "./live-dte-fixtures.mjs";

const apiKey = process.env.STAGING_FACTA_API_KEY;
const signKey = process.env.STAGING_FACTA_SIGN_KEY;
const unlockKey = process.env.STAGING_FACTA_UNLOCK_KEY;
const apiBaseUrl = process.env.STAGING_FACTA_API_BASE_URL;
const runId = process.env.GITHUB_RUN_ID;
const reportDir = process.env.FACTA_LIVE_REPORT_DIR;
const liveMode = process.env.FACTA_LIVE_MODE ?? "emit-test-fe";
const EXPECTED_STAGING_API_BASE_URL =
  "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

for (const [name, value] of [
  ["STAGING_FACTA_API_KEY", apiKey],
  ["STAGING_FACTA_SIGN_KEY", signKey],
  ["STAGING_FACTA_UNLOCK_KEY", unlockKey],
  ["STAGING_FACTA_API_BASE_URL", apiBaseUrl],
  ["GITHUB_RUN_ID", runId],
  ["GITHUB_RUN_CREATED_AT", process.env.GITHUB_RUN_CREATED_AT],
  ["FACTA_LIVE_REPORT_DIR", reportDir],
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
if (!["emit-test-fe", "emit-enabled-dte-fixtures"].includes(liveMode)) {
  throw new Error("Refusing integration run: unknown live-test mode.");
}
assertLiveRunWithinIdempotencyWindow(process.env.GITHUB_RUN_CREATED_AT);

const { Facta } = await import("../dist/index.js");
const { FileInvoiceArchive } = await import("../dist/node.js");
const scratch = await mkdtemp(join(tmpdir(), "facta-sdk-integration-"));
const archivePassphrase = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");

const checks = createValidationResults();
let currentCheck = "status";
let failureCode = null;

try {
  const archive = await FileInvoiceArchive.open({
    directory: join(scratch, "archive"),
    passphrase: archivePassphrase,
  });
  const requestRecords = [];
  const trackedFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requestRecords.push({ url, method: init?.method ?? (input instanceof Request ? input.method : "GET") });
    return globalThis.fetch(input, init);
  };
  const facta = new Facta({
    fetch: trackedFetch,
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
  checks.status = "Passed";
  currentCheck = "preflight";
  console.log("PASS status: healthy test environment confirmed");

  const fixtures = parseLiveDteFixtures(process.env.STAGING_FACTA_DTE_FIXTURES_JSON);
  const fixtureMatrix = assessLiveDteFixtureMatrix(health, fixtures);
  for (const [type, state] of Object.entries(fixtureMatrix)) checks[`dte-${type}`] = state;
  if (liveMode === "emit-enabled-dte-fixtures") {
    currentCheck = "fixture-matrix";
    requireCompleteLiveDteFixtureMatrix(fixtureMatrix);
    const relatedStatuses = await Promise.all(relatedGenerationCodes(fixtures).map((code) => facta.getDocumentStatus(code)));
    assertRelatedTestDocuments(fixtures, relatedStatuses);
  }

  const diagnostics = await facta.diagnose({
    archive,
    dteType: "01",
    expectedEnvironment: "00",
    requiredScopes: ["issue", "query", "download"],
  });
  // Read-only capability checks must pass before this full live run issues anything.
  const storageCapability = await facta.getStorageStatus();
  assert(storageCapability.managed.ready, "Full managed live validation requires ready managed storage.");
  const snapshots = await requireLiveSnapshots(facta, checks, (check) => { currentCheck = check; }, storageCapability.managed.ready && !storageCapability.byos.ready);
  await validateLiveCatalogReads(facta, snapshots.catalog, checks, (check) => { currentCheck = check; });
  console.log("PASS snapshots: catalog and required BYOS destinations verified locally");
  currentCheck = "preflight";

  if (!diagnostics.canIssue || !diagnostics.canQuery || !diagnostics.canDownload || !diagnostics.canIssueAndArchive) {
    const error = new Error("Readiness checks blocked live issuance.");
    error.code = !diagnostics.canIssue || !diagnostics.canQuery || !diagnostics.canDownload
      ? "permission_missing"
      : "readiness_blocked";
    throw error;
  }
  checks.preflight = "Passed";
  console.log("PASS diagnose: issue, query, download, and local archive are ready");

  const operationId = `sdk-live-${runId}-01`;
  const idempotencyKey = `sdk-live-${runId}-01`;
  currentCheck = "emission";
  const request = { tipoDte: "01", items: [{ descripcion: "Facta API SDK integration test", cantidad: 1, precioUni: 0.01 }] };
  const result = await facta.issueAndArchive(request, {
    operationId,
    idempotencyKey,
    ticketPaperWidthMm: 58,
  });

  const [legalJson, pdf, ticket] = await Promise.all([
    archive.getArtifact(result.emission.codigoGeneracion, "json"),
    archive.getArtifact(result.emission.codigoGeneracion, "pdf"),
    archive.getArtifact(result.emission.codigoGeneracion, "ticket"),
  ]);
  assert.equal(result.emission.estado, "sellado", "test invoice must be sealed by Hacienda");
  assert.equal(result.emission.totales.totalPagar, 0.01, "test invoice must total exactly $0.01");
  assert.equal(result.emission.ambiente, "00", "issued document must be in test environment");
  assert.equal(result.emission.tipoDte, "01", "issued document must be FE");
  checks.emission = "Passed (sealed test FE, $0.01)";
  checks["dte-01"] = "Passed (sealed test FE, $0.01)";
  currentCheck = "archive";
  assert(result.archive.state === "complete", "Local archive must be complete");
  checks.archive = "Passed";
  console.log("PASS issueAndArchive: test FE sealed; archive complete");

  currentCheck = "signed-json";
  assert(legalJson && legalJson.bytes.byteLength > 0, "inline signed JSON must be archived");

  assert.match(legalJson.contentType, /json/i, "signed JSON must have a JSON content type");
  const parsedJson = JSON.parse(new TextDecoder().decode(legalJson.bytes));
  assert(parsedJson.jws === result.emission.jws, "archived JSON must preserve the server-signed JWS");
  checks["signed-json"] = "Passed";
  currentCheck = "pdf";
  assert(pdf && pdf.bytes.byteLength > 0, "inline PDF must be archived");
  assert.match(pdf.contentType, /pdf/i, "document must be a PDF");
  assert.match(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), /^%PDF-/);
  checks.pdf = "Passed";
  currentCheck = "ticket";
  assert(ticket && ticket.bytes.byteLength > 0, "ticket PDF must be archived");
  assert.match(ticket.contentType, /pdf/i, "ticket must have a PDF content type");
  assert.match(new TextDecoder().decode(ticket.bytes.subarray(0, 5)), /^%PDF-/);
  checks.ticket = "Passed";
  currentCheck = "inline-bytes";
  assert.equal(typeof result.emission.archivoJson, "string", "API must return inline signed JSON");
  assert(result.emission.representacionGrafica, "API must return the inline PDF");
  assert(Buffer.from(legalJson.bytes).equals(Buffer.from(result.emission.archivoJson, "utf8")),
    "archived JSON must match the exact response bytes");
  assert(Buffer.from(pdf.bytes).equals(Buffer.from(result.emission.representacionGrafica, "base64")),
    "archived PDF must match the exact response bytes");
  checks["inline-bytes"] = "Passed";
  currentCheck = "no-downloads";
  const fileRequests = requestRecords.filter(({ url }) => /\/v1\/dte\/[^/]+\/file$/.test(url.pathname));
  assert(fileRequests.every(({ url }) => url.searchParams.get("kind") === "ticket"), "inline JSON/PDF archival must not call a document file download endpoint");
  assert.equal(fileRequests.length, 1, "only the ticket may use the file download endpoint");
  checks["no-downloads"] = "Passed";
  console.log("PASS archive: exact signed JSON, PDF, and ticket retained");
  await validateLiveManagedStorage(facta, { emission: result.emission, request, idempotencyKey, artifacts: { json: legalJson, pdf }, checks, onCheck: (check) => { currentCheck = check; } });

  if (liveMode === "emit-enabled-dte-fixtures") {
    for (const type of LIVE_DTE_FIXTURE_TYPES) {
      currentCheck = `dte-${type}`;
      const fixtureRequest = fixtures[type];
      const fixtureOperationId = `sdk-live-${runId}-${type}`;
      const fixtureIdempotencyKey = `sdk-live-${runId}-${type}`;
      const fixtureResult = await facta.issueAndArchive(fixtureRequest, {
        operationId: fixtureOperationId,
        idempotencyKey: fixtureIdempotencyKey,
        ticketPaperWidthMm: 58,
      });
      assert.equal(fixtureResult.emission.estado, "sellado", "test DTE fixture must be sealed");
      assert.equal(fixtureResult.emission.tipoDte, type);
      assert.equal(fixtureResult.emission.ambiente, "00");
      assert.equal(fixtureResult.emission.totales.totalPagar, 0.01);
      assert.equal(fixtureResult.archive.state, "complete");
      const fixtureStatus = await facta.getDocumentStatus(fixtureResult.emission.codigoGeneracion);
      assert.equal(fixtureStatus.estado, "sellado");
      assert.equal(fixtureStatus.ambiente, "00");
      checks[`dte-${type}`] = "Passed (test fixture sealed)";
    }
  }
  currentCheck = "query";
  const documentStatus = await facta.getDocumentStatus(result.emission.codigoGeneracion);
  assert(documentStatus.codigoGeneracion.toUpperCase() === result.emission.codigoGeneracion.toUpperCase(),
    "queried UUID must identify the issued invoice regardless of database casing");
  assert.equal(documentStatus.ambiente, "00");
  assert.equal(documentStatus.estado, "sellado", "queried invoice must remain sealed");
  checks.query = "Passed";
  currentCheck = "listing";
  let listed = false;
  for (let attempt = 0; attempt < 6 && !listed; attempt++) {
    const page = await facta.listDocuments({ tipoDte: "01", limit: 20 });
    listed = page.documentos.some((document) => document.codigoGeneracion.toUpperCase() === result.emission.codigoGeneracion.toUpperCase());
    if (!listed && attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert(listed, "the new FE must appear in the document list");
  checks.listing = "Passed";
  console.log("PASS query and listing: test FE found and sealed");

  currentCheck = "journal";
  const beforeJournalRecovery = requestRecords.length;
  const journalRecovery = await facta.recoverOperation(operationId, { request, archive });
  assert.equal(journalRecovery.archive.state, "complete", "completed journal must recover without issuing again");
  assert.equal(requestRecords.slice(beforeJournalRecovery).filter(({ url, method }) => url.pathname.endsWith("/v1/dte") && method === "POST").length, 0,
    "completed journal recovery must not submit an invoice");
  const pending = await facta.listPendingOperations();
  assert(!pending.some((operation) => operation.id === operationId), "completed operation must leave no pending archive journal");
  console.log("PASS archive recovery: operation journal completed");
  checks.journal = "Passed";

  currentCheck = "restart";
  const restartedArchive = await FileInvoiceArchive.open({
    directory: join(scratch, "archive"),
    passphrase: archivePassphrase,
  });
  const postRestart = requestRecords.length;
  const restartedFacta = new Facta({
    fetch: trackedFetch,
    apiKey,
    signKey,
    unlockKey,
    baseUrl: apiBaseUrl,
    config: { version: 1, expectedEnvironment: "00", timeoutMs: 90_000, maxRetries: 1 },
    runtime: { version: 1, archive: restartedArchive },
  });
  const recovered = await restartedFacta.recoverOperation(operationId);
  assert.equal(recovered.archive.state, "complete");
  assert.equal((await restartedArchive.pending()).length, 0);
  assert((await restartedArchive.getArtifact(result.emission.codigoGeneracion, "ticket"))?.bytes.byteLength > 0);
  assert.equal(requestRecords.slice(postRestart).filter(({ url, method }) => url.pathname.endsWith("/v1/dte") && method === "POST").length, 0,
    "completed restart recovery must not submit an invoice");
  checks.restart = "Passed";
} catch (error) {
  checks[currentCheck] = "Failed";
  failureCode = safeFailureCode(error);
  // Never print API messages, stacks, assertion values, JWS, or invoice bytes.
  console.error(`FAIL live integration: ${currentCheck} (${failureCode})`);
  process.exitCode = 1;
} finally {
  try {
    await saveReport();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function saveReport() {
  const report = renderLiveReport(checks, failureCode);
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.md"), report, { mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report);
}
