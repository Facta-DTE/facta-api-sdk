// Development-only backend for looking at the screens without keys (`?mock=1` on the Vite dev
// server). It reuses the SDK preview's in-browser handler. `main.tsx` imports this file only
// behind `import.meta.env.DEV`, so it is never part of a production build.

import { createMockFetch, type Outcome } from "../../examples/react-preview/src/mock-handler.ts";
import { mockHoldingBase64, mockPdfBase64, mockRecipeFiles, MOCK_CODE, MOCK_SEAL } from "./mock-dte.ts";
import { ApiError, installMock, type CreatedSession, type IssuedDocument, type PlaygroundState } from "./api.ts";
import { setTimingsEnabled, timingsEnabled } from "./timings.ts";
import { maskCustomer, maskProduct } from "../server/catalog-mask.ts";
import { TIMINGS_HEADER, type Timings } from "../shared/timings.ts";
import { orderToRequest, OrderError, type Order } from "../server/recipes/order-webhook.ts";

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "sealed-delivered", "sealed-delivering", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function installDevMock(search: string): void {
  const params = new URLSearchParams(search);
  // `&slow=3000` makes every server call take that long (to look at the loading states);
  // `&ratelimit=1` makes the API answer `rate_limited` to reads, as the real one does when its window is spent.
  const slow = Math.max(0, Number(params.get("slow")) || 0);
  const rateLimited = params.get("ratelimit") === "1";
  // `&timings=1` turns «Mostrar tiempos» on; `&apidebug=1` pretends the API already returns its own breakdown.
  if (params.get("timings") === "1") setTimingsEnabled(true);
  const apiDebug = params.get("apidebug") === "1";
  const asked = params.get("outcome") as Outcome | null;
  const outcome: Outcome = asked !== null && OUTCOMES.includes(asked) ? asked : "sealed";
  const issued: IssuedDocument[] = [{ codigoGeneracion: "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F777", tipoDte: "03", numeroControl: "DTE-03-M001P001-000000000000040", issuedAt: new Date().toISOString(), estado: "sellado", total: 113 }, { codigoGeneracion: "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000042", issuedAt: new Date().toISOString(), estado: "sellado" }];
  const state: PlaygroundState = {
    environment: "00",
    apiHost: "eobxzotnqzgtpuqvmpkc.supabase.co",
    visitor: { label: "V-3FA9C2", email: null, via: "cookie" },
    auth: "turnstile",
    turnstileSiteKey: null,
    mail: { allowed: true, remainingHour: 3, remainingDay: 17 },
    whatsapp: false,
    quota: { allowed: true, remainingHour: 20, remainingDay: 100 },
    supportedTypes: ["01", "03", "05", "06", "11", "14"],
    catalog: params.get("catalog") !== "0",
    catalogReceiverTypes: ["01", "03", "05", "06"],
    demo: {
      customers: [
        { id: "c-biz", label: "Ferretería San Miguel (contribuyente)", fits: ["01", "03", "05", "06"], contributor: true },
        { id: "c-abroad", label: "Brumas Coffee Imports LLC (extranjero)", fits: ["01", "11"], contributor: false },
        { id: "c-excl", label: "Rosa Elena Campos (sujeto excluido)", fits: ["01", "14"], contributor: false },
      ],
      products: [
        { id: "p-cafe", label: "Café de altura", descripcion: "Café de altura, bolsa de 1 lb", precioUni: 8.5 },
        { id: "p-pupusa", label: "Pupusa revuelta", descripcion: "Pupusa revuelta", precioUni: 1.25 },
      ],
      builtInReceivers: [],
      canInvalidate: true,
    },
  };
  let n = 0;
  // Like the Worker: the order number is the key, so the same number prepared twice is the same key.
  const sessionKeys = new Map<string, string>();
  installMock({
    fetch: limited(withPlayground(withStoredJson(createMockFetch({ outcome, environment: "00", ...(slow > 0 ? { latencyMs: slow } : {}) })), sessionKeys, apiDebug), rateLimited),
    state: () => state,
    session: async (sale): Promise<CreatedSession> => {
      await sleep(slow);
      const token = `tok-${++n}`;
      const orderNumber = sale.orderNumber ?? null;
      const idempotencyKey = `3fa9c2d1e0b7a455.${orderNumber === null ? `random-${n}` : `sale-${orderNumber}`}`;
      sessionKeys.set(token, idempotencyKey);
      return {
        session: token,
        total: sale.lines.reduce((sum, l) => sum + l.cantidad * (l.precioUni ?? 8.5), 0),
        title: "Venta de prueba",
        emailTo: sale.sendEmail && sale.emailTo ? `${sale.emailTo.slice(0, 1)}•••@${sale.emailTo.split("@")[1] ?? ""}` : null,
        orderNumber,
        idempotencyKey,
        ...(timingsEnabled() ? { timings: mockTimings([["Verificación de Turnstile", 0, 38], ["Documentos del visitante (registro)", 40, 14], ["Armado de la venta", 56, 3], ["Firma de la sesión", 60, 2]], 66, false) } : {}),
      };
    },
    issued: () => issued,
    invalidation: () => "inv-ok",
    // `&resend=limit` shows the limit state; `&resend=closed` the closed five-minute window.
    resend: () => {
      if (params.get("resend") === "limit") throw new ApiError("mail_quota_exceeded", "Se alcanzó el límite de envíos: este documento ya se envió hace poco (uno cada 10 minutos). Podrá reenviarlo en 9 min.", 429);
      if (params.get("resend") === "closed") throw new ApiError("delivery_window_closed", "El plazo para reenviar este documento venció. Emita uno nuevo.", 410);
      return { estado: "enviado", destino: "c•••@example.com" };
    },
  });
  mockRegistry(slow, rateLimited, outcome === "contingency", apiDebug);
}

/** A timings object like the Worker's: playground steps, plus API steps when `withApi` pretends the API returned them. */
function mockTimings(own: Array<[string, number, number]>, totalMs: number, withApi: boolean, apiAt = 90): Timings {
  const steps: Timings["steps"] = own.map(([step, startedAtMs, ms]) => ({ step, startedAtMs, ms, source: "playground" as const }));
  if (withApi) {
    for (const [step, offset, ms] of [["autenticación", 0, 6], ["correlativo", 7, 18], ["firma", 26, 41], ["Hacienda (recepción)", 68, 910], ["almacenamiento", 980, 120]] as const) {
      steps.push({ step: `API · ${step}`, startedAtMs: apiAt + offset, ms, source: "api" });
    }
  }
  return { steps: steps.sort((a, b) => a.startedAtMs - b.startedAtMs), totalMs, apiBreakdown: withApi };
}

/**
 * What the Worker adds to an issue: was it a replay (same key already issued, same document back), and the timings.
 * Mock only; the real logic is `server/router.ts`.
 */
function withPlayground(inner: typeof fetch, sessionKeys: Map<string, string>, apiDebug: boolean): typeof fetch {
  const sealed = new Map<string, string>();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string; session?: string };
    if (body.action !== "issue") return inner(input, init);
    const key = sessionKeys.get(body.session ?? "") ?? String(body.session);
    const replay = sealed.has(key);
    const started = performance.now();
    let text: string;
    if (replay) {
      await sleep(140);
      text = sealed.get(key)!;
    } else {
      const response = await inner(input, init);
      if (!response.ok) return response;
      text = await response.text();
      sealed.set(key, text);
    }
    const spent = Math.round(performance.now() - started);
    const timings = new Headers(init?.headers).get(TIMINGS_HEADER) === "1";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    parsed.playground = {
      replay,
      ...(timings ? { timings: mockTimings([["Límite de emisiones (solo comprobar)", 0, 9], ["Handler del SDK (todo lo siguiente)", 10, Math.max(spent, 60)], ["API · emitir (facta.issue)", 14, Math.max(spent - 8, 40)], ["Contar la emisión", 12 + Math.max(spent, 60), 7]], 30 + Math.max(spent, 60), apiDebug && !replay, 14) } : {}),
    };
    return new Response(JSON.stringify(parsed), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** `documents.download` kind json answers with the stored holding file, as the real handler does. */
function withStoredJson(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string; kind?: string; codigoGeneracion?: string; paperWidthMm?: number };
    if (body.action === "documents.download" && (body.kind === "pdf" || body.kind === "ticket")) {
      const code = body.codigoGeneracion ?? MOCK_CODE;
      const ticket = body.kind === "ticket";
      if (ticket && new URLSearchParams(window.location.search).get("ticket") === "missing") {
        return new Response(JSON.stringify({ error: { code: "return_pdf_unavailable", message: "no ticket", retryable: false } }), { status: 404, headers: { "content-type": "application/json" } });
      }
      const file = { codigoGeneracion: code, kind: body.kind, filename: `${code}${ticket ? "-ticket" : ""}.pdf`, contentType: "application/pdf", bytes: 1, base64: mockPdfBase64(ticket ? body.paperWidthMm ?? 80 : undefined) };
      return new Response(JSON.stringify({ file }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (body.action === "documents.download" && body.kind === "json") {
      const code = body.codigoGeneracion ?? MOCK_CODE;
      const file = { codigoGeneracion: code, kind: "json", filename: `${code}.json`, contentType: "application/json", bytes: 1, base64: mockHoldingBase64() };
      return new Response(JSON.stringify({ file }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return inner(input, init);
  }) as typeof fetch;
}

/** The API's own rate limit, as the handler passes it on: reads answer 429 `rate_limited`, issuing keeps working. */
function limited(inner: typeof fetch, on: boolean): typeof fetch {
  if (!on) return inner;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const action = (JSON.parse(String(init?.body ?? "{}")) as { action?: string }).action ?? "";
    if (action === "issue" || action === "session.describe" || action === "delivery.status") return inner(input, init);
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "El playground alcanzó el límite de pruebas por hora; intente en unos minutos.", retryable: true } }), { status: 429, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

// /api/registro is read with a plain fetch (not the SDK's), so the dev mock answers it here.
function mockRegistry(slow: number, rateLimited: boolean, contingency: boolean, apiDebug: boolean): void {
  const real = window.fetch.bind(window);
  const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const full = (n: number, tipoDte: string, estado: string, total: number, observaciones: string[] = []) => ({ estado, fecEmi: "2026-10-06", horEmi: "10:42:00", selloRecibido: estado === "rechazado" ? null : MOCK_SEAL, observaciones, totales: { montoTotalOperacion: total }, numeroControl: n });
  // Like the real server: the ledger carries the total; `current` comes only from the cache or an enrichment.
  const row = (n: number, tipoDte: string, estado: string, h: number, total: number, observaciones: string[] = [], cached = true) => ({
    codigoGeneracion: `7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F${String(600 + n).padStart(3, "0")}`,
    tipoDte, estado, issuedAt: hours(h), total,
    numeroControl: `DTE-${tipoDte}-M001P001-${String(n).padStart(15, "0")}`,
    current: cached ? full(n, tipoDte, estado, total, observaciones) : null,
  });
  const documents = [
    row(214, "01", "sellado", 0.3, 12.5),
    row(88, "03", "rechazado", 0.5, 113, ["Campo #/receptor/nrc no cumple el formato requerido"]),
    row(213, "01", "invalidado", 1, 8.5),
    row(12, "05", "contingencia", 17, 4, [], false),
  ];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname === "/api/registro") {
      await sleep(slow);
      return json(200, { documents });
    }
    if (parsed.pathname === "/api/registro/enrich") {
      await sleep(slow);
      if (rateLimited) return json(429, { error: { code: "rate_limited", message: "El playground alcanzó el límite de pruebas por hora; intente en unos minutos.", retryable: true } });
      const codes = (parsed.searchParams.get("codes") ?? "").split(",");
      return json(200, { documents: documents.filter((d) => codes.includes(d.codigoGeneracion)).map((d) => ({ ...d, current: d.current ?? full(0, d.tipoDte, d.estado, d.total) })) });
    }
    if (parsed.pathname === "/api/recipes/run") {
      // A recipe takes a while at the real API: this one takes `slow` ms (or 1.2 s) so the running state can be seen.
      await sleep(slow > 0 ? slow : 1200);
      const body = JSON.parse(String(init?.body ?? "{}")) as { recipe?: string; stage?: string; params?: Record<string, unknown> };
      const keyed = mockKeyedRun(body);
      if (keyed !== null) {
        if ("error" in keyed) return json(400, { error: { code: "order_invalid", message: keyed.error, retryable: false } });
        await sleep(keyed.replay ? 210 : slow > 0 ? slow : 1200);
        return json(200, {
          recipe: body.recipe, stage: body.stage ?? "run", runId: "mock-run-0001", ok: true, totalMs: keyed.replay ? 210 : 1840,
          steps: [{ method: "POST", endpoint: "/v1/dte", status: 200, ms: keyed.replay ? 210 : 1840 }],
          result: { result: { estado: "sellado", numeroControl: keyed.doc.control, selloRecibido: MOCK_SEAL, totales: { totalPagar: keyed.doc.total } } },
          ...(new Headers(init?.headers).get(TIMINGS_HEADER) === "1" ? { timings: mockTimings([["Verificación de Turnstile", 0, 41], ["Armado de la receta", 42, 4], ["API · POST /v1/dte", 50, keyed.replay ? 150 : 1700]], keyed.replay ? 230 : 1800, false, 50) } : {}),
          files: [], issued: [{ codigoGeneracion: keyed.doc.code, tipoDte: keyed.doc.type, numeroControl: keyed.doc.control, total: keyed.doc.total }], invalidated: [],
        });
      }
      const wantsTimings = new Headers(init?.headers).get(TIMINGS_HEADER) === "1";
      const mail = body.recipe === "deliver-email";
      const send = mail && body.stage === "send";
      const own: Array<[string, number, number]> = [["Verificación de Turnstile", 0, 41], ["Armado de la receta", 42, 4], ["Límites de correo", 47, 12], ["Límite de emisiones (solo comprobar)", 60, 9]];
      const timings = wantsTimings ? mockTimings(send ? own.slice(0, 3) : own, 1300, false) : undefined;
      if (mail) {
        // A real five-minute window, so the countdown on the page runs. `?outcome=contingency` has no token;
        // `?send=expired` makes the second call answer `entrega_vencida` (410).
        const dueAt = new Date(Date.now() + 5 * 60_000).toISOString();
        if (send && new URLSearchParams(window.location.search).get("send") === "expired") return json(410, { error: { code: "entrega_vencida", message: "El token de entrega venció.", retryable: false } });
        const calls = send
          ? [{ method: "POST", endpoint: "/v1/dte/7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F777/entrega/correo", status: 200, ms: 410 }, { method: "GET", endpoint: "/v1/dte/7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F777/entrega", status: 200, ms: 160 }]
          : [{ method: "POST", endpoint: "/v1/dte", status: 200, ms: 1180, request: { tipoDte: "01", entrega: { correo: "c•••@example.com" } } }];
        return json(200, {
          recipe: body.recipe, stage: body.stage ?? "issue", runId: "mock-run-0001", ok: true, totalMs: send ? 640 : 1180, steps: calls,
          result: send
            ? { codigoGeneracion: MOCK_CODE, destino: "c•••@example.com", channel: { estado: "enviado", destino: "c•••@example.com" }, delivery: { codigoGeneracion: MOCK_CODE, canales: { correo: { estado: "enviado", destino: "c•••@example.com" } }, settled: true } }
            : { issued: { estado: "sellado", numeroControl: "DTE-01-M001P001-000000000000215", selloRecibido: MOCK_SEAL, documento: "[omitido]", jws: "[omitido: 700 caracteres]" }, entrega: { tokenRecibido: !contingency, ...(contingency ? {} : { token: "fdt_mock_8hQ2x1LkPz9VbT4mYw7NcR0aSdE6uJgF" }), venceEn: contingency ? null : dueAt, canales: { correo: { estado: "pendiente", destino: "c•••@example.com" } } } },
          files: send ? [] : mockRecipeFiles(false), issued: send ? [] : [{ codigoGeneracion: MOCK_CODE, tipoDte: "01" }], invalidated: [],
          ...(send || contingency ? {} : { continuation: "mock-continuation-token-0123456789-0123456789-0123456789" }),
          ...(timings === undefined ? {} : { timings }),
        });
      }
      if (body.recipe === "catalog-refs") {
        // The same masking the Worker applies, over invented records.
        const customers = [
          { id: "cus_8f2a", name: "Ferretería Díaz S.A. de C.V.", doc_type: "36", doc_number: "0614-210389-102-4", nrc: "123456-7", activity_code: "47521", address: { departamento: "06", municipio: "14", distrito: "01", complemento: "Colonia Escalón, calle 5, casa 22", pais: "SV" }, phone: "2222-3344", email: "compras@ferreteriadiaz.com.sv" },
          { id: "cus_91c4", name: "Ana Lucía Pérez", doc_type: "13", doc_number: "04829316-5", nrc: null, activity_code: null, address: null, phone: null, email: "ana.perez@example.com" },
        ].map(maskCustomer);
        const products = [
          { id: "prd_01", code: "TOR-14", barcode: "7401001234567", description: "Tornillo 1/4 x 2 in (caja de 100)", item_type: 1, unit_of_measure: 59, unit_price: 12.5, vat_included: false, active: true, sale_class: "gravada" },
          { id: "prd_02", code: "SRV-01", barcode: null, description: "Instalación a domicilio", item_type: 2, unit_of_measure: 99, unit_price: 30, vat_included: true, active: true },
        ].map(maskProduct);
        return json(200, { recipe: body.recipe, stage: "run", runId: "mock-run-0001", ok: true, totalMs: 640, steps: [{ method: "GET", endpoint: "/v1/status", status: 200, ms: 90 }], result: { catalogMode: "encrypted", customers, products, result: null }, files: [], issued: [], invalidated: [] });
      }
      return json(200, {
        recipe: body.recipe, stage: body.stage ?? "run", runId: "mock-run-0001", ok: true, totalMs: 1180,
        steps: [{ method: "POST", endpoint: "/v1/dte", status: 200, ms: 1.18 * 1000, request: { tipoDte: "01" } }],
        result: { estado: contingency ? "contingencia" : "sellado", numeroControl: "DTE-01-M001P001-000000000000215", ...(contingency ? { selloRecibido: null } : { selloRecibido: MOCK_SEAL }), documento: "[omitido]", jws: "[omitido: 700 caracteres]" },
        files: mockRecipeFiles(contingency), issued: [], invalidated: [],
        ...(wantsTimings ? { timings: mockTimings([...own, ["API · POST /v1/dte", 72, 1180]], 1300, apiDebug, 72) } : {}),
      });
    }
    return real(input, init);
  };
}


// Dev mock of the keyed recipes: the same order (or order number) answers the same document, like the real API.
const keyedDocs = new Map<string, { code: string; control: string; total: number; type: string }>();
function mockKeyedRun(body: { recipe?: string; params?: Record<string, unknown> }): { error: string } | { replay: boolean; doc: { code: string; control: string; total: number; type: string } } | null {
  let key: string; let total = 11.3; let type = String(body.params?.type ?? "01");
  if (body.recipe === "order-webhook") {
    let order: Order;
    try { order = JSON.parse(String(body.params?.order)) as Order; } catch { return { error: "El pedido no es un JSON válido." }; }
    try {
      const request = orderToRequest(order);
      total = (request.items as Array<{ cantidad: number; precioUni: number }>).reduce((sum, i) => Math.round((sum + i.cantidad * i.precioUni) * 100) / 100, 0);
    } catch (error) {
      return { error: error instanceof OrderError ? error.message : "El pedido no es válido." };
    }
    key = `order-${order.orderId}`; type = "01";
  } else if (["issue-idempotent", "status-recovery"].includes(String(body.recipe)) && typeof body.params?.orderNumber === "string") {
    key = `${body.recipe}.${body.params.orderNumber}.${type}`;
  } else return null;
  const known = keyedDocs.get(key);
  if (known !== undefined) return { replay: true, doc: known };
  const n = keyedDocs.size + 341;
  const doc = { code: `7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F${String(n).padStart(3, "0")}`, control: `DTE-${type}-M001P001-${String(n).padStart(15, "0")}`, total, type };
  keyedDocs.set(key, doc);
  return { replay: false, doc };
}
