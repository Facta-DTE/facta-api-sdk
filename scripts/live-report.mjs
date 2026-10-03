const LABELS = Object.freeze({
  status: "Staging API and test environment",
  preflight: "Issuance permissions and readiness",
  emission: "Invoice generated and sealed",
  archive: "Encrypted local archive",
  "signed-json": "Signed JSON received and validated",
  pdf: "PDF received and validated",
  "inline-bytes": "Exact server bytes preserved",
  "no-downloads": "No repeated file downloads",
  query: "Invoice consultation",
  listing: "Invoice listing",
  journal: "Completed operation journal",
});
const STATES = new Set(["Not checked", "Failed", "Passed", "Passed (sealed test FE, $0.01)"]);
const ERROR_CODES = new Set([
  "not_found", "service_unavailable", "invalid_request", "unauthorized",
  "forbidden", "rate_limit_exceeded", "archive_integrity_error", "validation_failed",
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
