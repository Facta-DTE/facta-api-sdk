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

// ── recoverServerPending ──────────────────────────────────────────────────

function routedFetch(routes: (url: string, method: string) => { status: number; body: unknown }) {
  const calls: Recorded[] = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(url), method,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const answer = routes(String(url), method);
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const pendingRow = (code: string, over: Record<string, unknown> = {}) => ({
  codigoGeneracion: code, numeroControl: `N-${code}`, tipoDte: "01", estado: "firmado",
  reintentable: true, motivoNoReintentable: null, intentos: 0, ultimaRespuestaMh: null, ...over,
});
const CODES = ["A1A1A1A1-0000-4000-8000-00000000000A", "B2B2B2B2-0000-4000-8000-00000000000B", "C3C3C3C3-0000-4000-8000-00000000000C", "D4D4D4D4-0000-4000-8000-00000000000D", "E5E5E5E5-0000-4000-8000-00000000000E"];
const sealedBody = (code: string, via = "retransmision") => ({ estado: "sellado", via, codigoGeneracion: code, numeroControl: "N", tipoDte: "01", ambiente: "00", selloRecibido: "SEAL" });

Deno.test("recoverServerPending reports every outcome, never throws per document, and sends only list + reintentar", async () => {
  const { fetch, calls } = routedFetch((url, method) => {
    if (method === "GET") {
      return { status: 200, body: { pendientes: [
        pendingRow(CODES[0]!), pendingRow(CODES[1]!), pendingRow(CODES[2]!),
        pendingRow(CODES[3]!, { reintentable: false, motivoNoReintentable: "documento_de_la_aplicacion" }), pendingRow(CODES[4]!),
      ], siguiente: null } };
    }
    if (url.includes(CODES[0]!)) return { status: 200, body: sealedBody(CODES[0]!) };
    if (url.includes(CODES[1]!)) return { status: 422, body: { error: { code: "mh_rejected", message: "VALOR NO PERMITIDO", details: { codigoGeneracion: CODES[1] } } } };
    if (url.includes(CODES[2]!)) return { status: 202, body: { estado: "pendiente", via: "retransmision", codigoGeneracion: CODES[2], numeroControl: "N", tipoDte: "01", ambiente: "00", mhRespondio: false, detalle: null, observaciones: [] } };
    return { status: 500, body: { error: { code: "internal_error", message: "boom" } } };
  });
  const report = await client(fetch, { maxRetries: 0 }).recoverServerPending();
  assertEquals([report.examined, report.sealed, report.rejected, report.pending, report.notRetryable, report.errors], [5, 1, 1, 1, 1, 1]);
  assertEquals(report.results.map((r) => r.outcome), ["sealed", "rejected", "pending", "not_retryable", "error"]);
  assertEquals(report.results[0]!.via, "retransmision");
  assertEquals(report.results[3]!.motivo, "documento_de_la_aplicacion");
  assertEquals(report.truncated, false);
  // The app-issued document was never retried.
  assertEquals(calls.filter((c) => c.method === "POST").length, 4);
  assertEquals(calls.filter((c) => c.method === "POST").every((c) => c.url.endsWith("/reintentar") && c.headers["X-Facta-Sign-Key"] === SIGN_KEY && c.body === null), true);
  assertEquals(calls.some((c) => c.url.includes("/v1/dte") && c.method === "POST" && !c.url.endsWith("/reintentar")), false);
});

Deno.test("recoverServerPending honours limit across pages and says it was truncated", async () => {
  const { fetch, calls } = routedFetch((url, method) => {
    if (method === "GET") {
      const second = url.includes("cursor=p2");
      return { status: 200, body: second
        ? { pendientes: [pendingRow(CODES[2]!), pendingRow(CODES[3]!)], siguiente: null }
        : { pendientes: [pendingRow(CODES[0]!), pendingRow(CODES[1]!)], siguiente: "p2" } };
    }
    return { status: 200, body: sealedBody(CODES[0]!, "consulta") };
  });
  const report = await client(fetch).recoverServerPending({ limit: 3 });
  assertEquals(report.examined, 3);
  assertEquals(report.truncated, true);
  assertEquals(calls.filter((c) => c.method === "POST").length, 3);
  assert(calls[0]!.url.includes("limit=3"));
  assert(calls[0]!.url.includes("estado=firmado"));
});

Deno.test("recoverServerPending on an empty list does nothing", async () => {
  const { fetch, calls } = routedFetch(() => ({ status: 200, body: { pendientes: [], siguiente: null } }));
  const report = await client(fetch).recoverServerPending();
  assertEquals(report.examined, 0);
  assertEquals(calls.length, 1);
});

Deno.test("recoverServerPending treats retry_in_progress as pending and an unreadable list as an error", async () => {
  const busy = routedFetch((_url, method) =>
    method === "GET"
      ? { status: 200, body: { pendientes: [pendingRow(CODES[0]!)], siguiente: null } }
      : { status: 409, body: { error: { code: "retry_in_progress", message: "en curso", details: { retryAfterSeconds: 0.001 } } } });
  const report = await client(busy.fetch, { maxRetries: 0 }).recoverServerPending();
  assertEquals(report.results[0]!.outcome, "pending");
  const down = routedFetch(() => ({ status: 401, body: { error: { code: "invalid_api_key", message: "no" } } }));
  await assertRejects(() => client(down.fetch, { maxRetries: 0 }).recoverServerPending(), FactaError);
});

Deno.test("recoverServerPending stops when the signal aborts", async () => {
  const controller = new AbortController();
  const { fetch } = routedFetch(() => ({ status: 200, body: { pendientes: [pendingRow(CODES[0]!)], siguiente: null } }));
  controller.abort();
  await assertRejects(() => client(fetch).recoverServerPending({ signal: controller.signal }));
});
