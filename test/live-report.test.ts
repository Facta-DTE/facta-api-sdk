import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createValidationResults, renderLiveReport, safeFailureCode } from "../scripts/live-report.mjs";

Deno.test("public live report contains validation results without invoice fields or links", () => {
  const checks = createValidationResults();
  checks.emission = "Passed (sealed test FE, $0.01)";
  checks.pdf = "Passed";
  checks["signed-json"] = "Passed";
  checks.query = "Failed";
  const report = renderLiveReport(checks, "service_unavailable");
  assertStringIncludes(report, "| PDF received and validated | Passed |");
  assertStringIncludes(report, "| Invoice consultation | Failed |");
  assertEquals(report.includes("http"), false);
  assertEquals(report.includes("artifact"), false);
  assertEquals(report.includes("codigoGeneracion"), false);
});

Deno.test("public live report rejects private fields, injected states and raw errors", () => {
  const privateValue = "PRIVATE-NIT-NAME-ADDRESS-JWS-PDF";
  const checks = { ...createValidationResults(), pdf: privateValue, emisor: privateValue };
  const report = renderLiveReport(checks, privateValue);
  assertEquals(report.includes(privateValue), false);
  assertStringIncludes(report, "| PDF received and validated | Not checked |");
  assertStringIncludes(report, "validation_failed");
  assertEquals(safeFailureCode({ code: privateValue, message: privateValue }), "validation_failed");
  assertEquals(safeFailureCode({ code: "service_unavailable", message: privateValue }), "service_unavailable");
});

Deno.test("public workflow never uploads invoice artifacts and live script never persists cleartext invoice files", async () => {
  const workflow = await Deno.readTextFile(new URL("../.github/workflows/sdk-live-integration.yml", import.meta.url));
  const script = await Deno.readTextFile(new URL("../scripts/live-integration.mjs", import.meta.url));
  assertEquals(workflow.includes("actions/upload-artifact"), false);
  assertEquals(workflow.includes("ARTIFACT_URL"), false);
  assertEquals(script.includes('join(reportDir, "invoice.'), false);
  assertEquals(script.includes("assert.deepEqual"), false);
  assertEquals(script.includes("JSON.stringify(readiness)"), false);
  assertStringIncludes(script, "renderLiveReport(checks, failureCode)");
});

Deno.test("public live report contains a fixed safe row for each supported DTE variant", () => {
  const report = renderLiveReport(createValidationResults());
  for (const type of ["01", "03", "05", "06", "11", "14"]) {
    assertStringIncludes(report, `| DTE ${type} `);
  }
  assertEquals(report.includes("STAGING_FACTA_DTE_FIXTURES_JSON"), false);
  assertEquals(report.includes("PRIVATE"), false);
});

Deno.test("catalog and destination capabilities are positive only after snapshots open", () => {
  const checks = createValidationResults();
  checks.catalog = "Passed";
  checks.destinations = "Failed";
  const report = renderLiveReport(checks);
  assertStringIncludes(report, "| Encrypted catalog snapshot opened locally | Passed |");
  assertStringIncludes(report, "| Encrypted destination snapshot opened locally | Failed |");
});

Deno.test("managed live result labels cannot expose copy digests, locations or raw failures", () => {
  const privateValue = "PRIVATE-HASH-LOCATION-INVOICE";
  const report = renderLiveReport({ ...createValidationResults(), "managed-readback": privateValue, storageErrorCode: privateValue }, privateValue);
  assertEquals(report.includes(privateValue), false);
  assertStringIncludes(report, "| Exact managed copy read-back | Not checked |");
});
