// Backward-compatibility fixture. It uses ONLY the public surface that 0.5.3 / 0.6.0-next.1 / 0.6.0-next.2
// shipped (no tipoVenta, aplicarRetencionIva, aplicarPercepcionIva, no PreparedDte warnings, no
// FactaError.unknownFields). `deno test` type-checks it, so a later release that renames, removes or
// narrows something an integration already uses fails here. It also passes against the 0.6.0-next.2 source.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  Facta,
  FACTA_STAGING_BASE_URL,
  FactaError,
  type CallOptions,
  type DteRequest,
  type DteType,
  type IssueResult,
  type LineItem,
  type Pago,
  type PreparedDte,
  type RelatedDocument,
  type Totals,
} from "../mod.ts";

const KEY = "facta_test_a.bbbbbbbbbbbbbbbb";
const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-01-M001P001-000000000000001", selloRecibido: "2026X", tipoDte: "01", ambiente: "00",
  totales: { totalPagar: 100 },
};
const PREPARED = {
  estado: "preparado", codigoGeneracion: SEALED.codigoGeneracion, numeroControl: SEALED.numeroControl,
  tipoDte: "01", ambiente: "00", totales: { totalPagar: 100 }, documento: {}, prepareToken: "tok",
};

function fake(handler: (url: string, init?: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return Promise.resolve(new Response(JSON.stringify(handler(String(url), init)), { status, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

Deno.test("compat: every DTE type of the old DteRequest union still type-checks and travels unchanged", async () => {
  const lines: LineItem[] = [{ descripcion: "x", cantidad: 1, precioUni: 1, montoDescu: 0.1, tipoItem: 2, uniMedida: 59, codigo: null }];
  const related: RelatedDocument[] = [{ codigoGeneracion: "gen" }];
  const pagos: Pago[] = [{ codigo: "01", montoPago: 1 }];
  const requests: DteRequest[] = [
    { tipoDte: "01", items: lines, pagos, observaciones: "o" },
    { tipoDte: "01", items: lines, receptor: null, formaPago: "01", condicionOperacion: 2, plazo: "01", periodo: 3 },
    { tipoDte: "03", items: lines, receptor: { nombre: "Cliente" } },
    { tipoDte: "05", items: lines, documentosRelacionados: related },
    { tipoDte: "06", items: lines, documentosRelacionados: related, numPagoElectronico: "T-1" },
    {
      tipoDte: "11", items: lines, exportacion: { tipoItemExpor: 1, recintoFiscal: "01", flete: 1, seguro: 1 },
      receptor: { nombre: "F", numDocumento: "1", codPais: "US", nombrePais: "United States", complemento: "M", tipoPersona: 2, descActividad: "x", correo: "a@b.c" },
    },
    {
      tipoDte: "14", items: lines, aplicarReteRenta: true,
      receptor: { numDocumento: "061234567", nombre: "S", direccion: { departamento: "06", municipio: "20", complemento: "c" } },
    },
  ];
  const { fetch, calls } = fake(() => SEALED);
  const facta = new Facta({ region: false, apiKey: KEY, fetch, baseUrl: FACTA_STAGING_BASE_URL });
  for (const request of requests) {
    const options: CallOptions = {};
    const result: IssueResult = await facta.issue(request, { ...options, idempotencyKey: "k-" + request.tipoDte });
    assertEquals(result.estado, "sellado");
  }
  assertEquals(calls.length, requests.length);
  assertEquals(calls[0].body, requests[0]);
  assert(calls[0].url.startsWith(FACTA_STAGING_BASE_URL));
  const type: DteType = "01";
  const sealed = await facta.issue(requests[0]);
  const totals: Totals | undefined = sealed.estado === "sellado" ? sealed.totales : undefined;
  assertEquals([type, totals?.totalPagar], ["01", 100]);
});

Deno.test("compat: prepare returns the same object when there is nothing to report, sign still takes it", async () => {
  const { fetch } = fake((url) => url.includes("/prepare") ? PREPARED : SEALED);
  const facta = new Facta({ region: false, apiKey: KEY, signKey: "factask_x", fetch });
  const prepared: PreparedDte = await facta.prepare({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals(prepared, PREPARED);
  assertEquals((await facta.sign(prepared)).estado, "sellado");
});

Deno.test("compat: the default base URL stays production and errors keep their old shape", async () => {
  const { fetch, calls } = fake(() => ({ error: { code: "validation_failed", message: "no", details: { issues: ["x"] } } }), 422);
  const facta = new Facta({ region: false, apiKey: KEY, fetch });
  const error = await assertRejects(() => facta.issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] }), FactaError);
  assertEquals([error.code, error.status, error.details, error.isRejection], ["validation_failed", 422, { issues: ["x"] }, false]);
  assert(!calls[0].url.startsWith(FACTA_STAGING_BASE_URL));
});
