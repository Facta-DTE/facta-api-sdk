const LABELS = Object.freeze({
  status: "Staging API and test environment",
  preflight: "Issuance permissions and readiness",
  catalog: "Encrypted catalog snapshot opened locally",
  "customer-catalog": "Authorized customer catalog reads",
  "product-catalog": "Authorized product catalog reads",
  destinations: "Encrypted destination snapshot opened locally",
  "dte-01": "DTE 01 final consumer invoice",
  "dte-03": "DTE 03 credit fiscal invoice",
  "dte-05": "DTE 05 credit note",
  "dte-06": "DTE 06 debit note",
  "dte-11": "DTE 11 export invoice",
  "dte-14": "DTE 14 excluded-subject invoice",
  emission: "Invoice generated and sealed",
  archive: "Encrypted local archive",
  ticket: "Local receipt ticket",
  "signed-json": "Signed JSON received and validated",
  pdf: "PDF received and validated",
  "inline-bytes": "Exact server bytes preserved",
  "no-downloads": "No repeated file downloads",
  "managed-receipt": "Durable managed JSON/PDF receipts",
  "managed-readback": "Exact managed copy read-back",
  "managed-replay-repair": "Idempotent replay and copy repair accounting",
  query: "Invoice consultation",
  listing: "Invoice listing",
  journal: "Completed operation journal",
  restart: "Encrypted journal restart and recovery",
});
const STATES = new Set([
  "Not checked", "Failed", "Passed", "Passed (sealed test FE, $0.01)",
  "Not applicable (managed only)", "Not applicable (empty authorized catalog)",
  "Not run (fixture missing)", "Blocked (permission unavailable)",
  "Ready (baseline test only)", "Ready (fixture configured)",
  "Passed (test fixture sealed)",
]);
const ERROR_CODES = new Set([
  "not_found", "service_unavailable", "invalid_request", "unauthorized",
  "forbidden", "rate_limit_exceeded", "archive_integrity_error", "validation_failed",
  "no_storage_destination", "sign_vault_missing",
  "readiness_blocked", "catalog_read_failed",
  "storage_unsupported", "storage_unavailable", "storage_contract_invalid",
  "fixture_required", "fixture_invalid", "permission_missing", "related_document_invalid",
  "idempotency_window_expired",
]);

export function createValidationResults() {
  return Object.fromEntries(Object.keys(LABELS).map((name) => [name, "Not checked"]));
}

export function safeFailureCode(error) {
  return ERROR_CODES.has(error?.code) ? error.code : "validation_failed";
}

/**
 * Publish only allowlisted validation labels/states; never invoice data.
 * @param {Record<string, unknown>} checks
 * @param {unknown} failureCode
 */
export function renderLiveReport(checks, failureCode = null) {
  return [
    "## Staging live validation",
    "",
    "| Check | Result |",
    "| --- | --- |",
    ...Object.entries(LABELS).map(([name, label]) =>
      `| ${label} | ${STATES.has(checks[name]) ? checks[name] : "Not checked"} |`),
    "",
    ...(failureCode ? [`Failure category: \`${safeFailureCode({ code: failureCode })}\`.`, ""] : []),
    "Invoice documents and issuer/customer identifiers are not uploaded or published.",
    "This test uses environment `00`; it does not issue a production invoice.",
    "",
  ].join("\n");
}
