import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createFactaCache, createFactaClient, FactaClientError } from "../browser.ts";

Deno.test("data client posts the action without a session and unwraps the payload", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const client = createFactaClient({
    endpoint: "/api/facta",
    fetch: ((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      assertEquals((init.headers as Headers).get("x-facta-ui"), "1");
      return Promise.resolve(Response.json({ documentos: [], siguiente: null, items: [], item: { id: "c1" }, file: { filename: "a.pdf" }, copies: [], storage: { json: "stored" }, state: "online" }));
    }) as unknown as typeof fetch,
  });
  await client.listDocuments({ estado: "sellado", buscar: "local-only", desde: undefined, limit: 10 });
  assertEquals(sent[0], { action: "documents.list", estado: "sellado", limit: 10 });
  assertEquals((await client.getCustomer("c1")).id, "c1");
  assertEquals((await client.downloadDocument("CG", "pdf")).filename, "a.pdf");
  assertEquals((await client.retryDocumentStorage("CG")).json, "stored");
  assertEquals((await client.getServiceStatus()).state, "online");
  assertEquals(await client.searchProducts("ab", { limit: 5 }), []);
  assertEquals(sent.at(-1), { action: "catalog.products.search", query: "ab", limit: 5 });
});

Deno.test("data client maps the error envelope", async () => {
  const client = createFactaClient({
    endpoint: "/x",
    fetch: (() => Promise.resolve(Response.json({ error: { code: "action_not_allowed", message: "no", retryable: false } }, { status: 403 }))) as unknown as typeof fetch,
  });
  const error = await assertRejects(() => client.getStorageStatus(), FactaClientError);
  assertEquals(error.code, "action_not_allowed");
  assertEquals(error.status, 403);
});

Deno.test("cache dedupes in-flight fetches and serves stale data while revalidating", async () => {
  let clock = 1000;
  const cache = createFactaCache(() => clock);
  let calls = 0;
  let release!: (v: string) => void;
  const fetcher = () => {
    calls++;
    return new Promise<string>((r) => (release = r));
  };
  const a = cache.fetch("k", fetcher);
  const b = cache.fetch("k", fetcher);
  assertEquals(calls, 1);
  assertEquals(cache.get("k")!.fetching, true);
  release("one");
  assertEquals(await a, "one");
  assertEquals(await b, "one");
  assertEquals(cache.get<string>("k")!.data, "one");
  // Fresh: no refetch.
  assertEquals(await cache.revalidate("k", () => Promise.resolve("two"), 5000), "one");
  clock += 6000;
  // Stale: refetches.
  assertEquals(await cache.revalidate("k", () => Promise.resolve("two"), 5000), "two");
  // A failed revalidation keeps the last data and records the error.
  clock += 6000;
  assertEquals(await cache.revalidate("k", () => Promise.reject(new Error("boom")), 5000), "two");
  assert(cache.get("k")!.error instanceof Error);
  assertEquals(cache.get<string>("k")!.data, "two");
});

Deno.test("cache notifies subscribers and invalidate makes entries stale by prefix", async () => {
  const cache = createFactaCache();
  let notified = 0;
  const off = cache.subscribe("docs:a", () => notified++);
  await cache.fetch("docs:a", () => Promise.resolve(1));
  assert(notified >= 2);
  await cache.fetch("other", () => Promise.resolve(1));
  cache.invalidate("docs:");
  assertEquals(cache.get("docs:a")!.updatedAt, 0);
  assert(cache.get("other")!.updatedAt > 0);
  off();
  const before = notified;
  cache.set("docs:a", 2);
  assertEquals(notified, before);
});
