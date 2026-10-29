// montoDescu, pagos[] and the staging 0.6 warnings: only what the SDK itself does (the server owns the rules).

import { assertEquals } from "jsr:@std/assert@1";
import { Facta, FACTA_STAGING_BASE_URL } from "../mod.ts";
import type { DteRequest } from "../mod.ts";
import { parseFactaWarning, unknownFieldWarnings } from "../src/warnings.ts";

function fake(body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; body: string | null }> = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : null });
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json", ...headers },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-01-M001P001-000000000000001", selloRecibido: "2026X", totales: { totalPagar: 100 },
};
const KEY = "facta_test_a.bbbbbbbbbbbbbbbb";

Deno.test("montoDescu and pagos travel untouched in the body", async () => {
  const { fetch, calls } = fake(SEALED);
  const request: DteRequest = {
    tipoDte: "01",
    items: [{ descripcion: "x", cantidad: 2, precioUni: 60, montoDescu: 20 }],
    pagos: [{ codigo: "01", montoPago: 40 }, { codigo: "02", montoPago: 60, referencia: "VOUCHER-0042" }],
  };
  await new Facta({ region: false, apiKey: KEY, fetch }).issue(request);
  const sent = JSON.parse(calls[0].body!);
  assertEquals(sent.items[0].montoDescu, 20);
  assertEquals(sent.pagos, request.pagos);
});

Deno.test("pagos is refused by the types on 05/06 and next to nothing else is rewritten", () => {
  // @ts-expect-error pagos does not exist on a nota de crédito (the server answers 400)
  const bad: DteRequest = { tipoDte: "05", items: [], documentosRelacionados: [], pagos: [{ codigo: "01", montoPago: 1 }] };
  assertEquals(bad.tipoDte, "05");
});

Deno.test("campo_desconocido warnings and the Facta-Warning header are surfaced on issue()", async () => {
  const { fetch } = fake({
    ...SEALED,
    advertencias: [
      { codigo: "campo_desconocido", mensaje: "El campo items[0].descuento no existe", campo: "items[0].descuento", sugerencia: "items[0].montoDescu" },
      { codigo: "plantilla_no_aplicada", mensaje: "m", campo: "representacion.plantilla.ticket", motivo: "plan" },
    ],
  }, { "Facta-Warning": "campo_desconocido; campos=1" });
  const result = await new Facta({ region: false, apiKey: KEY, fetch }).issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals(result.unknownFields, [{
    codigo: "campo_desconocido", campo: "items[0].descuento", mensaje: "El campo items[0].descuento no existe", sugerencia: "items[0].montoDescu",
  }]);
  assertEquals(result.factaWarning, { code: "campo_desconocido", count: 1 });
  assertEquals(result.advertencias?.length, 2);
  assertEquals(result.emergency, undefined, "campo_desconocido is not a durable-copy risk");
});

Deno.test("a clean response gets no warning members", async () => {
  const { fetch } = fake(SEALED);
  const result = await new Facta({ region: false, apiKey: KEY, fetch }).issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals("unknownFields" in result, false);
  assertEquals("factaWarning" in result, false);
});

Deno.test("helpers tolerate bad input", () => {
  assertEquals(unknownFieldWarnings(null), []);
  assertEquals(unknownFieldWarnings({ advertencias: ["x", { codigo: "campo_desconocido" }] }), []);
  assertEquals(parseFactaWarning(""), null);
  assertEquals(parseFactaWarning("campo_desconocido"), { code: "campo_desconocido", count: null });
  assertEquals(parseFactaWarning("campo_desconocido; campos=25"), { code: "campo_desconocido", count: 25 });
});

Deno.test("the client can target staging with FACTA_STAGING_BASE_URL", async () => {
  const { fetch, calls } = fake({ ok: true });
  await new Facta({ region: false, apiKey: KEY, baseUrl: FACTA_STAGING_BASE_URL, fetch }).status().catch(() => undefined);
  assertEquals(calls[0].url.startsWith("https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1/"), true);
});
