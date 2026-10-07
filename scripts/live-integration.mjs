import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createValidationResults, renderLiveReport, safeFailureCode } from "./live-report.mjs";
import { validateLiveManagedStorage } from "./live-managed-storage.mjs";
import { emailDeliveryReportState, emailDeliveryVerdict, emailDeliveryWarningLines } from "./live-delivery.mjs";
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
// Optional: the inbox the e-mail delivery check sends to. Unset means the check
// is reported as not run; nothing is sent.
const deliveryInbox = process.env.STAGING_FACTA_DELIVERY_EMAIL?.trim() || undefined;
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
if (deliveryInbox !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deliveryInbox)) {
  const error = new Error("Refusing integration run: the delivery inbox is not an e-mail address.");
  error.code = "delivery_inbox_invalid";
  throw error;
}
assertLiveRunWithinIdempotencyWindow(process.env.GITHUB_RUN_CREATED_AT);

const { Facta, archivoDteOf } = await import("../dist/index.js");
const { FileInvoiceArchive } = await import("../dist/node.js");
const scratch = await mkdtemp(join(tmpdir(), "facta-sdk-integration-"));
const archivePassphrase = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");

const emergencyCalls = [];
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
    runtime: { version: 1, archive, emergencyStore: async (_files, info) => { emergencyCalls.push(info.reason); } },
  });

  const health = await facta.status();
  assert.equal(health.ok, true, "API status must report healthy");
  assert.equal(health.ambiente, "00", "API status must confirm the test environment");
  assert.equal(health.emisor?.ambiente, "00", "issuer must also be in the test environment");
  // The API advertises its functions region once the monorepo change is deployed; warn until then.
  const pinned = await facta.region();
  console.log(`INFO region: pinned=${pinned ?? "none"} served=${facta.servedRegion ?? "unknown"}`);
  if (typeof health.region === "string") {
    assert.equal(health.region, "us-west-2", "API status must advertise the database region");
    assert.equal(facta.servedRegion, "us-west-2", "requests must be served from the database region");
  } else {
    console.warn("WARN region: the API does not advertise a region yet; the built-in default was used");
  }
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
  // The Archivo DTE: the server's `archivoDte` when deployed, otherwise the SDK builds it.
  // Either way it must carry the exact JWS and the seal of this document.
  const archivoDte = archivoDteOf(result.emission);
  assert(typeof archivoDte === "string", "a sealed result must yield an Archivo DTE");
  const archivoParsed = JSON.parse(archivoDte);
  assert(archivoParsed.firmaElectronica === result.emission.jws, "Archivo DTE must carry the exact JWS");
  assert(archivoParsed.selloRecibido === result.emission.selloRecibido, "Archivo DTE must carry Hacienda's seal");
  if (typeof result.emission.archivoDte === "string") {
    const fallback = archivoDteOf({ ...result.emission, archivoDte: undefined });
    assert(JSON.stringify(archivoParsed) === JSON.stringify(JSON.parse(fallback)), "the server's Archivo DTE must match the SDK's fallback");
    console.log(`INFO archivoDte served by the API; fallback bytes ${fallback === result.emission.archivoDte ? "identical" : "differ in formatting only"}`);
  } else {
    console.log("INFO archivoDte not served by this API yet; built by the SDK fallback");
  }
  checks["inline-bytes"] = "Passed";
  currentCheck = "no-downloads";
  const fileRequests = requestRecords.filter(({ url }) => /\/v1\/dte\/[^/]+\/file$/.test(url.pathname));
  assert(fileRequests.every(({ url }) => url.searchParams.get("kind") === "ticket"), "inline JSON/PDF archival must not call a document file download endpoint");
  assert.equal(fileRequests.length, 1, "only the ticket may use the file download endpoint");
  checks["no-downloads"] = "Passed";
  currentCheck = "emergency-idle";
  assert.equal(emergencyCalls.length, 0, "the emergency safeguard must stay idle on a normal issue");
  assert.equal(result.emergency, undefined, "a normal issue must not carry an emergency report");
  assert.equal(result.emission.emergency, undefined, "a normal emission must not carry an emergency report");
  checks["emergency-idle"] = "Passed";
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

  currentCheck = "email-delivery";
  if (deliveryInbox === undefined) {
    checks["email-delivery"] = "Not run (no test inbox configured)";
    console.log("SKIP e-mail delivery: STAGING_FACTA_DELIVERY_EMAIL is not configured");
  } else {
    await validateLiveEmailDelivery(facta, request);
  }
} catch (error) {
  checks[currentCheck] = "Failed";
  failureCode = safeFailureCode(error);
  // Never print API messages, stacks, assertion values, JWS, or invoice bytes.
  console.error(`FAIL live integration: ${currentCheck} (${failureCode})`);
  // The category above folds every unlisted cause into `validation_failed`. Name
  // the cause without data: a raw API/SDK error code (a stable identifier), or
  // the message of an assertion only when this script wrote it (never the
  // generated message, which embeds the compared values).
  const detail = failureDetail(error);
  if (detail) console.error(`FAIL detail: ${detail}`);
  process.exitCode = 1;
} finally {
  try {
    await saveReport();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Issue one more $0.01 test FE marked for e-mail delivery, start it, and wait
 * for its final state. A reached mail quota or a provider outage only warns;
 * any other outcome that is not «enviado» to the right inbox fails the run.
 */
async function validateLiveEmailDelivery(facta, request) {
  const idempotencyKey = `sdk-live-${runId}-mail`;
  const emission = await facta.issue(request, { idempotencyKey, deliver: { email: deliveryInbox } });
  assert.equal(emission.estado, "sellado", "the delivery test invoice must be sealed");
  assert.equal(emission.ambiente, "00", "the delivery test invoice must be in the test environment");
  const token = emission.entrega?.token;
  let observed;
  if (typeof token !== "string" || token === "") {
    // No token: the API declined the channel up front; its state says why.
    observed = { channel: emission.entrega?.canales?.correo, settled: true, expectedRecipient: deliveryInbox };
  } else {
    try {
      await facta.deliverEmail(emission.codigoGeneracion, token);
      const waited = await facta.waitForDelivery(emission.codigoGeneracion, { channels: ["correo"], timeoutMs: 90_000, intervalMs: 3_000 });
      observed = { channel: waited.canales.correo, settled: waited.settled, expectedRecipient: deliveryInbox };
    } catch (error) {
      observed = { error };
    }
  }
  const verdict = emailDeliveryVerdict(observed);
  checks["email-delivery"] = emailDeliveryReportState(verdict);
  if (verdict.outcome === "warn") {
    for (const line of emailDeliveryWarningLines(verdict)) console.log(line);
    return;
  }
  if (verdict.outcome === "fail") {
    console.error(`FAIL e-mail delivery: ${verdict.code}${verdict.status ? ` (HTTP ${verdict.status})` : ""}`);
    const error = new Error("E-mail delivery failed.");
    error.code = "email_delivery_failed";
    throw error;
  }
  console.log("PASS e-mail delivery: sent to the configured test inbox");
}

async function saveReport() {
  const report = renderLiveReport(checks, failureCode);
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.md"), report, { mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report);
}

function failureDetail(error) {
  if (error?.name === "AssertionError") {
    return error.generatedMessage === false ? `assertion: ${String(error.message).slice(0, 160)}` : "assertion (generated message withheld)";
  }
  const code = error?.code;
  if (typeof code === "string" && /^[a-z0-9_]{2,64}$/.test(code)) return `code: ${code}${typeof error.status === "number" ? ` (HTTP ${error.status})` : ""}`;
  return error?.name ? `error type: ${String(error.name).slice(0, 40)}` : null;
}
