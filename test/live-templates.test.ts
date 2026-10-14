import { assertEquals, assertRejects } from "jsr:@std/assert@1";
// @ts-ignore: plain ESM script shared with the live job
import { liveDataMarkers, pdfText, pickLiveTemplate, validateLiveTemplates } from "../scripts/live-templates.mjs";
// @ts-ignore: plain ESM script shared with the live job
import { createValidationResults, renderLiveReport } from "../scripts/live-report.mjs";

const LISTING = {
  predeterminada: { carta: "carta-a", ticket: "ticket-1" },
  plantillas: [
    { id: "carta-a", tipo: "carta", nombre: "A", origen: "catalogo", permitida: true, clavesDatos: [] },
    { id: "carta-x", tipo: "carta", nombre: "X", origen: "catalogo", permitida: false, motivo: "plan", clavesDatos: ["mesa"] },
    { id: "custom:0b8f5c3e-0000-4000-8000-000000000001", tipo: "carta", nombre: "Own", origen: "propia", permitida: true, clavesDatos: ["mesa"] },
    { id: "carta-m", tipo: "carta", nombre: "M", origen: "catalogo", permitida: true, tiposDte: ["03"], clavesDatos: ["mesa"] },
    { id: "carta-r", tipo: "carta", nombre: "R", origen: "catalogo", permitida: true, tiposDte: ["01"], clavesDatos: ["mesa", "mesero", "comensales", "filas"] },
    { id: "ticket-m", tipo: "ticket", nombre: "T", origen: "catalogo", permitida: true, clavesDatos: ["mesero", "cajero", "puntos"] },
  ],
};

Deno.test("the live check picks an allowed catalogue template of the type that prints text data", () => {
  assertEquals(pickLiveTemplate(LISTING, "carta").id, "carta-r");
  assertEquals(pickLiveTemplate(LISTING, "ticket").id, "ticket-m");
  assertEquals(pickLiveTemplate({ plantillas: [] }, "carta"), undefined);
});

Deno.test("markers are short, text-only, capped at three and derived from the run id", () => {
  const markers = liveDataMarkers([pickLiveTemplate(LISTING, "carta"), pickLiveTemplate(LISTING, "ticket")], "9876543210");
  assertEquals(Object.keys(markers), ["mesa", "mesero", "cajero"]);
  for (const value of Object.values(markers) as string[]) assertEquals(/^SDK3210[1-3]$/.test(value) && value.length <= 10, true);
});

function fakeFacta(options: { listing?: unknown; plantilla?: string | undefined; warn?: boolean; notFound?: boolean; text?: string; noHeader?: boolean }) {
  const issued: unknown[] = [];
  return {
    issued,
    facta: {
      listTemplates: () => options.notFound ? Promise.reject(Object.assign(new Error("x"), { status: 404 })) : Promise.resolve(options.listing ?? LISTING),
      issue: (request: unknown) => {
        issued.push(request);
        return Promise.resolve({
          estado: "sellado",
          ambiente: "00",
          codigoGeneracion: "CG",
          advertencias: options.warn ? [{ codigo: "plantilla_no_aplicada" }] : [],
        });
      },
      downloadDocument: (_cg: string, kind: string) =>
        Promise.resolve({ bytes: tinyPdf(options.text ?? "SDK00421 SDK00422 SDK00423"), plantilla: options.noHeader ? undefined : options.plantilla ?? (kind === "pdf" ? "carta-r" : "ticket-m") }),
    },
  };
}

Deno.test("a missing route or an unusable plan is a warning state, not a failure", async () => {
  assertEquals(await validateLiveTemplates(fakeFacta({ notFound: true }).facta, { runId: "1", log: () => {} }), "Warning (template routes not deployed on staging yet)");
  assertEquals(
    await validateLiveTemplates(fakeFacta({ listing: { plantillas: [] } }).facta, { runId: "1", log: () => {} }),
    "Not run (no permitted template with data keys)",
  );
});

Deno.test("it requests the picked templates with markers and passes when the sheets carry them", async () => {
  const ok = fakeFacta({});
  const state = await validateLiveTemplates(ok.facta, { runId: "42", log: () => {} });
  const request = ok.issued[0] as { representacion: { plantilla: unknown; datos: Record<string, string> } };
  assertEquals(request.representacion.plantilla, { carta: "carta-r", ticket: "ticket-m" });
  assertEquals(request.representacion.datos, { mesa: "SDK00421", mesero: "SDK00422", cajero: "SDK00423" });
  assertEquals(state, "Passed (template applied and data on the sheet)");
});

Deno.test("it fails when the server refuses the template, applies another one or the data is not on the sheet", async () => {
  const run = (options: Parameters<typeof fakeFacta>[0]) => validateLiveTemplates(fakeFacta(options).facta, { runId: "42", log: () => {} });
  await assertRejects(() => run({ warn: true }));
  await assertRejects(() => run({ plantilla: "carta-a" }));
  await assertRejects(() => run({ text: "nothing printed" }));
});

Deno.test("a header that is not served yet is a warning", async () => {
  assertEquals(
    await validateLiveTemplates(fakeFacta({ noHeader: true }).facta, { runId: "42", log: () => {} }),
    "Warning (applied-template header not deployed yet)",
  );
});

function tinyPdf(text: string): Uint8Array {
  const NL = String.fromCharCode(10);
  const stream = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    ["<</Length " + stream.length + ">>", "stream", stream, "endstream"].join(NL),
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = "%PDF-1.4" + NL;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += [`${index + 1} 0 obj`, body, "endobj", ""].join(NL);
  });
  const xref = out.length;
  out += ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "].join(NL) + NL;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `).join(NL) + NL;
  out += ["trailer", `<</Root 1 0 R/Size ${objects.length + 1}>>`, "startxref", String(xref), "%%EOF", ""].join(NL);
  return new TextEncoder().encode(out);
}

Deno.test("pdfText reads a real PDF's text", async () => {
  const text = await pdfText(tinyPdf("SDK00001"));
  assertEquals(text !== null && text.includes("SDK00001"), true);
});

Deno.test("the live report lists the opt-in template check and only allowlisted states", () => {
  const checks = { ...createValidationResults(), templates: "Passed (template applied and data on the sheet)" };
  const report = renderLiveReport(checks, null);
  assertEquals(report.includes("| Per-document template (opt-in: choice, applied template, data on the sheet) | Passed (template applied and data on the sheet) |"), true);
  assertEquals(renderLiveReport({ ...checks, templates: "carta-r" }, null).includes("carta-r"), false);
});
