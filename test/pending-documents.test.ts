// `listPendingDocuments` and `retryDocument`: the wire contract and the retry behaviour. What the
// server decides (consult first, same bytes, one claim) is the server's; here we prove the client
// asks the right route with the right credentials and never invents a second emission.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import type { PendingDocumentsPage, RetryResult } from "../mod.ts";

const SIGN_KEY = `factask_${"A".repeat(43)}`;
const CODE = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";

interface Recorded { url: string; method: string; headers: Record<string, string>; body: string | null }

function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const answer = answers[Math.min(index++, answers.length - 1)]!;
    return Promise.resolve(new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const client = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) =>
  new Facta({ region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: SIGN_KEY, fetch, ...extra });

const PAGE: PendingDocumentsPage = {
  pendientes: [{
    codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000417", tipoDte: "01", estado: "firmado",
    reintentable: true, motivoNoReintentable: null, intentos: 0, ultimaRespuestaMh: null,
  }],
  siguiente: null,
};

Deno.test("listPendingDocuments reads GET /v1/dte/pendientes with its filters and no signing key", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: PAGE }]);
  const page = await client(fetch).listPendingDocuments({ estado: "rechazado", limit: 10, cursor: "abc" });
  assertEquals(calls[0]!.method, "GET");
  assert(calls[0]!.url.endsWith("/v1/dte/pendientes?estado=rechazado&limit=10&cursor=abc"));
  assertEquals(calls[0]!.headers["X-Facta-Sign-Key"], undefined);
  assertEquals(page.pendientes[0]!.reintentable, true);
  const bare = fakeFetch([{ status: 200, body: PAGE }]);
  await client(bare.fetch).listPendingDocuments();
  assert(bare.calls[0]!.url.endsWith("/v1/dte/pendientes"));
});

Deno.test("retryDocument posts to /reintentar with the signing key and sends no body", async () => {
  const sealed: RetryResult = { estado: "sellado", via: "consulta", codigoGeneracion: CODE, numeroControl: "N", tipoDte: "01", ambiente: "00", selloRecibido: "SEAL" };
  const { fetch, calls } = fakeFetch([{ status: 200, body: sealed }]);
  const result = await client(fetch).retryDocument(CODE);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.method, "POST");
  assert(calls[0]!.url.endsWith(`/v1/dte/${CODE}/reintentar`));
  assertEquals(calls[0]!.headers["X-Facta-Sign-Key"], SIGN_KEY);
  assertEquals(calls[0]!.body, null);
  assertEquals(result.estado, "sellado");
});

Deno.test("a 202 pending answer is a result, not an error, and is never retried by the client", async () => {
  const pending: RetryResult = { estado: "pendiente", via: "retransmision", codigoGeneracion: CODE, numeroControl: "N", tipoDte: "01", ambiente: "00", mhRespondio: false, detalle: "sin conexión", observaciones: [] };
  const { fetch, calls } = fakeFetch([{ status: 202, body: pending }]);
  const result = await client(fetch).retryDocument(CODE);
  assertEquals(result.estado, "pendiente");
  assertEquals(calls.length, 1);
});

Deno.test("retry_in_progress is retried with the SAME idempotency key, waiting what the server asks", async () => {
  const busy = { error: { code: "retry_in_progress", message: "otro reintento en curso", details: { retryAfterSeconds: 0.01 } } };
  const sealed = { estado: "sellado", via: "retransmision", codigoGeneracion: CODE, numeroControl: "N", tipoDte: "01", ambiente: "00" };
  const { fetch, calls } = fakeFetch([{ status: 409, body: busy }, { status: 200, body: sealed }]);
  const result = await client(fetch, { maxRetries: 2 }).retryDocument(CODE);
  assertEquals(result.estado, "sellado");
  assertEquals(calls.length, 2);
  assertEquals(calls[0]!.headers["Idempotency-Key"], calls[1]!.headers["Idempotency-Key"]);
});

Deno.test("503 service_unavailable exposes retryAfterSeconds and replays the same key", async () => {
  const down = { error: { code: "service_unavailable", message: "no se pudo dejar constancia", details: { retryAfterSeconds: 5 } } };
  const { fetch, calls } = fakeFetch([{ status: 503, body: down }]);
  const error = await assertRejects(() => client(fetch, { maxRetries: 0 }).issue({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 1 }] }, { idempotencyKey: "pedido-1" }), FactaError);
  assertEquals(error.code, "service_unavailable");
  assertEquals(error.retryAfterSeconds, 5);
  assertEquals(calls[0]!.headers["Idempotency-Key"], "pedido-1");
});

Deno.test("document_not_retryable and mh_rejected are never retried and keep their details", async () => {
  const app = { error: { code: "document_not_retryable", message: "lo emitió la aplicación", details: { motivo: "documento_de_la_aplicacion" } } };
  const first = fakeFetch([{ status: 409, body: app }]);
  const error = await assertRejects(() => client(first.fetch, { maxRetries: 3 }).retryDocument(CODE), FactaError);
  assertEquals(error.code, "document_not_retryable");
  assertEquals((error.details as { motivo: string }).motivo, "documento_de_la_aplicacion");
  assertEquals(first.calls.length, 1);
  const refused = { error: { code: "mh_rejected", message: "VALOR NO PERMITIDO", details: { codigoGeneracion: CODE, numeroControl: "N" } } };
  const second = fakeFetch([{ status: 422, body: refused }]);
  const rejected = await assertRejects(() => client(second.fetch, { maxRetries: 3 }).retryDocument(CODE), FactaError);
  assertEquals(rejected.isRejection, true);
  assertEquals(second.calls.length, 1);
});

Deno.test("retryDocument never sends a document, a fingerprint or a new code", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { estado: "sellado", via: "ya_asentado", codigoGeneracion: CODE, numeroControl: "N", tipoDte: "01", ambiente: "00" } }]);
  await client(fetch).retryDocument(CODE);
  assertEquals(calls[0]!.body, null);
  assertEquals(calls[0]!.headers["X-Facta-Request-Fingerprint"], undefined);
});
