import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  assertRelatedTestDocuments,
  assertLiveRunWithinIdempotencyWindow,
  assessLiveDteFixtureMatrix,
  LIVE_DTE_SUPPORTED_TYPES,
  parseLiveDteFixtures,
  relatedGenerationCodes,
  requireCompleteLiveDteFixtureMatrix,
} from "../scripts/live-dte-fixtures.mjs";

const relatedCode = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const fixture = (tipoDte: string, fields: Record<string, unknown> = {}) => ({
  tipoDte,
  ...fields,
  items: [{ descripcion: "Facta API SDK integration test", cantidad: 1, precioUni: 0.01 }],
});

Deno.test("fixture parser accepts only explicitly configured non-FE DTEs with bounded test lines", () => {
  const input = {
    "03": fixture("03", { receptor: {
      nombre: "Private fixture recipient", tipoDocumento: "36", numDocumento: "PRIVATE-NIT", nrc: "PRIVATE-NRC",
      codActividad: "12345", descActividad: "Fixture", direccion: { departamento: "06", municipio: "20", complemento: "Test address" },
    } }),
    "05": fixture("05", { documentosRelacionados: [{ codigoGeneracion: relatedCode }] }),
    "06": fixture("06", { documentosRelacionados: [{ codigoGeneracion: relatedCode }] }),
    "11": fixture("11", { receptor: {
      nombre: "Foreign test recipient", numDocumento: "PRIVATE-DOC", codPais: "US", nombrePais: "United States",
      complemento: "Fixture address", descActividad: "Fixture", correo: "fixture@example.invalid",
    }, exportacion: { tipoItemExpor: 1 } }),
    "14": fixture("14", { receptor: { nombre: "Excluded subject", numDocumento: "PRIVATE-ID", direccion: { departamento: "06", municipio: "20", complemento: "Test address" } } }),
  };
  const parsed = parseLiveDteFixtures(JSON.stringify(input));
  assertEquals(Object.keys(parsed).sort(), ["03", "05", "06", "11", "14"]);
  assertEquals(relatedGenerationCodes(parsed), [relatedCode]);
  assertEquals(JSON.stringify(parsed).includes("PRIVATE-NIT"), true);
});

Deno.test("DTE fixture validation fails closed for mismatched or high-value requests", async () => {
  const malformed = [
    { "03": fixture("14") },
    { "03": fixture("03", { items: [{ descripcion: "Facta API SDK integration test", cantidad: 1, precioUni: 900 }] }) },
    { "05": fixture("05", { documentosRelacionados: [{ codigoGeneracion: "not-a-uuid" }] }) },
    { "01": fixture("01") },
  ];
  for (const value of malformed) {
    const caught = await assertRejects(() => Promise.resolve().then(() => parseLiveDteFixtures(JSON.stringify(value))), Error);
    assertEquals((caught as Error & { code: string }).code, "fixture_invalid");
  }
  const malformedJson = await assertRejects(() => Promise.resolve().then(() => parseLiveDteFixtures("PRIVATE JSON")), Error);
  assertEquals((malformedJson as Error & { code: string }).code, "fixture_invalid");
});

Deno.test("DTE matrix reports fixed permission and fixture states without exposing data", async () => {
  const fixtures = parseLiveDteFixtures(JSON.stringify({ "03": fixture("03", { receptor: {
    nombre: "PRIVATE", tipoDocumento: "36", numDocumento: "PRIVATE", nrc: "PRIVATE", codActividad: "1", descActividad: "Private",
    direccion: { departamento: "06", municipio: "20", complemento: "PRIVATE" },
  } }) }));
  const status = { llave: { alcances: ["issue"], tiposDte: ["01", "03"] } };
  const matrix = assessLiveDteFixtureMatrix(status, fixtures);
  assertEquals(LIVE_DTE_SUPPORTED_TYPES, ["01", "03", "05", "06", "11", "14"]);
  assertEquals(matrix["01"], "Ready (baseline test only)");
  assertEquals(matrix["03"], "Ready (fixture configured)");
  assertEquals(matrix["05"], "Blocked (permission unavailable)");
  assertEquals(matrix["11"], "Blocked (permission unavailable)");
  await assertRejects(() => Promise.resolve().then(() => requireCompleteLiveDteFixtureMatrix(matrix)), Error);
  assertEquals(JSON.stringify(matrix).includes("PRIVATE"), false);
});

Deno.test("related note fixtures require the exact sealed test document in environment 00", () => {
  const fixtures = parseLiveDteFixtures(JSON.stringify({ "05": fixture("05", { documentosRelacionados: [{ codigoGeneracion: relatedCode }] }) }));
  assertRelatedTestDocuments(fixtures, [{ codigoGeneracion: relatedCode.toLowerCase(), ambiente: "00", estado: "sellado" }]);
  for (const invalidStatus of [
    { codigoGeneracion: relatedCode, ambiente: "01", estado: "sellado" },
    { codigoGeneracion: relatedCode, ambiente: "00", estado: "invalidado" },
    { codigoGeneracion: "00000000-0000-0000-0000-000000000000", ambiente: "00", estado: "sellado" },
  ]) {
    let caught: unknown;
    try { assertRelatedTestDocuments(fixtures, [invalidStatus]); } catch (error) { caught = error; }
    if (!(caught instanceof Error)) throw new Error("Expected related-document preflight to reject the fixture.");
    assertEquals((caught as Error & { code: string }).code, "related_document_invalid");
  }
});

Deno.test("workflow reruns fail closed outside the server idempotency window", () => {
  const createdAt = "2026-10-03T00:00:00.000Z";
  assertLiveRunWithinIdempotencyWindow(createdAt, Date.parse(createdAt) + 60_000);
  for (const invalid of ["not-a-date", "2026-10-04T00:00:00.000Z", "2026-10-03T00:00:00.000Z"]) {
    let caught: unknown;
    try { assertLiveRunWithinIdempotencyWindow(invalid, Date.parse("2026-10-03T23:30:00.000Z")); } catch (error) { caught = error; }
    if (!(caught instanceof Error)) throw new Error("Expected old or invalid run time to fail closed.");
    assertEquals((caught as Error & { code: string }).code, "idempotency_window_expired");
  }
});
