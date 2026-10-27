import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";

// Since 0.6 the server resolves `customerId` / `productId` for every key, whatever the company's
// catalogue mode: the SDK sends ids untouched, with no unlock key, no vault download and no
// status round trip made on purpose for the catalogue.

interface Call { method: string; url: string; body: unknown }

function harness(catalogMode: "readable" | "encrypted" | "plain" | undefined) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.endsWith("/v1/status")) {
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        llave: { keyId: "key-1", ...(catalogMode === undefined ? {} : { catalogMode }) },
      }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, codigoGeneracion: "CG" }), { status: 200 }));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ region: false, apiKey: "key-1.secret", fetch, maxRetries: 0, clock: false }) };
}

const request = {
  tipoDte: "01" as const,
  receptor: { customerId: "customer-1" },
  items: [{ productId: "product-1", cantidad: 2 }],
};

for (const mode of ["readable", "encrypted", "plain", undefined] as const) {
  Deno.test(`ids travel untouched when the key reports catalogMode ${String(mode)}`, async () => {
    const { calls, facta } = harness(mode);
    await facta.issue(request, { idempotencyKey: "k1" } as never);
    const issue = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/dte"));
    assertEquals(issue?.body, request);
    assertEquals(calls.some((call) => call.url.endsWith("/v1/vault/destinations")), false);
    assertEquals(calls.some((call) => call.url.endsWith("/v1/status")), false);
  });
}

Deno.test("prepare sends ids untouched too", async () => {
  const { calls, facta } = harness("encrypted");
  await facta.prepare(request);
  const prepare = calls.find((call) => call.url.endsWith("/v1/dte/prepare"));
  assertEquals(prepare?.body, request);
});

Deno.test("the retired snapshot API is gone from the client", () => {
  const facta = harness("encrypted").facta as unknown as Record<string, unknown>;
  assertEquals(typeof facta["syncCatalog"], "undefined");
  assertEquals(typeof facta["catalogState"], "undefined");
});
