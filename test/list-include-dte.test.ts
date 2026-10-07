import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { summarizeArchivoDte } from "../src/archivo-dte-summary.ts";
import { archivoDteFromStored } from "../src/listed-dte.ts";

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwsOf = (document: Record<string, unknown>) => `${b64url({ alg: "RS512" })}.${b64url(document)}.c2ln`;

const CG_API = "11111111-aaaa-4aaa-8aaa-000000000001";
const CG_APP = "22222222-bbbb-4bbb-8bbb-000000000002";
const CG_CONT = "33333333-cccc-4ccc-8ccc-000000000003";
const SEAL = "2026ABCDEF";
const DEST = "11111111-1111-4111-8111-111111111111";
const PATH = "DTE/pruebas/2026/10/DTE-03-M001P001-000000000000009.json";

const ccf = {
  identificacion: { codigoGeneracion: CG_APP.toUpperCase(), numeroControl: "DTE-03-M001P001-000000000000009", fecEmi: "2026-10-03", tipoDte: "03" },
  receptor: { nombre: "Comercial Ejemplo", nit: "06141234567890", nrc: "1234567" },
  cuerpoDocumento: [{ descripcion: "Equipo" }, { descripcion: "Cable" }],
  resumen: { totalPagar: 113, tributos: [{ codigo: "20", valor: 13 }] },
};
const fe = {
  identificacion: { codigoGeneracion: CG_API.toUpperCase(), numeroControl: "DTE-01-M001P001-000000000000008", fecEmi: "2026-10-03", tipoDte: "01" },
  receptor: { nombre: "María López", tipoDocumento: "13", numDocumento: "053085465" },
  cuerpoDocumento: [{ descripcion: "Café" }],
  resumen: { totalPagar: 3, totalIva: 0.35 },
};
const archivoOf = (document: Record<string, unknown>) =>
  JSON.stringify({ ...document, firmaElectronica: jwsOf(document), selloRecibido: SEAL }, null, 2);

Deno.test("summarizeArchivoDte reads the legal document: FE, CCF (tributo 20), no receiver, garbage", () => {
  assertEquals(summarizeArchivoDte(archivoOf(fe)), {
    receptor: { nombre: "María López", tipoDocumento: "13", numDocumento: "053085465" },
    lineas: 1, primeraDescripcion: "Café", totalIva: 0.35, totalPagar: 3,
  });
  assertEquals(summarizeArchivoDte(archivoOf(ccf))?.receptor, { nombre: "Comercial Ejemplo", tipoDocumento: "36", numDocumento: "06141234567890" });
  assertEquals(summarizeArchivoDte(archivoOf(ccf))?.totalIva, 13);
  assertEquals(summarizeArchivoDte(archivoOf({ ...fe, receptor: null }))?.receptor, null);
  assertEquals(summarizeArchivoDte("not json"), null);
  assertEquals(summarizeArchivoDte("{}"), null);
});

Deno.test("archivoDteFromStored accepts the app's record, the API original and a receiver file", () => {
  const record = JSON.stringify({ firma: jwsOf(ccf), documento: ccf, respuestaMh: { selloRecibido: SEAL } });
  const original = JSON.stringify({ codigoGeneracion: CG_APP, ambiente: "00", jws: jwsOf(ccf) });
  const fromRecord = archivoDteFromStored(record, null)!;
  assertEquals(JSON.parse(fromRecord).selloRecibido, SEAL);
  assertEquals(JSON.parse(fromRecord).firmaElectronica, jwsOf(ccf));
  assertEquals(JSON.parse(archivoDteFromStored(original, SEAL)!).selloRecibido, SEAL);
  assertEquals(archivoDteFromStored(original, null), null); // no seal, no Archivo DTE
  assertEquals(archivoDteFromStored(archivoOf(ccf), null), archivoOf(ccf));
});

interface Calls { urls: string[] }
function world(options: { unlockKey: boolean; apiRows: unknown[]; bucket?: Map<string, string> }) {
  const calls: Calls = { urls: [] };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.urls.push(url.pathname.replace(/^.*(?=\/v1\/dte)/, "") + url.search);
    if (url.host === "bucket.s3.us-east-1.amazonaws.com") {
      const body = options.bucket?.get(decodeURIComponent(url.pathname.slice(1)));
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    }
    if (url.pathname.endsWith("/v1/dte")) return Response.json({ documentos: options.apiRows, siguiente: null });
    throw new Error("unexpected route " + url);
  }) as typeof fetch;
  const facta = new Facta({
    region: false, apiKey: "facta_test_x.secret", fetch: fetcher, maxRetries: 0,
    ...(options.unlockKey ? { unlockKey: "factauk_test" } : {}),
  });
  facta.syncDestinations = async () => ({
    version: 1,
    destinos: [{ id: DEST, kind: "s3", label: "Bucket", secret: JSON.stringify({ bucket: "bucket", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret" }) }],
  }) as never;
  return { facta, calls };
}

const base = (code: string, numero: string) => ({ estado: "sellado", codigoGeneracion: code, numeroControl: numero, tipoDte: "01", fecEmi: "2026-10-03", selloRecibido: SEAL });
const apiRow = { ...base(CG_API, "DTE-01-M001P001-000000000000008"), archivoDte: archivoOf(fe), receptor: { nombre: null, numDocumento: null } };
const appRow = {
  ...base(CG_APP, "DTE-03-M001P001-000000000000009"),
  receptor: { nombre: null, numDocumento: null },
  dteError: { code: "needs_local_decrypt", message: "x", destinos: [{ id: DEST, rutaJson: PATH, verificada: true }] },
};

Deno.test("with unlockKey a needs_local_decrypt row is completed from the destination: same shape as an API-readable row", async () => {
  const bucket = new Map([[PATH, JSON.stringify({ firma: jwsOf(ccf), documento: ccf, respuestaMh: { selloRecibido: SEAL } })]]);
  const { facta, calls } = world({ unlockKey: true, apiRows: [apiRow, appRow], bucket });
  const page = await facta.listDocuments({ include: ["dte"], limit: 20 });
  assert(calls.urls[0]!.includes("include=dte") && calls.urls[0]!.includes("limit=20"));
  for (const row of page.documentos) {
    assertEquals(typeof row.archivoDte, "string");
    assertEquals(row.dteError, undefined);
    assertEquals(Object.keys(row.resumen!).sort(), ["lineas", "primeraDescripcion", "receptor", "totalIva", "totalPagar"]);
  }
  assertEquals(page.documentos[1]!.resumen!.receptor!.nombre, "Comercial Ejemplo");
});

Deno.test("without unlockKey the row keeps a dteError that says the unlock key is needed", async () => {
  const { facta } = world({ unlockKey: false, apiRows: [apiRow, appRow] });
  const page = await facta.listDocuments({ include: ["dte"] });
  assertEquals(typeof page.documentos[0]!.archivoDte, "string");
  const row = page.documentos[1]!;
  assertEquals(row.archivoDte, undefined);
  assertEquals(row.dteError!.code, "needs_local_decrypt");
  assert(row.dteError!.message.includes("unlockKey"));
});

Deno.test("an unreadable destination never fails the listing", async () => {
  const { facta } = world({ unlockKey: true, apiRows: [apiRow, appRow], bucket: new Map() });
  const page = await facta.listDocuments({ include: ["dte"] });
  assertEquals(page.documentos[1]!.dteError!.code, "destination_read_failed");
  assertEquals(typeof page.documentos[0]!.resumen, "object");
});

Deno.test("a server that predates the flag leaves rows untouched; without include nothing is added", async () => {
  const plain = { ...base(CG_CONT, "DTE-01-M001P001-000000000000010") };
  const { facta, calls } = world({ unlockKey: true, apiRows: [plain] });
  const withFlag = await facta.listDocuments({ include: ["dte"] });
  assertEquals(withFlag.documentos[0] as unknown, plain as unknown);
  await facta.listDocuments({});
  assertEquals(calls.urls[1], "/v1/dte");
});

Deno.test("include_limit_exceeded is passed through as the server's code", async () => {
  const fetcher = (() => Promise.resolve(Response.json({ error: { code: "include_limit_exceeded", message: "max 25", details: { maximo: 25 } } }, { status: 400 }))) as typeof fetch;
  const facta = new Facta({ region: false, apiKey: "facta_test_x.secret", fetch: fetcher, maxRetries: 0 });
  const error = await assertRejects(() => facta.listDocuments({ include: ["dte"], limit: 30 })) as { code: string };
  assertEquals(error.code, "include_limit_exceeded");
});

Deno.test("the server handler projects resumen under the same exposure and masking as receptor", async () => {
  const { projectPage } = await import("../src/server/capabilities.ts");
  const row = {
    ...base(CG_API, "DTE-01-M001P001-000000000000008"),
    resumen: summarizeArchivoDte(archivoOf(fe)),
    dteError: undefined,
  };
  const hidden = projectPage({ documentos: [row as never], siguiente: null }, { exposeRecipient: false }) as { documentos: Array<Record<string, any>> };
  assertEquals("receptor" in hidden.documentos[0]!.resumen, false);
  assertEquals(hidden.documentos[0]!.resumen.primeraDescripcion, "Café");
  const shown = projectPage({ documentos: [row as never], siguiente: null }, { exposeRecipient: true }) as { documentos: Array<Record<string, any>> };
  assertEquals(shown.documentos[0]!.resumen.receptor.nombre, "María López");
  assertEquals(shown.documentos[0]!.resumen.receptor.numDocumento, "0530 ••••• 5");
});
