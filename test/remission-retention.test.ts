// Remission note (04) and retention receipt (07): the SDK carries the bodies untouched and surfaces
// what the server answers. The fiscal rules live on the server; nothing is computed here.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta, FACTA_STAGING_BASE_URL, FactaError } from "../mod.ts";
import type { DteRequest } from "../mod.ts";
import { remissionNote, retentionReceipt } from "../examples/dte-types.ts";
import { ignoredFieldWarnings } from "../src/warnings.ts";

const KEY = "facta_test_a.bbbbbbbbbbbbbbbb";
const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-04-M001P001-000000000000001", selloRecibido: "2026X", totales: { totalPagar: 50 },
};
const IGNORED = [
  { codigo: "campo_ignorado", campo: "pagos", mensaje: "La nota de remisión no liquida nada: pagos se ignoró." },
  { codigo: "campo_ignorado", campo: "condicionOperacion", mensaje: "La nota de remisión no liquida nada: condicionOperacion se ignoró." },
];

interface Call { method: string; path: string; body: Record<string, unknown> | null }
function harness(answer: (call: Call) => Response, maxRetries = 0) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname.replace(/^.*\/v1/, "/v1"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    return Promise.resolve(answer(call));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ region: false, apiKey: KEY, baseUrl: FACTA_STAGING_BASE_URL, fetch, maxRetries, clock: false }) };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

Deno.test("issue sends a 04 untouched, bienTitulo included", async () => {
  const { facta, calls } = harness(() => json(SEALED));
  const result = await facta.issue(remissionNote);
  assertEquals(calls[0]?.path, "/v1/dte");
  assertEquals(calls[0]?.body, JSON.parse(JSON.stringify(remissionNote)));
  assertEquals((calls[0]?.body?.receptor as Record<string, unknown>).bienTitulo, "04");
  assertEquals(result.estado, "sellado");
  assert(!("ignoredFields" in result));
});

Deno.test("issue sends a 07 untouched: withholding lines have no quantity or price", async () => {
  const { facta, calls } = harness(() => json({ ...SEALED, numeroControl: "DTE-07-M001P001-000000000000001" }));
  await facta.issue(retentionReceipt);
  const items = calls[0]?.body?.items as Array<Record<string, unknown>>;
  assertEquals(items.length, 2);
  assertEquals(items[0]?.codigoRetencionMH, "22");
  assertEquals(items[1]?.ivaRetenido, 2.5);
  assert(items.every((item) => !("cantidad" in item) && !("precioUni" in item)));
});

Deno.test("prepare and sign carry a 04 and a 07", async () => {
  const prepared = { prepareToken: "t", documento: { identificacion: {} }, totales: {}, codigoGeneracion: SEALED.codigoGeneracion, numeroControl: SEALED.numeroControl };
  const { facta, calls } = harness((call) => json(call.path === "/v1/dte/prepare" ? prepared : SEALED));
  await facta.prepare(remissionNote, { idempotencyKey: "nr-1:prepare" });
  await facta.prepare(retentionReceipt, { idempotencyKey: "cr-1:prepare" });
  assertEquals(calls.map((call) => (call.body as Record<string, unknown>).tipoDte), ["04", "07"]);
});

Deno.test("campo_ignorado warnings pass through, typed, on issue and prepare", async () => {
  const issue = harness(() => json({ ...SEALED, advertencias: IGNORED }));
  const request = { ...remissionNote, pagos: [{ codigo: "01", montoPago: 50 }] } as unknown as DteRequest;
  const result = await issue.facta.issue(request);
  assertEquals(result.advertencias, IGNORED);
  assertEquals(result.ignoredFields, IGNORED);
  assertEquals(result.ignoredFields?.map((w) => w.campo), ["pagos", "condicionOperacion"]);
  assert(!("unknownFields" in result));

  const prepared = { prepareToken: "t", documento: {}, totales: {}, advertencias: [IGNORED[0]] };
  const prepare = harness(() => json(prepared));
  const preparedResult = await prepare.facta.prepare(remissionNote, { idempotencyKey: "nr-2:prepare" });
  assertEquals(preparedResult.ignoredFields, [IGNORED[0]]);
});

Deno.test("ignoredFieldWarnings accepts the result or the list and skips other warnings", () => {
  const mixed = [IGNORED[0], { codigo: "campo_desconocido", campo: "x", mensaje: "m" }, "texto", { codigo: "campo_ignorado" }];
  assertEquals(ignoredFieldWarnings(mixed), [IGNORED[0]]);
  assertEquals(ignoredFieldWarnings({ advertencias: mixed }), [IGNORED[0]]);
  assertEquals(ignoredFieldWarnings({}), []);
  assertEquals(ignoredFieldWarnings(null), []);
});

Deno.test("retention_agent_required is a typed 403 that is not retried", async () => {
  const { facta, calls } = harness(() => json({ error: { code: "retention_agent_required", message: "No es agente de retención." } }, 403), 3);
  const error = await assertRejects(() => facta.issue(retentionReceipt), FactaError);
  assertEquals(error.code, "retention_agent_required");
  assertEquals(error.status, 403);
  assertEquals(calls.length, 1);
});

Deno.test("createDraft accepts a 04 and a 07 and reports campo_ignorado", async () => {
  const draft = { borradorId: "11111111-1111-4111-8111-111111111111", estado: "pendiente", version: 1, totales: { totalPagar: 50 } };
  const { facta, calls } = harness(() => json({ ...draft, advertencias: IGNORED }, 201));
  const first = await facta.createDraft({ ...remissionNote, reference: "nr-77" }, { idempotencyKey: "nr-77" });
  assertEquals(calls[0]?.path, "/v1/drafts");
  assertEquals(calls[0]?.body?.tipoDte, "04");
  assertEquals(calls[0]?.body?.referencia, "nr-77");
  assertEquals(first.ignoredFields, IGNORED);
  assertEquals(first.advertencias, IGNORED);

  const clean = harness(() => json(draft, 201));
  const second = await clean.facta.createDraft({ ...retentionReceipt, reference: "cr-77" }, { idempotencyKey: "cr-77" });
  assertEquals(clean.calls[0]?.body?.tipoDte, "07");
  assertEquals((clean.calls[0]?.body?.items as unknown[]).length, 2);
  assert(!("ignoredFields" in second) && !("advertencias" in second));
});
