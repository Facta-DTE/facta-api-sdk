import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { fingerprintV1 } from "../src/jcs.ts";
import type { CatalogSnapshot, DteRequest } from "../src/types.ts";
import { encryptedCatalogBundle } from "./catalog-bundle.ts";

// conformance/fingerprint-v1.md: the header is sent on the two routes whose claim may be
// hashed by fingerprint and nowhere else; bodies are not touched.

interface Seen { method: string; path: string; headers: Headers; body: string | null }

const HEADER = "X-Facta-Request-Fingerprint";
const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0", numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01", ambiente: "00", selloRecibido: "seal", totales: { totalPagar: 1 },
};
const PREPARED = { prepareToken: "pt", documento: { identificacion: {} } };

function transport(options: { snapshot?: CatalogSnapshot; bundle?: unknown } = {}) {
  const seen: Seen[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^.*\/v1/, "/v1");
    const method = init?.method ?? "GET";
    seen.push({ method, path, headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : null });
    const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
    if (path === "/v1/status") {
      return json({
        ok: true,
        llave: { keyId: "key-1", alcances: ["catalog:read"], catalogMode: "encrypted" },
        sincronizacion: { catalog: { status: "ready", desiredRevision: 3, publishedRevision: 3 } },
      });
    }
    if (path === "/v1/vault/destinations") return json(options.bundle);
    if (path === "/v1/dte/prepare") return json(PREPARED);
    if (path === "/v1/dte" || path === "/v1/dte/sign") return json(SEALED);
    if (path.endsWith("/invalidate")) return json({ estado: "invalidado" });
    return json({ error: { code: "not_found", message: "no" } }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const client = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) =>
  new Facta({ apiKey: "key-1.secret", fetch, region: false, clock: false, maxRetries: 0, ...extra });

const REQUEST: DteRequest = { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1.5, precioUni: 2.5 }] };

Deno.test("issue sends the fingerprint of the request it was given, and leaves the body alone", async () => {
  const { fetch, seen } = transport();
  await client(fetch).issue(REQUEST);
  const post = seen.find((call) => call.path === "/v1/dte")!;
  assertEquals(post.headers.get(HEADER), await fingerprintV1(REQUEST));
  assertEquals(post.body, JSON.stringify(REQUEST));
});

Deno.test("issue includes delivery options in the fingerprint", async () => {
  const { fetch, seen } = transport();
  await client(fetch).issue(REQUEST, { deliver: { email: "cliente@ejemplo.com" } });
  const post = seen.find((call) => call.path === "/v1/dte")!;
  const body = JSON.parse(post.body!);
  assertEquals(typeof body.entrega, "object");
  assertEquals(post.headers.get(HEADER), await fingerprintV1(body));
});

Deno.test("prepare sends the fingerprint; sign and invalidate do not", async () => {
  const { fetch, seen } = transport();
  const facta = client(fetch);
  const prepared = await facta.prepare(REQUEST);
  assertEquals(seen.find((call) => call.path === "/v1/dte/prepare")!.headers.get(HEADER), await fingerprintV1(REQUEST));
  await facta.sign(prepared);
  await facta.invalidate(SEALED.codigoGeneracion, {
    tipoAnulacion: 1,
    responsable: { nombre: "A", tipoDocumento: "36", numDocumento: "06140000000001" },
    solicita: { nombre: "B", tipoDocumento: "36", numDocumento: "06140000000001" },
  });
  const others = seen.filter((call) => call.path !== "/v1/dte/prepare");
  assertEquals(others.some((call) => call.headers.has(HEADER)), false);
  assertEquals(seen.filter((call) => call.method === "GET").some((call) => call.headers.has(HEADER)), false);
});

Deno.test("a retry within one call resends the same body bytes and the same fingerprint", async () => {
  const seen: Array<{ body: string | null; fingerprint: string | null; key: string | null }> = [];
  const fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({ body: init?.body as string, fingerprint: headers.get(HEADER), key: headers.get("Idempotency-Key") });
    return Promise.resolve(seen.length === 1
      ? new Response(JSON.stringify({ error: { code: "service_unavailable", message: "x" } }), { status: 503 })
      : new Response(JSON.stringify(SEALED), { status: 200 }));
  }) as typeof globalThis.fetch;
  await new Facta({ apiKey: "key-1.secret", fetch, region: false, clock: false, maxRetries: 2 }).issue(REQUEST);
  assertEquals(seen.length, 2);
  assertEquals(seen[0], seen[1]);
});

const snapshot = (price: number): CatalogSnapshot => ({
  version: 1,
  customers: [],
  products: [{
    id: "p1", code: "C-1", barcode: null, description: "Café", item_type: "1", unit_of_measure: "59",
    unit_price: price, vat_included: true, sale_class: "gravada", active: true,
  }],
});

Deno.test("a catalog edit between attempt and retry changes the body but not the fingerprint", async () => {
  const withProduct: DteRequest = { tipoDte: "01", items: [{ productId: "p1", cantidad: 2 }] };
  const sent: Array<{ fingerprint: string | null; body: string }> = [];
  for (const price of [10, 12.5]) {
    const { fetch, seen } = transport({ bundle: await encryptedCatalogBundle(snapshot(price), 3) });
    await client(fetch, { unlockKey: "factauk_test" }).issue(withProduct);
    const post = seen.find((call) => call.path === "/v1/dte")!;
    sent.push({ fingerprint: post.headers.get(HEADER), body: post.body! });
  }
  assertEquals(sent[0].body === sent[1].body, false, "the resolved bodies differ after the catalog edit");
  assertEquals(sent[0].body.includes("productId"), false);
  assertEquals(sent[0].fingerprint, sent[1].fingerprint);
  assertEquals(sent[0].fingerprint, await fingerprintV1(withProduct));
});
