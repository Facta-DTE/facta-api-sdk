// Non-taxed charge/credit lines (`items[].noGravado`, Manual Funcional v2.0 §XII).
// The server places and sums them; the SDK types the line and refuses, before sending,
// the shapes the server would refuse with the same code.

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { assertNonTaxedLines, Facta, FactaError, isNonTaxedLine, NON_TAXED_DTE_TYPES } from "../mod.ts";
import type { DteRequest, NonTaxedLine, Status, Totals } from "../mod.ts";
import { exportWithReimbursement, loanInstalmentCcf } from "../examples/non-taxed-lines.ts";

interface Call { method: string; path: string; body: unknown }

function harness(routes: (call: Call) => Response, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^.*\/v1/, "/v1"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return Promise.resolve(routes(call));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0, clock: false, region: false, ...extra }) };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const err = (code: string, status: number, details?: unknown) => json({ error: { code, message: code, ...(details === undefined ? {} : { details }) } }, status);

const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-03-M001P001-000000000000001", selloRecibido: "2026X",
  totales: { totalExenta: 1250, totalPagar: 51250, totalNoGravado: 50000 },
};
const DRAFT = { borradorId: "11111111-1111-4111-8111-111111111111", estado: "pendiente", version: 1 };
const SALE = { descripcion: "Intereses", cantidad: 1, precioUni: 1250, tipoVenta: "exenta" as const };
const CAPITAL: NonTaxedLine = { descripcion: "Capital", noGravado: 50000, tipoItem: 2, codigo: "CAP" };
const RELATED = [{ codigoGeneracion: SEALED.codigoGeneracion }];

function localError(fn: () => unknown, code: string): FactaError {
  const error = assertThrows(fn, FactaError);
  assertEquals(error.code, code);
  assertEquals(error.status, 0, "a local refusal never reached the server");
  assertEquals((error.details as Record<string, unknown>)["local"], true);
  return error;
}

Deno.test("a non-taxed line travels untouched on issue, prepare and drafts for 01, 03, 05, 06 and 11", async () => {
  const { facta, calls } = harness((call) => call.path.startsWith("/v1/drafts") ? json(DRAFT, 201) : json(SEALED));
  const requests: DteRequest[] = [
    { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2 }, { descripcion: "Propina", noGravado: 0.5, tipoItem: 2 }] },
    loanInstalmentCcf,
    { tipoDte: "05", documentosRelacionados: RELATED, items: [{ descripcion: "Devolución", cantidad: 1, precioUni: 10 }, { descripcion: "Abono de flete", noGravado: -2.25, tipoItem: 2 }] },
    { tipoDte: "06", documentosRelacionados: RELATED, items: [{ descripcion: "Ajuste", cantidad: 1, precioUni: 10 }, { descripcion: "Cargo administrativo", noGravado: 3, tipoItem: 2 }] },
    exportWithReimbursement,
  ];
  for (const request of requests) await facta.issue(request);
  await facta.prepare(loanInstalmentCcf);
  await facta.createDraft({ ...(loanInstalmentCcf as object) });
  await facta.updateDraft(DRAFT.borradorId, 1, { ...(loanInstalmentCcf as object) });
  assertEquals(calls.length, 8);
  const lines = calls.map((call) => ((call.body as Record<string, unknown>)["items"] as unknown[]).filter(isNonTaxedLine));
  assertEquals(lines[1], [CAPITAL]);
  assertEquals(lines[2], [{ descripcion: "Abono de flete", noGravado: -2.25, tipoItem: 2 }]);
  assertEquals(lines[4], [{ descripcion: "Reembolso de gastos de courier", noGravado: 35.4, tipoItem: 2 }]);
  assertEquals(lines.slice(5), [[CAPITAL], [CAPITAL], [CAPITAL]]);
});

Deno.test("type 14 refuses a non-taxed line locally with non_taxed_not_supported, nothing sent", async () => {
  const { facta, calls } = harness(() => json(SEALED));
  const fse = {
    tipoDte: "14",
    receptor: { nombre: "Ana", numDocumento: "012345678", direccion: { departamento: "06", municipio: "20", complemento: "x" } },
    items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 50 }, CAPITAL],
  } as unknown as DteRequest;
  const error = await assertRejects(() => facta.issue(fse), FactaError);
  assertEquals(error.code, "non_taxed_not_supported");
  assertEquals(error.status, 0);
  assertEquals((error.details as Record<string, unknown>)["supported"], ["01", "03", "05", "06", "11"]);
  assertEquals((error.details as Record<string, unknown>)["field"], "items[1].noGravado");
  await assertRejects(() => facta.prepare(fse), FactaError);
  await assertRejects(() => facta.createDraft({ ...(fse as object) }), FactaError);
  for (const tipoDte of ["07", "15"]) localError(() => assertNonTaxedLines({ ...fse, tipoDte }), "non_taxed_not_supported");
  assertEquals(calls.length, 0);
  assertEquals([...NON_TAXED_DTE_TYPES], ["01", "03", "05", "06", "11"]);
});

Deno.test("a document whose only lines are non-taxed is refused locally with non_taxed_requires_sale_line", async () => {
  const { facta, calls } = harness(() => json(SEALED));
  const error = await assertRejects(() => facta.issue({ tipoDte: "03", receptor: { customerId: "c" }, items: [CAPITAL] }), FactaError);
  assertEquals(error.code, "non_taxed_requires_sale_line");
  assertEquals((error.details as Record<string, unknown>)["field"], "items[0].noGravado", "the server names the first non-taxed line");
  localError(() => assertNonTaxedLines({ tipoDte: "01", items: [{ descripcion: "Gratis", cantidad: 1, precioUni: 0 }, CAPITAL] }), "non_taxed_requires_sale_line");
  // A productId line has no local price: the server decides.
  assertNonTaxedLines({ tipoDte: "01", items: [{ productId: "p-1", cantidad: 1 }, CAPITAL] });
  assertEquals(calls.length, 0);
});

Deno.test("a non-taxed line carrying a sale field is invalid_request naming the field", () => {
  for (const [field, value] of [["cantidad", 1], ["precioUni", 5], ["montoDescu", 1], ["tipoVenta", "exenta"], ["productId", "p-1"], ["applyIncomeWithholding", true]] as const) {
    const error = localError(() => assertNonTaxedLines({ tipoDte: "03", items: [SALE, { ...CAPITAL, [field]: value }] }), "invalid_request");
    assertEquals((error.details as Record<string, unknown>)["field"], `items[1].${field}`);
  }
  const missingType = localError(() => assertNonTaxedLines({ tipoDte: "01", items: [SALE, { descripcion: "Capital", noGravado: 5 }] }), "invalid_request");
  assertEquals((missingType.details as Record<string, unknown>)["field"], "items[1].tipoItem", "tipoItem is chosen, never defaulted");
  for (const noGravado of [Number.NaN, 1.123456789, "5"]) {
    const bad = localError(() => assertNonTaxedLines({ tipoDte: "01", items: [SALE, { ...CAPITAL, noGravado }] }), "invalid_request");
    assertEquals((bad.details as Record<string, unknown>)["field"], "items[1].noGravado");
  }
  localError(() => assertNonTaxedLines({ tipoDte: "01", items: [SALE, { ...CAPITAL, descripcion: " " }] }), "invalid_request");
  // Eight decimals, a credit and a small amount printed with an exponent are fine; a ninth decimal is not.
  assertNonTaxedLines({ tipoDte: "01", items: [SALE, { ...CAPITAL, noGravado: -0.12345678 }] });
  assertNonTaxedLines({ tipoDte: "01", items: [SALE, { ...CAPITAL, noGravado: 1e-7 }] });
  localError(() => assertNonTaxedLines({ tipoDte: "01", items: [SALE, { ...CAPITAL, noGravado: 1e-9 }] }), "invalid_request");
});

Deno.test("a request without non-taxed lines is not inspected (zero-priced or any shape still goes to the server)", async () => {
  const { facta, calls } = harness(() => json(SEALED));
  await facta.issue({ tipoDte: "14", receptor: { nombre: "Ana", numDocumento: "1", direccion: { departamento: "06", municipio: "20", complemento: "x" } }, items: [{ descripcion: "x", cantidad: 1, precioUni: 0 }] });
  assertNonTaxedLines(null);
  assertNonTaxedLines({ items: "not an array" });
  assertEquals(calls.length, 1);
});

Deno.test("server-side non-taxed refusals are typed FactaError codes and never retried", async () => {
  for (const code of ["non_taxed_total_negative", "non_taxed_requires_sale_line", "non_taxed_not_supported"] as const) {
    const { facta, calls } = harness(() => err(code, 400, { field: "items" }), { maxRetries: 3 });
    const error = await assertRejects(() => facta.issue({ tipoDte: "01", items: [SALE, { ...CAPITAL, noGravado: -1 }] }), FactaError);
    assertEquals(error.code, code);
    assertEquals(error.status, 400);
    assertEquals(calls.length, 1);
    assertEquals(error.spent, null);
  }
});

Deno.test("totals expose totalNoGravado and status exposes capabilities.noGravado", async () => {
  const { facta } = harness((call) => call.path === "/v1/status"
    ? json({ ok: true, version: "v1", ambiente: "00", capabilities: { descuentoGlobal: true, noGravado: true } })
    : json(SEALED));
  const status: Status = await facta.status();
  assertEquals(status.capabilities?.noGravado, true);
  const result = await facta.issue(loanInstalmentCcf);
  assert(result.estado === "sellado");
  const totals: Totals = result.totales;
  assertEquals(totals.totalNoGravado, 50000);
  assertEquals(totals.totalPagar, 51250);
});

Deno.test("the line is typed: a non-taxed line cannot carry sale fields and 14 cannot carry one", () => {
  // @ts-expect-error a non-taxed line has no cantidad (the server answers 400 invalid_request)
  const withQuantity: DteRequest = { tipoDte: "03", items: [SALE, { ...CAPITAL, cantidad: 1 }] };
  // @ts-expect-error nor precioUni
  const withPrice: DteRequest = { tipoDte: "01", items: [SALE, { descripcion: "Capital", noGravado: 5, tipoItem: 2, precioUni: 5 }] };
  // @ts-expect-error nor a catalogue product
  const withProduct: DteRequest = { tipoDte: "01", items: [SALE, { descripcion: "Capital", noGravado: 5, tipoItem: 2, productId: "p" }] };
  // @ts-expect-error tipoItem is required on a non-taxed line
  const noType: DteRequest = { tipoDte: "01", items: [SALE, { descripcion: "Capital", noGravado: 5 }] };
  // @ts-expect-error tipoItem 4 (tributo) is not a non-taxed line type
  const tributo: DteRequest = { tipoDte: "01", items: [SALE, { descripcion: "Capital", noGravado: 5, tipoItem: 4 }] };
  // @ts-expect-error 14 (FSE) has no noGravado line
  const fse: DteRequest = {
    tipoDte: "14",
    receptor: { nombre: "Ana", numDocumento: "1", direccion: { departamento: "06", municipio: "20", complemento: "x" } },
    items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 50 }, CAPITAL],
  };
  const ok: DteRequest = { tipoDte: "11", receptor: exportWithReimbursement.receptor as never, exportacion: { tipoItemExpor: 2 }, items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1 }, CAPITAL] };
  assert([withQuantity, withPrice, withProduct, noType, tributo, fse, ok].every((request) => typeof request.tipoDte === "string"));
});
