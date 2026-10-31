import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";

interface Call { method: string; path: string; search: string; body: unknown; headers: Headers }

function harness(routes: (call: Call, n: number) => Response, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^.*\/v1/, "/v1"),
      search: url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return Promise.resolve(routes(call, calls.length));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0, clock: false, region: false, ...extra }) };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const err = (code: string, status: number, details?: unknown) => json({ error: { code, message: code, ...(details === undefined ? {} : { details }) } }, status);
const DRAFT = { borradorId: "11111111-1111-4111-8111-111111111111", estado: "pendiente", version: 2, totales: { totalPagar: 11.3 } };
const REQUEST = { tipoDte: "01", items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 11.3, tipoItem: 2 }] } as never;

Deno.test("createDraft posts the request with referencia and your idempotency key", async () => {
  const { facta, calls } = harness(() => json(DRAFT, 201));
  const draft = await facta.createDraft({ ...(REQUEST as object), reference: "order-77" }, { idempotencyKey: "order-77" });
  assertEquals(calls[0]?.method, "POST");
  assertEquals(calls[0]?.path, "/v1/drafts");
  assertEquals((calls[0]?.body as Record<string, unknown>).referencia, "order-77");
  assertEquals("reference" in (calls[0]?.body as object), false);
  assertEquals(calls[0]?.headers.get("idempotency-key"), "order-77");
  assertEquals(draft, { id: DRAFT.borradorId, state: "pendiente", version: 2, totals: { totalPagar: 11.3 } });
  await assertRejects(() => facta.createDraft({ ...(REQUEST as object), reference: "x".repeat(65) }), TypeError);
});

Deno.test("listDrafts maps the filters and the page", async () => {
  const { facta, calls } = harness(() => json({ borradores: [DRAFT, { ...DRAFT, borradorId: "22222222-2222-4222-8222-222222222222", estado: "emitido", codigoGeneracion: "AAAA", numeroControl: "DTE-01-M001P001-000000000000009", estadoDocumento: "sellado", selloRecibido: true, emitidoPor: "app", editado: true }], siguiente: "c2" }));
  const page = await facta.listDrafts({ state: "pendiente", reference: "order-77", limit: 10, cursor: "c1", include: "contenido" });
  assertEquals(calls[0]?.search, "?estado=pendiente&referencia=order-77&limite=10&cursor=c1&include=contenido");
  assertEquals(page.next, "c2");
  assertEquals(page.drafts[1], { id: "22222222-2222-4222-8222-222222222222", state: "emitido", version: 2, totals: { totalPagar: 11.3 }, generationCode: "AAAA", controlNumber: "DTE-01-M001P001-000000000000009", documentState: "sellado", sealed: true, issuedBy: "app", edited: true });
  assertEquals((await harness(() => json({ borradores: [], siguiente: null })).facta.listDrafts()).next, null);
});

Deno.test("getDraft, getDraftByKey and cancelDraft use their routes", async () => {
  const { facta, calls } = harness(() => json(DRAFT));
  await facta.getDraft(DRAFT.borradorId);
  await facta.getDraftByKey("order 77/α");
  await facta.cancelDraft(DRAFT.borradorId);
  assertEquals(calls.map((c) => `${c.method} ${c.path}`), [
    `GET /v1/drafts/${DRAFT.borradorId}`,
    `GET /v1/drafts/by-key/${encodeURIComponent("order 77/α")}`,
    `DELETE /v1/drafts/${DRAFT.borradorId}`,
  ]);
  await assertRejects(() => facta.getDraft(""), TypeError);
});

Deno.test("updateDraft sends If-Match with the integer version", async () => {
  const { facta, calls } = harness(() => json({ ...DRAFT, version: 3 }));
  const draft = await facta.updateDraft(DRAFT.borradorId, 2, REQUEST);
  assertEquals(calls[0]?.method, "PUT");
  assertEquals(calls[0]?.headers.get("if-match"), "2");
  assertEquals(calls[0]?.headers.get("idempotency-key"), null);
  assertEquals(draft.version, 3);
  await assertRejects(() => facta.updateDraft(DRAFT.borradorId, 0, REQUEST), TypeError);
  await assertRejects(() => facta.updateDraft(DRAFT.borradorId, "abc" as never, REQUEST), TypeError);
});

Deno.test("issueDraft sends the draft version in the body, the signing key, and returns the issue result", async () => {
  const { facta, calls } = harness(() => json({ estado: "sellado", codigoGeneracion: "AAAA", borradorId: DRAFT.borradorId }), { signKey: "factask_test" });
  const result = await facta.issueDraft(DRAFT.borradorId, 2, REQUEST, { idempotencyKey: "issue-77" });
  assertEquals(calls[0]?.method, "POST");
  assertEquals(calls[0]?.path, `/v1/drafts/${DRAFT.borradorId}/issue`);
  assertEquals((calls[0]?.body as Record<string, unknown>).version, 2);
  assertEquals((calls[0]?.body as Record<string, unknown>).tipoDte, "01");
  assertEquals(calls[0]?.headers.get("x-facta-sign-key"), "factask_test");
  assertEquals(calls[0]?.headers.get("idempotency-key"), "issue-77");
  assertEquals(result.borradorId, DRAFT.borradorId);
});

Deno.test("the draft errors surface as typed FactaError codes with their status", async () => {
  for (const [code, status] of [["drafts_not_ready", 409], ["version_mismatch", 409], ["draft_claimed", 409], ["draft_issuing", 409], ["inbox_cap_reached", 429], ["environment_not_allowed", 403]] as const) {
    const { facta } = harness(() => err(code, status));
    const error = await assertRejects(() => facta.createDraft(REQUEST), FactaError);
    assertEquals([error.code, error.status], [code, status]);
  }
  // None of them is retried: the owner or the caller has to act.
  const { facta, calls } = harness(() => err("drafts_not_ready", 409), { maxRetries: 3 });
  await assertRejects(() => facta.createDraft(REQUEST), FactaError);
  assert(calls.length === 1);
});

Deno.test("a draft answer without id and version is refused", async () => {
  const { facta } = harness(() => json({ estado: "pendiente" }));
  await assertRejects(() => facta.createDraft(REQUEST), FactaError);
});
