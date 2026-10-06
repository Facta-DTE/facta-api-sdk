// Development-only backend for looking at the screens without keys (`?mock=1` on the Vite dev
// server). It reuses the SDK preview's in-browser handler. `main.tsx` imports this file only
// behind `import.meta.env.DEV`, so it is never part of a production build.

import { createMockFetch, type Outcome } from "../../examples/react-preview/src/mock-handler.ts";
import { mockHoldingBase64, mockRecipeFiles, MOCK_CODE, MOCK_SEAL } from "./mock-dte.ts";
import { ApiError, installMock, type CreatedSession, type IssuedDocument, type PlaygroundState } from "./api.ts";

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "sealed-delivered", "sealed-delivering", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function installDevMock(search: string): void {
  const params = new URLSearchParams(search);
  // `&slow=3000` makes every server call take that long (to look at the loading states);
  // `&ratelimit=1` makes the API answer `rate_limited` to reads, as the real one does when its window is spent.
  const slow = Math.max(0, Number(params.get("slow")) || 0);
  const rateLimited = params.get("ratelimit") === "1";
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
  installMock({
    fetch: limited(withStoredJson(createMockFetch({ outcome, environment: "00", ...(slow > 0 ? { latencyMs: slow } : {}) })), rateLimited),
    state: () => state,
    session: async (sale): Promise<CreatedSession> => (await sleep(slow), { session: `tok-${++n}`, total: sale.lines.reduce((sum, l) => sum + l.cantidad * (l.precioUni ?? 8.5), 0), title: "Venta de prueba", emailTo: sale.sendEmail && sale.emailTo ? `${sale.emailTo.slice(0, 1)}•••@${sale.emailTo.split("@")[1] ?? ""}` : null }),
    issued: () => issued,
    invalidation: () => "inv-ok",
    // `&resend=limit` shows the limit state; `&resend=closed` the closed five-minute window.
    resend: () => {
      if (params.get("resend") === "limit") throw new ApiError("mail_quota_exceeded", "Se alcanzó el límite de envíos: este documento ya se envió hace poco (uno cada 10 minutos). Podrá reenviarlo en 9 min.", 429);
      if (params.get("resend") === "closed") throw new ApiError("delivery_window_closed", "El plazo para reenviar este documento venció. Emita uno nuevo.", 410);
      return { estado: "enviado", destino: "c•••@example.com" };
    },
  });
  mockRegistry(slow, rateLimited, outcome === "contingency");
}

/** `documents.download` kind json answers with the stored holding file, as the real handler does. */
function withStoredJson(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string; kind?: string; codigoGeneracion?: string };
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
function mockRegistry(slow: number, rateLimited: boolean, contingency: boolean): void {
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
      const body = JSON.parse(String(init?.body ?? "{}")) as { recipe?: string; stage?: string };
      return json(200, {
        recipe: body.recipe, stage: body.stage ?? "run", runId: "mock-run-0001", ok: true, totalMs: 1180,
        steps: [{ method: "POST", endpoint: "/v1/dte", status: 200, ms: 1.18 * 1000, request: { tipoDte: "01" } }],
        result: { estado: contingency ? "contingencia" : "sellado", numeroControl: "DTE-01-M001P001-000000000000215", ...(contingency ? { selloRecibido: null } : { selloRecibido: MOCK_SEAL }), documento: "[omitido]", jws: "[omitido: 700 caracteres]" },
        files: mockRecipeFiles(contingency), issued: [], invalidated: [],
      });
    }
    return real(input, init);
  };
}
