// tipoVenta, aplicarRetencionIva / aplicarPercepcionIva, and warnings on prepare() and FactaError.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta, FactaError } from "../mod.ts";
import type { DteRequest } from "../mod.ts";

const KEY = "facta_test_a.bbbbbbbbbbbbbbbb";
function fake(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Array<{ body: string | null }> = [];
  const fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: typeof init?.body === "string" ? init.body : null });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const PREPARED = { estado: "preparado", codigoGeneracion: "G", numeroControl: "N", tipoDte: "03", ambiente: "00", totales: {}, documento: {}, prepareToken: "t" };
const WARNING = { codigo: "campo_desconocido" as const, mensaje: "m", campo: "items[0].descuento", sugerencia: "items[0].montoDescu" };

Deno.test("tipoVenta and the VAT withholding/perception flags travel untouched", async () => {
  const { fetch, calls } = fake(PREPARED);
  const facta = new Facta({ region: false, apiKey: KEY, fetch });
  const ccf: DteRequest = {
    tipoDte: "03", receptor: { nombre: "C" }, aplicarRetencionIva: true, aplicarPercepcionIva: true,
    items: [{ descripcion: "x", cantidad: 1, precioUni: 10, tipoVenta: "exenta" }, { descripcion: "y", cantidad: 1, precioUni: 5, tipoVenta: "no_sujeta" }],
  };
  const fe: DteRequest = { tipoDte: "01", aplicarRetencionIva: false, items: [{ descripcion: "x", cantidad: 1, precioUni: 1, tipoVenta: "gravada" }] };
  await facta.prepare(ccf);
  await facta.prepare(fe);
  assertEquals(JSON.parse(calls[0].body!), ccf);
  assertEquals(JSON.parse(calls[1].body!), fe);
});

Deno.test("own fields are refused by the types on the other DTE types", () => {
  // @ts-expect-error aplicarPercepcionIva exists only on the CCF (03)
  const a: DteRequest = { tipoDte: "01", items: [], aplicarPercepcionIva: true };
  // @ts-expect-error aplicarRetencionIva exists only on 01 and 03
  const b: DteRequest = { tipoDte: "14", items: [], receptor: { numDocumento: "1", nombre: "n", direccion: { departamento: "06", municipio: "20", complemento: "c" } }, aplicarRetencionIva: true };
  // @ts-expect-error not on a nota de crédito
  const c: DteRequest = { tipoDte: "05", items: [], documentosRelacionados: [], aplicarRetencionIva: true };
  assertEquals([a.tipoDte, b.tipoDte, c.tipoDte], ["01", "14", "05"]);
});

Deno.test("prepare() reports campo_desconocido and the Facta-Warning header only when present", async () => {
  const withWarning = fake({ ...PREPARED, advertencias: [WARNING] }, 200, { "Facta-Warning": "campo_desconocido; campos=1" });
  const prepared = await new Facta({ region: false, apiKey: KEY, fetch: withWarning.fetch }).prepare({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals(prepared.unknownFields, [WARNING]);
  assertEquals(prepared.factaWarning, { code: "campo_desconocido", count: 1 });
  const clean = fake(PREPARED);
  const plain = await new Facta({ region: false, apiKey: KEY, fetch: clean.fetch }).prepare({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals("unknownFields" in plain || "factaWarning" in plain, false);
});

Deno.test("FactaError.unknownFields reads details.advertencias", async () => {
  const { fetch } = fake({ error: { code: "validation_failed", message: "no", details: { issues: ["x"], advertencias: [WARNING] } } }, 422);
  const error = await assertRejects(
    () => new Facta({ region: false, apiKey: KEY, fetch }).issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] }),
    FactaError,
  );
  assertEquals(error.unknownFields, [WARNING]);
  const none = fake({ error: { code: "validation_failed", message: "no" } }, 422);
  const e2 = await assertRejects(() => new Facta({ region: false, apiKey: KEY, fetch: none.fetch }).issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] }), FactaError);
  assertEquals(e2.unknownFields, []);
});
