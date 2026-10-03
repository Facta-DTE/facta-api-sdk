import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

try {
  const archive = await FileInvoiceArchive.open({
    directory: join(scratch, "archive"),
    passphrase: archivePassphrase,
  });
  const requestUrls = [];
  const facta = new Facta({
    fetch: async (input, init) => {
      requestUrls.push(new URL(input instanceof Request ? input.url : String(input)));
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

  const [legalJson, pdf, ticket] = await Promise.all([
    archive.getArtifact(result.emission.codigoGeneracion, "json"),
    archive.getArtifact(result.emission.codigoGeneracion, "pdf"),
    archive.getArtifact(result.emission.codigoGeneracion, "ticket"),
  ]);
  await mkdir(reportDir, { recursive: true });
  if (legalJson) await writeFile(join(reportDir, "invoice.json"), legalJson.bytes, { mode: 0o600 });
  if (pdf) await writeFile(join(reportDir, "invoice.pdf"), pdf.bytes, { mode: 0o600 });
  await saveReport(result.emission, "Invoice issued; subsequent integration checks are pending.");
  assert.equal(result.emission.estado, "sellado", "test invoice must be sealed by Hacienda");
  assert.equal(result.emission.totales.totalPagar, 0.01, "test invoice must total exactly $0.01");
  assert.equal(result.emission.ambiente, "00", "issued document must be in test environment");
  assert.equal(result.emission.tipoDte, "01", "issued document must be FE");
  if (result.archive.state !== "complete") {
    throw new Error(`Invoice was accepted, but SDK archiving is ${result.archive.state}.`);
  }
  console.log(`PASS issueAndArchive: ${result.emission.estado}; archive complete`);

  assert(legalJson && legalJson.bytes.byteLength > 0, "inline signed JSON must be archived");
  assert(pdf && pdf.bytes.byteLength > 0, "inline PDF must be archived");
  assert(ticket && ticket.bytes.byteLength > 0, "ticket must be archived");
  assert.match(legalJson.contentType, /json/i, "signed JSON must have a JSON content type");
  const parsedJson = JSON.parse(new TextDecoder().decode(legalJson.bytes));
  assert.equal(parsedJson.jws, result.emission.jws, "archived JSON must preserve the server-signed JWS");
  assert.match(pdf.contentType, /pdf/i, "document must be a PDF");
  assert.match(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), /^%PDF-/);
  assert.match(ticket.contentType, /pdf/i, "ticket must be a PDF");
  assert.equal(typeof result.emission.archivoJson, "string", "API must return inline signed JSON");
  assert(result.emission.representacionGrafica, "API must return the inline PDF");
  assert.deepEqual(Buffer.from(legalJson.bytes), Buffer.from(result.emission.archivoJson, "utf8"),
    "archived JSON must match the exact response bytes");
  assert.deepEqual(Buffer.from(pdf.bytes), Buffer.from(result.emission.representacionGrafica, "base64"),
    "archived PDF must match the exact response bytes");
  const fileRequests = requestUrls.filter((url) => /\/v1\/dte\/[^/]+\/file$/.test(url.pathname));
  assert(fileRequests.every((url) => url.searchParams.get("kind") === "ticket"),
    "initial archival must not download JSON or PDF; ticket requests are allowed");
  console.log("PASS inline archive: exact signed JSON and PDF saved without redownloading; ticket generated");
  const documentStatus = await facta.getDocumentStatus(result.emission.codigoGeneracion);
  assert.equal(documentStatus.codigoGeneracion, result.emission.codigoGeneracion);
  assert.equal(documentStatus.ambiente, "00");
  assert.equal(documentStatus.estado, "sellado", "queried invoice must remain sealed");
  let listed = false;
  for (let attempt = 0; attempt < 6 && !listed; attempt++) {
    const page = await facta.listDocuments({ tipoDte: "01", limit: 20 });
    listed = page.documentos.some((document) => document.codigoGeneracion === result.emission.codigoGeneracion);
    if (!listed && attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert(listed, "the new FE must appear in the document list");
  console.log(`PASS query: ${documentStatus.estado}; list match`);

  const pending = await facta.listPendingOperations();
  assert(!pending.some((operation) => operation.id === operationId), "completed operation must leave no pending archive journal");
  console.log("PASS archive recovery: operation journal completed");
  await saveReport(result.emission, "All integration checks passed; inline JSON/PDF byte equality and no repeated download confirmed.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function safeCode(error) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unavailable";
}

async function saveReport(emission, validation) {
  const report = [
    "## Staging live invoice",
    "",
    "| Field | Result |",
    "| --- | --- |",
    "| Environment | Test / staging (`00`) |",
    `| API base URL | ${apiBaseUrl} |`,
    "| DTE | FE (`01`) |",
    `| Status | ${emission.estado} |`,
    `| Control number | ${emission.numeroControl} |`,
    `| Generation code | ${emission.codigoGeneracion} |`,
    `| Issued at | ${emission.fecEmi} ${emission.horEmi} |`,
    `| Total | $${Number(emission.totales.totalPagar).toFixed(2)} |`,
    "",
    validation,
    "",
    "Invoice files are retained as workflow artifacts for 7 days. Download links are added to the pull request comment after upload.",
    "",
    "> This is a real test-environment FE emission; it is not a production invoice.",
    "",
  ].join("\n");
  await writeFile(join(reportDir, "report.md"), report, { mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
