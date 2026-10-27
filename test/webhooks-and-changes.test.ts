import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import {
  constructWebhookEvent,
  MemoryWebhookReplayStore,
  signWebhook,
  verifyWebhook,
  WebhookVerificationError,
} from "../mod.ts";

interface Call { method: string; path: string; search: string; body: unknown; headers: Headers }

function harness(routes: (call: Call, attempt: number) => Response, maxRetries = 0) {
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
  return { calls, facta: new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries, clock: false, region: false }) };
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const err = (code: string, status: number, details?: unknown) => json({ error: { code, message: code, ...(details === undefined ? {} : { details }) } }, status);

Deno.test("single reads and writes carry the catalogue revision and PATCH sends If-Match", async () => {
  const { facta, calls } = harness((call) => {
    if (call.method === "GET") return json({ cliente: { id: "c1", nombre: "Ana" } }, 200, { "Facta-Catalog-Revision": "7", ETag: '"7"' });
    return json({ cliente: { id: "c1", nombre: "Ana", telefono: "22223333" } }, 200, { ETag: '"8"' });
  });
  const read = await facta.getCustomer("c1");
  assertEquals(read?.revision, 7);
  const updated = await facta.updateCustomer("c1", { telefono: "22223333" }, { ifMatch: read!.revision! });
  assertEquals(updated.revision, 8);
  assertEquals(calls[1]?.headers.get("if-match"), '"7"');
  await facta.updateCustomer("c1", { telefono: "22224444" });
  assertEquals(calls[2]?.headers.get("if-match"), null);
  await facta.updateCustomer("c1", { telefono: "22225555" }, { ifMatch: '"9"' });
  assertEquals(calls[3]?.headers.get("if-match"), '"9"');
  await assertRejects(() => facta.updateCustomer("c1", { telefono: "22226666" }, { ifMatch: "abc" }), TypeError);
});

Deno.test("a stale If-Match is catalog_revision_conflict with the current revision in details", async () => {
  const { facta } = harness(() => err("catalog_revision_conflict", 409, { revisionActual: 9 }));
  const error = await assertRejects(() => facta.updateProduct("p1", { descripcion: "x" }, { ifMatch: 7 }), FactaError);
  assertEquals(error.code, "catalog_revision_conflict");
  assertEquals((error.details as { revisionActual: number }).revisionActual, 9);
});

Deno.test("records without revision headers (plain catalogue) simply have no revision", async () => {
  const { facta } = harness(() => json({ producto: { id: "p1", descripcion: "x", tipoItem: 1, precioUni: 1 } }));
  assertEquals((await facta.getProduct("p1"))?.revision, undefined);
});

Deno.test("listCatalogChanges reads the feed and maps it", async () => {
  const { facta, calls } = harness(() => json({
    generacion: "g1", cabeza: 12,
    cambios: [{ revision: 11, tipo: "customer", registroId: "c1", registroRevision: 3, operacion: "update", actor: { tipo: "api", llave: "facta_test_a" }, en: "2026-10-27T10:00:00Z" }],
    siguiente: 11, hayMas: false,
  }));
  const page = await facta.listCatalogChanges({ since: 10, generation: "g1", limit: 50 });
  assertEquals(calls[0]?.path, "/v1/catalog/changes");
  assertEquals(calls[0]?.search, "?since=10&generacion=g1&limite=50");
  assertEquals(page.head, 12);
  assertEquals(page.next, 11);
  assertEquals(page.hasMore, false);
  assertEquals(page.changes[0], { revision: 11, type: "customer", recordId: "c1", recordRevision: 3, operation: "update", actor: { type: "api", keyId: "facta_test_a" }, at: "2026-10-27T10:00:00Z" });
  await facta.listCatalogChanges();
  assertEquals(calls[1]?.search, "?since=0");
});

Deno.test("an expired cursor keeps reason, cabeza and generacion in details", async () => {
  const { facta } = harness(() => err("catalog_cursor_expired", 410, { reason: "cursor_ahead", cabeza: 27, generacion: "g2" }));
  const error = await assertRejects(() => facta.listCatalogChanges({ since: 999 }), FactaError);
  assertEquals(error.code, "catalog_cursor_expired");
  assertEquals(error.status, 410);
  assertEquals(error.details, { reason: "cursor_ahead", cabeza: 27, generacion: "g2" });
});

Deno.test("webhook management maps the server's names and shows the secret only where the server does", async () => {
  const row = { id: "w1", url: "https://example.com/h", eventos: ["catalog.customer.created"], descripcion: "qa", activo: true, desactivadoPor: null, fallosSeguidos: 0, creado: "t1", actualizado: "t2" };
  const { facta, calls } = harness((call) => {
    if (call.method === "POST" && call.path === "/v1/webhooks") return json({ ...row, secreto: "whsec_abc" }, 201);
    if (call.method === "GET" && call.path === "/v1/webhooks") return json({ webhooks: [row] });
    if (call.method === "GET") return json(row);
    if (call.method === "PATCH") return json({ ...row, activo: false });
    if (call.method === "DELETE") return json({ id: "w1", eliminado: true });
    if (call.path.endsWith("/rotate-secret")) return json({ ...row, secreto: "whsec_new" });
    return json({ entregaId: "d1", evento: "webhook.test" }, 202);
  });
  const created = await facta.createWebhook({ url: row.url, events: ["catalog.customer.created"], description: "qa" });
  assertEquals(created.secret, "whsec_abc");
  assertEquals(created.events, ["catalog.customer.created"]);
  assertEquals(calls[0]?.body, { url: row.url, eventos: ["catalog.customer.created"], descripcion: "qa" });
  assertEquals((await facta.listWebhooks()).length, 1);
  assert(!("secret" in (await facta.getWebhook("w1"))));
  assertEquals((await facta.updateWebhook("w1", { active: false })).active, false);
  assertEquals(calls.at(-1)?.body, { activo: false });
  await facta.deleteWebhook("w1");
  assertEquals((await facta.rotateWebhookSecret("w1")).secret, "whsec_new");
  assertEquals(await facta.testWebhook("w1"), { deliveryId: "d1", event: "webhook.test" });
  await assertRejects(() => facta.createWebhook({} as never), TypeError);
  await assertRejects(() => facta.updateWebhook("w1", {}), TypeError);
  await assertRejects(() => facta.createWebhook({ url: "https://x.test", nombre: "x" } as never), TypeError);
});

Deno.test("webhook limit and duplicate are typed codes", async () => {
  const limit = harness(() => err("webhook_limit_reached", 409, { maximo: 5 }));
  assertEquals((await assertRejects(() => limit.facta.createWebhook({ url: "https://a.test/h" }), FactaError)).code, "webhook_limit_reached");
  const dup = harness(() => err("webhook_duplicate", 409));
  assertEquals((await assertRejects(() => dup.facta.createWebhook({ url: "https://a.test/h" }), FactaError)).code, "webhook_duplicate");
});

Deno.test("data_grant_unavailable and data_epoch_stale are retried; data_grant_revoked is not", async () => {
  for (const [code, status, retried] of [["data_grant_unavailable", 503, true], ["data_epoch_stale", 503, true], ["data_grant_revoked", 403, false]] as const) {
    const { facta, calls } = harness((_call, n) => (n === 1 ? err(code, status) : json({ cliente: { id: "c1" } })), 2);
    if (retried) {
      assertEquals((await facta.getCustomer("c1"))?.id, "c1");
      assertEquals(calls.length, 2, `${code} should have been retried once`);
    } else {
      const error = await assertRejects(() => facta.getCustomer("c1"), FactaError);
      assertEquals(error.code, code);
      assertEquals(calls.length, 1, `${code} must not be retried`);
    }
  }
});

// ── the verifier ────────────────────────────────────────────────────────────

const SECRET = "whsec_test";
const BODY = JSON.stringify({ deliveryId: "d-1", event: "catalog.customer.updated", company: "co", recordId: "c1", revision: 4, generation: "g", at: "2026-10-27T10:00:00Z" });

Deno.test("a signed delivery verifies; the replay store refuses a repeat", async () => {
  const header = await signWebhook(SECRET, BODY, 1_000_000);
  const store = new MemoryWebhookReplayStore();
  const first = await verifyWebhook({ secret: SECRET, header, body: BODY, nowSeconds: 1_000_100, replayStore: store });
  assert(first.ok && first.deliveryId === "d-1" && first.event === "catalog.customer.updated");
  const second = await verifyWebhook({ secret: SECRET, header, body: BODY, nowSeconds: 1_000_100, replayStore: store });
  assertEquals(second, { ok: false, reason: "replayed" });
});

Deno.test("verification refuses a wrong secret, a changed body, a stale time and a malformed header", async () => {
  const header = await signWebhook(SECRET, BODY, 1_000_000);
  assertEquals(await verifyWebhook({ secret: "whsec_other", header, body: BODY, nowSeconds: 1_000_000 }), { ok: false, reason: "bad_signature" });
  assertEquals(await verifyWebhook({ secret: SECRET, header, body: BODY + " ", nowSeconds: 1_000_000 }), { ok: false, reason: "bad_signature" });
  assertEquals(await verifyWebhook({ secret: SECRET, header, body: BODY, nowSeconds: 1_000_301 }), { ok: false, reason: "stale_timestamp" });
  assertEquals(await verifyWebhook({ secret: SECRET, header: "v1=zz", body: BODY }), { ok: false, reason: "malformed_header" });
  assertEquals(await verifyWebhook({ secret: SECRET, header: null, body: BODY }), { ok: false, reason: "malformed_header" });
  const notJson = await signWebhook(SECRET, "not json", 1_000_000);
  assertEquals(await verifyWebhook({ secret: SECRET, header: notJson, body: "not json", nowSeconds: 1_000_000 }), { ok: false, reason: "malformed_body" });
});

Deno.test("a forged request does not poison the replay store, and a rotated secret may send two v1", async () => {
  const store = new MemoryWebhookReplayStore();
  await verifyWebhook({ secret: SECRET, header: "t=1000000,v1=" + "0".repeat(64), body: BODY, nowSeconds: 1_000_000, replayStore: store });
  assertEquals(store.size, 0);
  const oldHeader = await signWebhook("whsec_old", BODY, 1_000_000);
  const newHeader = await signWebhook(SECRET, BODY, 1_000_000);
  const both = `${oldHeader},v1=${newHeader.split("v1=")[1]}`;
  assert((await verifyWebhook({ secret: SECRET, header: both, body: BODY, nowSeconds: 1_000_000 })).ok);
  assert((await verifyWebhook({ secret: "whsec_old", header: both, body: BODY, nowSeconds: 1_000_000 })).ok);
});

Deno.test("bytes and constructWebhookEvent", async () => {
  const bytes = new TextEncoder().encode(BODY);
  const header = await signWebhook(SECRET, bytes, 1_000_000);
  const delivery = await constructWebhookEvent({ secret: SECRET, header, body: bytes, nowSeconds: 1_000_000 });
  assertEquals(delivery.recordId, "c1");
  const error = await assertRejects(() => constructWebhookEvent({ secret: "x", header, body: bytes, nowSeconds: 1_000_000 }), WebhookVerificationError);
  assertEquals(error.reason, "bad_signature");
});

Deno.test("signing matches an independently computed HMAC-SHA256 vector", async () => {
  // node:crypto createHmac("sha256", "whsec_vector").update(`1700000000.${body}`) -- the scheme of the server's reference signer.
  const header = await signWebhook("whsec_vector", '{"deliveryId":"v","event":"webhook.test"}', 1700000000);
  assertEquals(header, "t=1700000000,v1=a66100c296b2a5e423da3727daefff5eda73d38699d35ac681fb768f666b22a2");
});
