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
  // Stable public API codes from the server error taxonomy.
  "unauthorized", "invalid_api_key", "key_revoked", "key_expired", "key_inactive",
  "forbidden_scope", "dte_type_not_allowed", "ip_not_allowed", "environment_not_allowed",
  "sign_key_required", "sign_key_invalid", "sign_vault_locked", "sign_vault_missing",
  "invalid_request", "validation_failed", "not_found", "method_not_allowed",
  "idempotency_key_required", "idempotency_key_reuse", "idempotency_in_flight",
  "prepare_token_invalid", "rate_limited", "amount_limit", "mh_rejected",
  "mh_unreachable", "correlative_unavailable", "no_storage_destination",
  "service_unavailable", "internal_error",
  // Stable SDK-local codes.
  "archive_integrity_error", "network_error", "operation_outcome_unknown",
  // Legacy/local codes kept from dev.
  "forbidden", "rate_limit_exceeded",
  "readiness_blocked", "catalog_read_failed",
  "storage_unsupported", "storage_unavailable", "storage_contract_invalid",
  "fixture_required", "fixture_invalid", "permission_missing", "related_document_invalid",
  "idempotency_window_expired", "assertion_failed",
]);

export function createValidationResults() {
  return Object.fromEntries(Object.keys(LABELS).map((name) => [name, "Not checked"]));
}

export function safeFailureCode(error) {
  // Node's assert module uses ERR_ASSERTION. Publish only a fixed category;
  // its message and actual/expected values may contain fiscal data.
  if (error?.code === "ERR_ASSERTION" || error?.name === "AssertionError") {
    return "assertion_failed";
  }
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
