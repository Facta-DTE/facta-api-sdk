// descuentoGlobal on the wire, unknown-field warnings on drafts, and the signed-but-not-transmitted 503.
// Only what the SDK itself does: the server owns the arithmetic and the refusals.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta, FactaError } from "../mod.ts";
import type { DteRequest, GlobalDiscount, SignedNotTransmitted, Status, UnknownFieldWarning } from "../mod.ts";

interface Call { method: string; path: string; body: unknown; headers: Headers }

function harness(routes: (call: Call, n: number) => Response, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^.*\/v1/, "/v1"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return Promise.resolve(routes(call, calls.length));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0, clock: false, region: false, ...extra }) };
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
const err = (code: string, status: number, details?: unknown) =>
  json({ error: { code, message: code, ...(details === undefined ? {} : { details }) } }, status);

const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-01-M001P001-000000000000001", selloRecibido: "2026X",
  totales: { totalPagar: 18, totalDescu: 2 },
};
const DRAFT = { borradorId: "11111111-1111-4111-8111-111111111111", estado: "pendiente", version: 1, totales: { totalPagar: 18 } };
const TYPO: UnknownFieldWarning[] = [
  { codigo: "campo_desconocido", mensaje: "El campo descuento no existe", campo: "descuento", sugerencia: "descuentoGlobal" },
  { codigo: "campo_desconocido", mensaje: "El campo items[0].descuento no existe", campo: "items[0].descuento", sugerencia: "items[0].montoDescu" },
];
const WARNED = { "Facta-Warning": "campo_desconocido; campos=2" };

// --- descuentoGlobal ---------------------------------------------------------------------------

Deno.test("descuentoGlobal travels untouched on issue, prepare and createDraft for 01, 03, 11 and 14", async () => {
  const { facta, calls } = harness((call) => call.path === "/v1/drafts" ? json(DRAFT, 201) : json(SEALED));
  const percent: GlobalDiscount = { modo: "porcentaje", valor: 10 };
  const amount: GlobalDiscount = { modo: "monto", valor: 12.5 };
  const requests: DteRequest[] = [
    { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 10, precioUni: 2 }], descuentoGlobal: percent },
    { tipoDte: "03", receptor: { customerId: "374114b6-e957-4c7a-8911-dd6381b1e0ea" }, items: [{ descripcion: "Integración", cantidad: 1, precioUni: 125 }], descuentoGlobal: amount },
    {
      tipoDte: "11",
      receptor: { nombre: "Buyer Inc.", tipoDocumento: "37", numDocumento: "X1", direccion: { pais: "9450", complemento: "Main St" } } as never,
      exportacion: { tipoItemExpor: 2 },
      items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 100 }],
      descuentoGlobal: amount,
    },
    { tipoDte: "14", receptor: { nombre: "Ana", tipoDocumento: "13", numDocumento: "012345678" } as never, items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 50 }], descuentoGlobal: percent },
    { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }], descuentoGlobal: null },
  ];
  for (const request of requests) await facta.issue(request);
  await facta.prepare(requests[0]);
  await facta.createDraft({ ...(requests[1] as object) });
  const bodies = calls.map((call) => (call.body as Record<string, unknown>)["descuentoGlobal"]);
  assertEquals(bodies, [percent, amount, amount, percent, null, percent, amount]);
});

Deno.test("global_discount_not_supported on a note is passed through, typed, and never retried", async () => {
  const { facta, calls } = harness(() => err("global_discount_not_supported", 400, { field: "descuentoGlobal", supported: ["01", "03", "11", "14"] }), { maxRetries: 3 });
  const note = {
    tipoDte: "05", items: [{ descripcion: "Devolución", cantidad: 1, precioUni: 10 }],
    documentosRelacionados: [{ codigoGeneracion: SEALED.codigoGeneracion }],
    descuentoGlobal: { modo: "monto", valor: 1 },
  } as DteRequest;
  const error = await assertRejects(() => facta.issue(note), FactaError);
  assertEquals(error.code, "global_discount_not_supported");
  assertEquals(error.status, 400);
  assertEquals(calls.length, 1);
  assertEquals(error.spent, null);
});

Deno.test("a discount above the subtotal is invalid_request with details.field and details.subtotal", async () => {
  const { facta } = harness(() => err("invalid_request", 400, { field: "descuentoGlobal", subtotal: 20, valor: 25 }));
  const error = await assertRejects(
    () => facta.issue({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 10, precioUni: 2 }], descuentoGlobal: { modo: "monto", valor: 25 } }),
    FactaError,
  );
  assertEquals(error.code, "invalid_request");
  assertEquals((error.details as Record<string, unknown>)["field"], "descuentoGlobal");
  assertEquals((error.details as Record<string, unknown>)["subtotal"], 20);
});

Deno.test("descuentoGlobal is typed: modo is an enum and valor a number", () => {
  // @ts-expect-error modo must be «monto» or «porcentaje» (the server answers 400 on descuentoGlobal.modo)
  const badMode: DteRequest = { tipoDte: "01", items: [], descuentoGlobal: { modo: "percent", valor: 10 } };
  // @ts-expect-error valor is a number
  const badValue: DteRequest = { tipoDte: "01", items: [], descuentoGlobal: { modo: "monto", valor: "10" } };
  // @ts-expect-error modo is required: there is no default
  const noMode: DteRequest = { tipoDte: "01", items: [], descuentoGlobal: { valor: 10 } };
  assertEquals([badMode.tipoDte, badValue.tipoDte, noMode.tipoDte], ["01", "01", "01"]);
});

Deno.test("status() exposes capabilities.descuentoGlobal and fseIncomeWithholdingPerLine", async () => {
  const body = {
    ok: true, version: "v1", ambiente: "00", emisor: null, llave: null,
    capabilities: { descuentoGlobal: true, fseIncomeWithholdingPerLine: true, somethingNewer: 3 },
  };
  const { facta } = harness(() => json(body));
  const status: Status = await facta.status();
  assertEquals(status.capabilities?.descuentoGlobal, true);
  assertEquals(status.capabilities?.fseIncomeWithholdingPerLine, true);
  assertEquals(status.capabilities?.["somethingNewer"], 3);
  const older = await harness(() => json({ ...body, capabilities: undefined })).facta.status();
  assertEquals(older.capabilities?.descuentoGlobal === true, false);
});

// --- Drafts: advertencias and Facta-Warning ---------------------------------------------------

Deno.test("createDraft surfaces campo_desconocido warnings and the Facta-Warning header", async () => {
  const { facta } = harness(() => json({ ...DRAFT, advertencias: TYPO }, 201, WARNED));
  const draft = await facta.createDraft({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 2, descuento: 1 }], descuento: 1 });
  assertEquals(draft.id, DRAFT.borradorId);
  assertEquals(draft.unknownFields, TYPO);
  assertEquals(draft.factaWarning, { code: "campo_desconocido", count: 2 });
});

Deno.test("a replayed createDraft reports the same warnings again", async () => {
  const { facta, calls } = harness((_, n) => json({ ...DRAFT, ...(n > 1 ? { repetida: true } : {}), advertencias: TYPO }, n > 1 ? 200 : 201, WARNED));
  const first = await facta.createDraft({ tipoDte: "01", items: [], descuento: 1 }, { idempotencyKey: "order-1" });
  const replay = await facta.createDraft({ tipoDte: "01", items: [], descuento: 1 }, { idempotencyKey: "order-1" });
  assertEquals(calls.map((call) => call.headers.get("idempotency-key")), ["order-1", "order-1"]);
  assertEquals(replay.unknownFields, first.unknownFields);
  assertEquals(replay.factaWarning, first.factaWarning);
});

Deno.test("updateDraft surfaces the warnings of the new version", async () => {
  const { facta, calls } = harness(() =>
    json({ borradorId: DRAFT.borradorId, estado: "pendiente", version: 2, tipoDte: "01", totales: {}, referencia: null, advertencias: TYPO.slice(1) }, 200, { "Facta-Warning": "campo_desconocido; campos=1" })
  );
  const draft = await facta.updateDraft(DRAFT.borradorId, 1, { tipoDte: "01", items: [] });
  assertEquals(calls[0]?.method, "PUT");
  assertEquals(calls[0]?.headers.get("if-match"), "1");
  assertEquals(draft.version, 2);
  assertEquals(draft.unknownFields, TYPO.slice(1));
  assertEquals(draft.factaWarning, { code: "campo_desconocido", count: 1 });
});

Deno.test("a clean draft response carries no warning members", async () => {
  const { facta } = harness(() => json(DRAFT, 201));
  const draft = await facta.createDraft({ tipoDte: "01", items: [] });
  assertEquals("unknownFields" in draft, false);
  assertEquals("factaWarning" in draft, false);
});

Deno.test("a refused draft carries the warnings on the error", async () => {
  const { facta } = harness(() => {
    const response = err("validation_failed", 422, { field: "items", advertencias: TYPO });
    response.headers.set("Facta-Warning", "campo_desconocido; campos=2");
    return response;
  });
  const error = await assertRejects(() => facta.createDraft({ tipoDte: "01", items: [], descuento: 1 }), FactaError);
  assertEquals(error.code, "validation_failed");
  assertEquals(error.unknownFields, TYPO);
});

Deno.test("issueDraft surfaces the warnings like issue()", async () => {
  const { facta } = harness(() => json({ ...SEALED, borradorId: DRAFT.borradorId, advertencias: TYPO.slice(0, 1) }, 200, { "Facta-Warning": "campo_desconocido; campos=1" }));
  const result = await facta.issueDraft(DRAFT.borradorId, 1, { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }] });
  assertEquals(result.borradorId, DRAFT.borradorId);
  assertEquals(result.unknownFields, TYPO.slice(0, 1));
  assertEquals(result.factaWarning, { code: "campo_desconocido", count: 1 });
});

// --- 503 signed, not transmitted ---------------------------------------------------------------

const NOT_SENT: SignedNotTransmitted = {
  estado: "firmado_sin_transmitir",
  confirmado: true,
  siguientePaso: "POST /v1/dte/{codigoGeneracion}/reintentar",
  codigoGeneracion: SEALED.codigoGeneracion,
  numeroControl: SEALED.numeroControl,
};

Deno.test("a signed-but-not-transmitted 503 is typed, keeps the spent number and is not retried", async () => {
  const { facta, calls } = harness(() => err("service_unavailable", 503, NOT_SENT), { maxRetries: 3 });
  const error = await assertRejects(
    () => facta.issue({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }] }, { idempotencyKey: "sale-9" }),
    FactaError,
  );
  assertEquals(calls.length, 1, "replaying the same key only returns the same 503");
  assertEquals(error.code, "service_unavailable");
  assertEquals(error.spent, { codigoGeneracion: SEALED.codigoGeneracion, numeroControl: SEALED.numeroControl });
  assertEquals(error.signedNotTransmitted, NOT_SENT);
});

Deno.test("an unconfirmed signature reads confirmado false; the retry route finishes it", async () => {
  const { facta, calls } = harness((call) =>
    call.path === "/v1/dte" ? err("service_unavailable", 503, { ...NOT_SENT, confirmado: false }) : json({ ...SEALED, via: "retransmision" })
  , { signKey: "sign-password" });
  const error = await assertRejects(() => facta.issue({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }] }), FactaError);
  const pending = error.signedNotTransmitted;
  assert(pending !== null);
  assertEquals(pending.confirmado, false);
  await facta.retryDocument(pending.codigoGeneracion);
  assertEquals(calls.map((call) => `${call.method} ${call.path}`), ["POST /v1/dte", `POST /v1/dte/${SEALED.codigoGeneracion}/reintentar`]);
});

Deno.test("any other 503 is still retried and has no signedNotTransmitted", async () => {
  const { facta, calls } = harness((_, n) => n === 1 ? err("service_unavailable", 503, { retryAfterSeconds: 0.001 }) : json(SEALED), { maxRetries: 1 });
  await facta.issue({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }] });
  assertEquals(calls.length, 2);
  assertEquals(new FactaError("service_unavailable", "x", 503, { retryAfterSeconds: 5 }).signedNotTransmitted, null);
  assertEquals(new FactaError("mh_rejected", "x", 502, NOT_SENT).signedNotTransmitted, null);
  assertEquals(new FactaError("service_unavailable", "x", 503, { estado: "firmado_sin_transmitir" }).signedNotTransmitted, null);
});
