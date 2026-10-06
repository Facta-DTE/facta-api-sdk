import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";

// A key whose owner enabled «Catálogo legible por la API» sends ids as they
// are: the server resolves them, so no unlock key and no vault download.

interface Call { method: string; url: string; body: unknown }

function harness(catalogMode: "readable" | "encrypted" | undefined, statusFails = false) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.endsWith("/v1/status")) {
      if (statusFails) return Promise.resolve(new Response("{}", { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        llave: { keyId: "key-1", ...(catalogMode === undefined ? {} : { catalogMode }) },
      }), { status: 200 }));
    }
    if (url.endsWith("/v1/vault/destinations")) {
      return Promise.resolve(new Response(JSON.stringify({ code: "no_storage_destination", message: "x" }), { status: 422 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, codigoGeneracion: "CG" }), { status: 200 }));
  }) as typeof globalThis.fetch;
  return { calls, facta: new Facta({ region: false, apiKey: "key-1.secret", fetch, maxRetries: 0 }) };
}

const request = {
  tipoDte: "01" as const,
  receptor: { customerId: "customer-1" },
  items: [{ productId: "product-1", cantidad: 2 }],
};

Deno.test("a readable-catalog key sends ids untouched, with no unlock key and no vault download", async () => {
  const { calls, facta } = harness("readable");
  await facta.issue(request, { idempotencyKey: "k1" } as never);
  const issue = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/dte"));
  assertEquals(issue?.body, request);
  assertEquals(calls.some((call) => call.url.endsWith("/v1/vault/destinations")), false);
});

Deno.test("the advertised mode is cached, so a second emission does not ask status again", async () => {
  const { calls, facta } = harness("readable");
  await facta.issue(request, { idempotencyKey: "k1" } as never);
  await facta.issue(request, { idempotencyKey: "k2" } as never);
  assertEquals(calls.filter((call) => call.url.endsWith("/v1/status")).length, 1);
});

async function issueCode(facta: Facta): Promise<string> {
  return await facta.issue(request, { idempotencyKey: "k1" } as never).then(
    () => "",
    (cause) => (cause as { code?: string }).code ?? "unknown",
  );
}

// Local resolution needs FACTA_UNLOCK_KEY: without it the SDK refuses before
// sending anything, which is exactly what it did before this feature.
Deno.test("an encrypted key still resolves locally (and needs the unlock key, as before)", async () => {
  const { calls, facta } = harness("encrypted");
  assertEquals(await issueCode(facta), "unauthorized");
  assertEquals(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/dte")), false);
});

Deno.test("an older server that does not advertise a mode keeps the local path", async () => {
  const { calls, facta } = harness(undefined);
  assertEquals(await issueCode(facta), "unauthorized");
  assertEquals(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/dte")), false);
});

Deno.test("a status failure falls back to the previous behaviour instead of blocking", async () => {
  const { calls, facta } = harness("readable", true);
  assertEquals(await issueCode(facta), "unauthorized");
  assertEquals(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/dte")), false);
});

Deno.test("a request that names no catalog record never asks for the mode", async () => {
  const { calls, facta } = harness("readable");
  await facta.issue({
    tipoDte: "01",
    items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 5 }],
  }, { idempotencyKey: "k1" } as never);
  assertEquals(calls.some((call) => call.url.endsWith("/v1/status")), false);
});
