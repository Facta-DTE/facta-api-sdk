import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { fingerprintV1 } from "../src/jcs.ts";
import type { DteRequest } from "../src/types.ts";

// conformance/fingerprint-v1.md. Since 0.6 the SDK no longer resolves catalogue ids locally, so the
// server's claim hashes the body and the SDK sends NO fingerprint header (AP-07). The fingerprint
// computation stays for journals written by 0.5 (recovery) and is pinned by the conformance vectors.

interface Seen { method: string; path: string; headers: Headers; body: string | null }

const HEADER = "X-Facta-Request-Fingerprint";
const SEALED = {
  estado: "sellado", codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0", numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01", ambiente: "00", selloRecibido: "seal", totales: { totalPagar: 1 },
};
const PREPARED = { prepareToken: "pt", documento: { identificacion: {} } };

function transport() {
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

Deno.test("issue sends no fingerprint header and leaves the body alone", async () => {
  const { fetch, seen } = transport();
  await client(fetch).issue(REQUEST);
  const post = seen.find((call) => call.path === "/v1/dte")!;
  assertEquals(post.headers.has(HEADER), false);
  assertEquals(post.body, JSON.stringify(REQUEST));
});

Deno.test("issue with delivery options still sends no fingerprint", async () => {
  const { fetch, seen } = transport();
  await client(fetch).issue(REQUEST, { deliver: { email: "cliente@ejemplo.com" } });
  const post = seen.find((call) => call.path === "/v1/dte")!;
  const body = JSON.parse(post.body!);
  assertEquals(typeof body.entrega, "object");
  assertEquals(post.headers.has(HEADER), false);
});

Deno.test("prepare, sign and invalidate send no fingerprint", async () => {
  const { fetch, seen } = transport();
  const facta = client(fetch);
  const prepared = await facta.prepare(REQUEST);
  await facta.sign(prepared);
  await facta.invalidate(SEALED.codigoGeneracion, {
    tipoAnulacion: 1,
    responsable: { nombre: "A", tipoDocumento: "36", numDocumento: "06140000000001" },
    solicita: { nombre: "B", tipoDocumento: "36", numDocumento: "06140000000001" },
  });
  assertEquals(seen.some((call) => call.headers.has(HEADER)), false);
  assertEquals(seen.filter((call) => call.method === "GET").some((call) => call.headers.has(HEADER)), false);
});

Deno.test("a retry within one call resends the same body bytes and the same idempotency key", async () => {
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

Deno.test("the fingerprint of a request is still computable for old journals", async () => {
  assertEquals((await fingerprintV1(REQUEST)).length, 64);
});
