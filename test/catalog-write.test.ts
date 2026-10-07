import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import { createFactaHandler } from "../server.ts";

// Catalog modes, reads through the API, writes, error mapping and idempotency. The server
// routes are faked: the live suite checks the real ones when they are deployed.

interface Call { method: string; path: string; search: string; body: unknown; key: string | null }

type Mode = "encrypted" | "readable" | "plain" | undefined;

const CUSTOMER = { id: "c1", name: "Ferretería San Miguel", doc_type: "36", doc_number: "06142103891024", nrc: "1234567", email: "x@example.test" };
const OLD_CUSTOMER = { id: "c2", name: "Cliente Viejo", active: false };
const PRODUCT = { id: "p1", code: "DIS-1", description: "Disco de corte", item_type: 1, unit_price: 2.85, vat_included: true };
const OLD_PRODUCT = { id: "p2", description: "Disco viejo", item_type: 1, unit_price: 1, active: false };

function harness(mode: Mode, routes: (call: Call) => Response | undefined = () => undefined, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*\/v1/, "/v1");
    const call: Call = {
      method: init?.method ?? "GET",
      path,
      search: url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      key: new Headers(init?.headers).get("idempotency-key"),
    };
    calls.push(call);
    if (path === "/v1/status") {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        ambiente: "00",
        emisor: null,
        limites: { hora: { limite: 100, restante: 90 }, dia: { limite: 1000, restante: 900 } },
        region: "us-west-2",
        llave: { keyId: "key-1", alcances: ["catalog:write"], ...(mode === undefined ? {} : { catalogMode: mode }) },
        sincronizacion: { catalog: { status: "ready", desiredRevision: 3, publishedRevision: 3 } },
      }), { status: 200 }));
    }
    return Promise.resolve(routes(call) ?? new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), { status: 404 }));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0, clock: false, ...extra }) };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function plainRoutes(call: Call): Response | undefined {
  const query = new URLSearchParams(call.search);
  if (call.method === "GET" && call.path === "/v1/customers") {
    if (query.get("q") !== null) return json({ customers: [CUSTOMER] });
    return query.get("cursor") === null ? json({ customers: [CUSTOMER], siguiente: "p2" }) : json({ customers: [OLD_CUSTOMER] });
  }
  if (call.method === "GET" && call.path === "/v1/customers/c1") return json({ customer: CUSTOMER });
  if (call.method === "GET" && call.path === "/v1/customers/c2") return json({ customer: OLD_CUSTOMER });
  if (call.method === "GET" && call.path === "/v1/products") {
    return query.get("q") !== null ? json({ products: [PRODUCT, OLD_PRODUCT] }) : json({ products: query.get("includeInactive") === "true" ? [PRODUCT, OLD_PRODUCT] : [PRODUCT] });
  }
  if (call.method === "GET" && call.path === "/v1/products/p1") return json({ product: PRODUCT });
  return undefined;
}

// --- Mode detection ----------------------------------------------------------------------------

for (const mode of ["encrypted", "readable", "plain"] as const) {
  Deno.test(`catalogState and diagnose report catalogMode "${mode}"`, async () => {
    const { facta } = harness(mode);
    assertEquals((await facta.catalogState()).catalogMode, mode);
    assertEquals((await facta.diagnose()).catalogMode, mode);
  });
}

Deno.test("an older server that does not advertise a mode reports null", async () => {
  const { facta } = harness(undefined);
  assertEquals((await facta.catalogState()).catalogMode, null);
});

Deno.test("the mode comes from the same /v1/status read as the region: one request at init", async () => {
  const { calls, facta } = harness("plain", plainRoutes);
  await facta.listCustomers();
  await facta.getCustomer("c1");
  assertEquals(calls.filter((call) => call.path === "/v1/status").length, 1);
});

Deno.test("a plain catalog reports fresh with no local revision", async () => {
  const state = await harness("plain").facta.catalogState();
  assertEquals([state.freshness, state.localRevision, state.syncStatus], ["fresh", null, null]);
});

// --- Reads -------------------------------------------------------------------------------------

Deno.test("plain: list follows the cursor, hides inactive customers and needs no unlockKey", async () => {
  const { calls, facta } = harness("plain", plainRoutes);
  assertEquals((await facta.listCustomers()).map((c) => c.id), ["c1"]);
  assertEquals((await facta.listCustomers({ includeInactive: true })).map((c) => c.id), ["c1", "c2"]);
  assert(calls.some((call) => call.path === "/v1/customers" && call.search.includes("cursor=p2")));
  assertEquals(calls.some((call) => call.path === "/v1/vault/destinations"), false);
});

Deno.test("plain: get returns the record, null when missing, null when inactive", async () => {
  const { facta } = harness("plain", plainRoutes);
  assertEquals((await facta.getCustomer("c1"))?.name, "Ferretería San Miguel");
  assertEquals(await facta.getCustomer("zz"), null);
  assertEquals(await facta.getCustomer("c2"), null);
  assertEquals((await facta.getCustomer("c2", { includeInactive: true }))?.id, "c2");
  assertEquals((await facta.getProduct("p1"))?.id, "p1");
});

Deno.test("plain: search sends the query to the server and honours the limit", async () => {
  const { calls, facta } = harness("plain", plainRoutes);
  assertEquals((await facta.searchCustomers("ferre", { limit: 5 })).map((c) => c.id), ["c1"]);
  const sent = calls.find((call) => call.path === "/v1/customers")!;
  assertEquals(new URLSearchParams(sent.search).get("q"), "ferre");
  assertEquals(new URLSearchParams(sent.search).get("limit"), "5");
  assertEquals((await facta.searchProducts("disco")).map((p) => p.id), ["p1"]);
  assertEquals((await facta.searchProducts("disco", { includeInactive: true })).map((p) => p.id), ["p1", "p2"]);
  assertEquals(await facta.searchCustomers("   "), []);
});

Deno.test("plain: products list asks for inactive ones only when told to", async () => {
  const { facta } = harness("plain", plainRoutes);
  assertEquals((await facta.listProducts()).map((p) => p.id), ["p1"]);
  assertEquals((await facta.listProducts({ includeInactive: true })).map((p) => p.id), ["p1", "p2"]);
});

Deno.test("readable: reads go through the API too", async () => {
  const { calls, facta } = harness("readable", plainRoutes);
  assertEquals((await facta.getCustomer("c1"))?.id, "c1");
  assertEquals(calls.some((call) => call.path === "/v1/vault/destinations"), false);
});

Deno.test("readable without a customers route and without unlockKey surfaces the API error", async () => {
  const { facta } = harness("readable");
  await assertRejects(() => facta.listCustomers(), FactaError, "no");
});

Deno.test("encrypted: reads keep the snapshot path (and still need the unlock key)", async () => {
  const { calls, facta } = harness("encrypted", plainRoutes);
  const error = await facta.listCustomers().then(() => null, (cause) => cause as FactaError);
  assertEquals(error?.code, "unauthorized");
  assertEquals(calls.some((call) => call.path === "/v1/customers"), false);
});

Deno.test("an unknown mode keeps the snapshot path", async () => {
  const { calls, facta } = harness(undefined, plainRoutes);
  await facta.getProduct("p1").catch(() => null);
  assertEquals(calls.some((call) => call.path === "/v1/products/p1"), false);
});

Deno.test("a plain catalog reaches the server for issue(): ids travel as they are", async () => {
  const { calls, facta } = harness("plain", (call) => call.path === "/v1/dte" ? json({ ok: true, codigoGeneracion: "CG" }) : undefined);
  await facta.issue({ tipoDte: "01", receptor: { customerId: "c1" }, items: [{ productId: "p1", cantidad: 1 }] }, { idempotencyKey: "k1" });
  const sent = calls.find((call) => call.path === "/v1/dte")!;
  assertEquals((sent.body as { receptor: unknown }).receptor, { customerId: "c1" });
});

// --- Writes ------------------------------------------------------------------------------------

function writeRoutes(call: Call): Response | undefined {
  if (call.path === "/v1/customers" && call.method === "POST") return json({ customer: { id: "new-c", ...(call.body as object) } }, 201);
  if (call.path === "/v1/customers/c1" && call.method === "PATCH") return json({ customer: { ...CUSTOMER, ...(call.body as object) } });
  if (call.path === "/v1/customers/c1" && call.method === "DELETE") return json({ customer: { ...CUSTOMER, active: false } });
  if (call.path === "/v1/products" && call.method === "POST") return json({ product: { id: "new-p", ...(call.body as object) } }, 201);
  if (call.path === "/v1/products/p1" && call.method === "PATCH") return json({ product: { ...PRODUCT, ...(call.body as object) } });
  if (call.path === "/v1/products/p1" && call.method === "DELETE") return json({ ok: true });
  return undefined;
}

Deno.test("createCustomer sends digits only and returns the record", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  const created = await facta.createCustomer({
    name: "Laura Ortiz", doc_type: "13", doc_number: "04829316-5", nrc: "123456-7",
    address: { departamento: "06", municipio: "14", complemento: "Colonia Escalón" }, email: "laura@example.test",
  });
  assertEquals(created.id, "new-c");
  const sent = calls.find((call) => call.method === "POST")!;
  assertEquals(sent.path, "/v1/customers");
  assertEquals((sent.body as Record<string, unknown>).doc_number, "048293165");
  assertEquals((sent.body as Record<string, unknown>).nrc, "1234567");
});

Deno.test("updateCustomer PATCHes only the given fields and sends no idempotency key", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  const updated = await facta.updateCustomer("c1", { phone: "22223333" });
  assertEquals(updated.phone, "22223333");
  const sent = calls.find((call) => call.method === "PATCH")!;
  assertEquals(sent.body, { phone: "22223333" });
  assertEquals(sent.key, null);
});

Deno.test("deactivateCustomer is a DELETE and returns the deactivated record", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  assertEquals((await facta.deactivateCustomer("c1")).active, false);
  assertEquals(calls.at(-1)?.method, "DELETE");
  assertEquals(calls.at(-1)?.body, undefined);
});

Deno.test("createProduct, updateProduct, deactivateProduct hit /v1/products", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  const created = await facta.createProduct({ description: "Cemento", item_type: 1, unit_price: 9.5, vat_included: false });
  assertEquals(created.id, "new-p");
  assertEquals((await facta.updateProduct("p1", { unit_price: 3 })).unit_price, 3);
  assertEquals(await facta.deactivateProduct("p1"), { id: "p1", active: false });
  assertEquals(calls.filter((call) => call.path.startsWith("/v1/products")).map((call) => call.method), ["POST", "PATCH", "DELETE"]);
});

Deno.test("there is no hard delete in the SDK surface", () => {
  const facta = harness("plain").facta as unknown as Record<string, unknown>;
  assertEquals(typeof facta["deleteCustomer"], "undefined");
  assertEquals(typeof facta["deleteProduct"], "undefined");
});

Deno.test("an id with unsafe characters is encoded in the path", async () => {
  const { calls, facta } = harness("plain", () => json({ customer: { id: "a/b" } }));
  await facta.updateCustomer("a/b", { phone: "1" });
  assertEquals(calls.at(-1)?.path, "/v1/customers/a%2Fb");
});

// --- Validation never stricter than the server -------------------------------------------------

const refused = async (promise: Promise<unknown>): Promise<FactaError> =>
  await promise.then(() => { throw new Error("expected a refusal"); }, (cause) => cause as FactaError);

Deno.test("pre-validation: DUI 9 digits, NIT 14, NRC 1-8, address codes, item type required", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  for (const input of [
    { name: "A", doc_type: "13", doc_number: "1234" },
    { name: "A", doc_type: "36", doc_number: "123456789" },
    { name: "A", nrc: "123456789" },
    { name: "A", nrc: "abc" },
    { name: "A", address: { departamento: "6", municipio: "14", complemento: "x" } },
    { name: "A", address: { departamento: "06", municipio: "14", complemento: " " } },
    { name: "A", email: "sin-arroba" },
    { doc_type: "13", doc_number: "048293165" },
  ]) {
    const error = await refused(facta.createCustomer(input));
    assertEquals([error.code, error.status], ["validation_failed", 422]);
  }
  for (const input of [
    { description: "x", unit_price: 1 },
    { description: "x", item_type: 4 as never, unit_price: 1 },
    { description: "x", item_type: 1 as const, unit_price: -1 },
    { item_type: 1 as const, unit_price: 1 },
    { description: "x", item_type: 1 as const },
    { description: "x", item_type: 1 as const, unit_price: 1, unit_of_measure: 0 },
  ]) {
    assertEquals((await refused(facta.createProduct(input))).code, "validation_failed");
  }
  assertEquals(calls.filter((call) => call.method !== "GET" || call.path !== "/v1/status").length, 0);
});

Deno.test("pre-validation accepts what the server accepts: other document types, no document, partial updates", async () => {
  const { facta } = harness("plain", writeRoutes);
  await facta.createCustomer({ name: "Extranjero", doc_type: "03", doc_number: "P-998877" });
  await facta.createCustomer({ name: "Sin documento" });
  await facta.createCustomer({ name: "Con NIT", doc_type: "36", doc_number: "0614-210389-102-4" });
  await facta.updateProduct("p1", { unit_price: 0 });
  await facta.updateCustomer("c1", { email: null, phone: null });
});

Deno.test("an empty update is refused locally and ids are required", async () => {
  const { facta } = harness("plain", writeRoutes);
  assertEquals((await refused(facta.updateCustomer("c1", {}))).code, "validation_failed");
  await assertRejects(() => facta.deactivateProduct(""), TypeError);
});

// --- Error mapping -----------------------------------------------------------------------------

Deno.test("catalog_write_disabled (403) says where to enable it and warns about readability", async () => {
  const { facta } = harness("encrypted", () => json({ error: { code: "catalog_write_disabled", message: "x" } }, 403));
  const error = await refused(facta.createCustomer({ name: "A" }));
  assertEquals([error.code, error.status], ["catalog_write_disabled", 403]);
  for (const part of ["Cuenta → API", "Permitir administrar clientes y productos desde el API", "catalog:write", "texto plano", "Facta DTE podrá leerlo"]) {
    assert(error.message.includes(part), `message should mention ${part}`);
  }
});

Deno.test("catalog_encrypted (409) explains the switch to plain text", async () => {
  const { facta } = harness("encrypted", () => json({ error: { code: "catalog_encrypted", message: "x" } }, 409));
  const error = await refused(facta.updateProduct("p1", { unit_price: 2 }));
  assertEquals([error.code, error.status], ["catalog_encrypted", 409]);
  for (const part of ["Cuenta → API", "texto plano", "Permitir administrar clientes y productos desde el API", "Facta DTE podrá leerlo"]) {
    assert(error.message.includes(part), `message should mention ${part}`);
  }
});

Deno.test("a missing scope keeps the server's own forbidden_scope", async () => {
  const { facta } = harness("plain", () => json({ error: { code: "forbidden_scope", message: "Falta catalog:write" } }, 403));
  const error = await refused(facta.deactivateCustomer("c1"));
  assertEquals([error.code, error.message], ["forbidden_scope", "Falta catalog:write"]);
});

// --- Idempotency -------------------------------------------------------------------------------

Deno.test("create passes the caller's idempotencyKey and mints one otherwise", async () => {
  const { calls, facta } = harness("plain", writeRoutes);
  await facta.createCustomer({ name: "A" }, { idempotencyKey: "order-77" });
  await facta.createProduct({ description: "B", item_type: 2, unit_price: 1 });
  const posts = calls.filter((call) => call.method === "POST");
  assertEquals(posts[0]!.key, "order-77");
  assert(posts[1]!.key !== null && posts[1]!.key !== "");
});

Deno.test("a retried create reuses the same key across attempts", async () => {
  let attempts = 0;
  const keys: Array<string | null> = [];
  const { facta } = harness("plain", (call) => {
    if (call.method !== "POST") return undefined;
    keys.push(call.key);
    attempts++;
    return attempts === 1 ? json({ error: { code: "service_unavailable", message: "x" } }, 503) : json({ customer: { id: "c9" } }, 201);
  }, { maxRetries: 1 });
  assertEquals((await facta.createCustomer({ name: "A" })).id, "c9");
  assertEquals(keys.length, 2);
  assertEquals(keys[0], keys[1]);
});

// --- Handler capability gating -----------------------------------------------------------------

function handlerFor(catalog: "read" | "write" | undefined, authorize: "session-only" | (() => boolean) = () => true) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
    return Promise.resolve({ id: "x1", name: "Nuevo", description: "Nuevo", unit_price: 1 });
  };
  const handler = createFactaHandler({
    facta: {
      issue: () => Promise.resolve({}),
      getDocumentStatus: () => Promise.resolve({}),
      searchCustomers: () => Promise.resolve([]),
      createCustomer: rec("createCustomer"),
      updateCustomer: rec("updateCustomer"),
      deactivateCustomer: rec("deactivateCustomer"),
      createProduct: rec("createProduct"),
      updateProduct: rec("updateProduct"),
      deactivateProduct: rec("deactivateProduct"),
    } as never,
    sessionSecret: "x".repeat(48),
    authorize,
    ...(catalog === undefined ? {} : { capabilities: { catalog } }),
  } as never);
  const post = async (body: unknown) => {
    const response = await handler(new Request("https://app.test/facta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-facta-ui": "1" },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { post, calls };
}

const WRITES = [
  { action: "catalog.customers.create", input: { name: "Nuevo" } },
  { action: "catalog.customers.update", id: "c1", input: { phone: "1" } },
  { action: "catalog.customers.deactivate", id: "c1" },
  { action: "catalog.products.create", input: { description: "Nuevo", item_type: 1, unit_price: 1 } },
  { action: "catalog.products.update", id: "p1", input: { unit_price: 2 } },
  { action: "catalog.products.deactivate", id: "p1" },
];

Deno.test("handler: catalog writes are off by default and under catalog: read", async () => {
  for (const catalog of [undefined, "read"] as const) {
    const { post, calls } = handlerFor(catalog);
    for (const write of WRITES) {
      const answer = await post(write);
      assertEquals([answer.status, answer.body.error.code], [403, "action_not_allowed"]);
    }
    assertEquals(calls.length, 0);
  }
});

Deno.test("handler: catalog: write enables each write and keeps reads", async () => {
  const { post, calls } = handlerFor("write");
  for (const write of WRITES) assertEquals((await post(write)).status, 200, write.action);
  assertEquals(calls.map(([name]) => name), ["createCustomer", "updateCustomer", "deactivateCustomer", "createProduct", "updateProduct", "deactivateProduct"]);
  assertEquals((await post({ action: "catalog.customers.search", query: "ab" })).status, 200);
});

Deno.test("handler: a write needs an authorize function, never session-only", () => {
  assertThrows(() => handlerFor("write", "session-only"), TypeError, "authorize");
  handlerFor("read", "session-only");
});

Deno.test("handler: authorize is consulted for writes and can refuse", async () => {
  const { post, calls } = handlerFor("write", () => false);
  assertEquals((await post(WRITES[0])).status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("handler: write input and idempotency key are validated; the key only applies to create", async () => {
  const { post, calls } = handlerFor("write");
  assertEquals((await post({ action: "catalog.customers.create" })).status, 400);
  assertEquals((await post({ action: "catalog.customers.create", input: { name: "A" }, idempotencyKey: "short" })).status, 400);
  assertEquals((await post({ action: "catalog.customers.update", id: "c1", input: {}, idempotencyKey: "long-enough-key" })).status, 400);
  assertEquals((await post({ action: "catalog.customers.create", input: { name: "A" }, idempotencyKey: "order-12345" })).status, 200);
  assertEquals((calls.at(-1)![1][1] as { idempotencyKey: string }).idempotencyKey, "order-12345");
});

Deno.test("handler: SDK refusals and API errors reach the browser with their code", async () => {
  const handler = createFactaHandler({
    facta: {
      issue: () => Promise.resolve({}),
      getDocumentStatus: () => Promise.resolve({}),
      createCustomer: () => Promise.reject(new FactaError("catalog_encrypted", "El catálogo está cifrado", 409)),
      createProduct: () => Promise.reject(new FactaError("validation_failed", "Datos inválidos", 422)),
    } as never,
    sessionSecret: "x".repeat(48),
    authorize: () => true,
    capabilities: { catalog: "write" },
  } as never);
  const post = async (body: unknown) => {
    const response = await handler(new Request("https://app.test/facta", {
      method: "POST", headers: { "content-type": "application/json", "x-facta-ui": "1" }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const a = await post({ action: "catalog.customers.create", input: { name: "A" } });
  assertEquals([a.status, a.body.error.code], [409, "catalog_encrypted"]);
  const b = await post({ action: "catalog.products.create", input: {} });
  assertEquals([b.status, b.body.error.code], [422, "validation_failed"]);
});
