import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createValidationResults, renderLiveReport, safeFailureCode } from "./live-report.mjs";

const apiKey = process.env.STAGING_FACTA_API_KEY;
const signKey = process.env.STAGING_FACTA_SIGN_KEY;
const unlockKey = process.env.STAGING_FACTA_UNLOCK_KEY;
const apiBaseUrl = process.env.STAGING_FACTA_API_BASE_URL;
const runId = process.env.GITHUB_RUN_ID;
const reportDir = process.env.FACTA_LIVE_REPORT_DIR;
const EXPECTED_STAGING_API_BASE_URL =
  "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

for (const [name, value] of [
  ["STAGING_FACTA_API_KEY", apiKey],
  ["STAGING_FACTA_SIGN_KEY", signKey],
  ["STAGING_FACTA_UNLOCK_KEY", unlockKey],
  ["STAGING_FACTA_API_BASE_URL", apiBaseUrl],
  ["GITHUB_RUN_ID", runId],
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
  const requestUrls = [];
  const facta = new Facta({
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requestUrls.push(url);
      return globalThis.fetch(input, init);
    },
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

  const diagnostics = await facta.diagnose({
    archive,
    dteType: "01",
    expectedEnvironment: "00",
    requiredScopes: ["issue", "query", "download"],
  });
  // Missing public synchronization metadata is "unknown", but can still
  // prevent issuance. Report every non-ok check without exposing status data.
  const readiness = {
    overall: diagnostics.overall,
    canIssue: diagnostics.canIssue,
    canQuery: diagnostics.canQuery,
    canDownload: diagnostics.canDownload,
    canIssueAndArchive: diagnostics.canIssueAndArchive,
    checks: diagnostics.checks.filter((check) => check.state !== "ok")
      .map((check) => ({
        id: check.id,
        state: check.state,
        reasonCode: `${check.id}:${check.state}`,
      })),
  };
  console.log(`PREFLIGHT readiness: ${JSON.stringify(readiness)}`);

  if (!diagnostics.canIssue || !diagnostics.canQuery || !diagnostics.canDownload || !diagnostics.canIssueAndArchive) {
    const failedChecks = readiness.checks.map((check) => check.reasonCode).join(", ");
    throw new Error(`Preflight blocked the test invoice (${failedChecks || diagnostics.overall}).`);
  }
  checks.preflight = "Passed";
  console.log("PASS diagnose: issue, query, download, and local archive are ready");

  // These are read-only vault reads. Never log decrypted customer/product or destination data.
  let catalogRead = "unavailable";
  try {
    const catalog = await facta.syncCatalog();
    catalogRead = "ready";
  } catch (error) {
    catalogRead = `unavailable (${safeFailureCode(error)})`;
  }
  let destinationRead = "unavailable";
  try {
    const destinations = await facta.syncDestinations();
    destinationRead = "ready";
  } catch (error) {
    destinationRead = `unavailable (${safeFailureCode(error)})`;
  }
  console.log(`READ catalog: ${catalogRead}`);
  console.log(`READ destinations: ${destinationRead}`);

  const operationId = `sdk-live-${runId}`;
  const idempotencyKey = `sdk-live-${runId}`;
  currentCheck = "emission";
  const result = await facta.issueAndArchive({
    tipoDte: "01",
    items: [{ descripcion: "Facta API SDK integration test", cantidad: 1, precioUni: 0.01 }],
  }, {
    operationId,
    idempotencyKey,
    includeTicket: false,
  });

  const [legalJson, pdf] = await Promise.all([
    archive.getArtifact(result.emission.codigoGeneracion, "json"),
    archive.getArtifact(result.emission.codigoGeneracion, "pdf"),
  ]);
  assert.equal(result.emission.estado, "sellado", "test invoice must be sealed by Hacienda");
  assert.equal(result.emission.totales.totalPagar, 0.01, "test invoice must total exactly $0.01");
  assert.equal(result.emission.ambiente, "00", "issued document must be in test environment");
  assert.equal(result.emission.tipoDte, "01", "issued document must be FE");
  checks.emission = "Passed (sealed test FE, $0.01)";
  currentCheck = "archive";
  assert(result.archive.state === "complete", "Local archive must be complete");
  checks.archive = "Passed";
  console.log(`PASS issueAndArchive: ${result.emission.estado}; archive complete`);

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
  currentCheck = "inline-bytes";
  assert.equal(typeof result.emission.archivoJson, "string", "API must return inline signed JSON");
  assert(result.emission.representacionGrafica, "API must return the inline PDF");
  assert(Buffer.from(legalJson.bytes).equals(Buffer.from(result.emission.archivoJson, "utf8")),
    "archived JSON must match the exact response bytes");
  assert(Buffer.from(pdf.bytes).equals(Buffer.from(result.emission.representacionGrafica, "base64")),
    "archived PDF must match the exact response bytes");
  checks["inline-bytes"] = "Passed";
  currentCheck = "no-downloads";
  const fileRequests = requestUrls.filter((url) => /\/v1\/dte\/[^/]+\/file$/.test(url.pathname));
  assert.equal(fileRequests.length, 0, "inline archival must not call any file download endpoint");
  checks["no-downloads"] = "Passed";
  console.log("PASS inline archive: exact signed JSON and PDF saved without any file download");
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
  console.log(`PASS query: ${documentStatus.estado}; list match`);

  currentCheck = "journal";
  const pending = await facta.listPendingOperations();
  assert(!pending.some((operation) => operation.id === operationId), "completed operation must leave no pending archive journal");
  console.log("PASS archive recovery: operation journal completed");
  checks.journal = "Passed";
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
