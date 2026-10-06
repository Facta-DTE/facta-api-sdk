// The playground's API: everything under /api/*. A pure `Request -> Response`
// function over the environment so the tests drive it without a Worker runtime.
//
// Routes
//   GET  /api/state    visitor, quota and demo data for the page
//   POST /api/session  validated sale description -> session token
//   POST /api/facta    the SDK handler (issue, status, documents, downloads…);
//                      per-document reads are limited to documents this visitor issued
//   GET  /api/registro the visitor's own documents, with their current state
//
// Extension points for later batches: add a route to ROUTES; add a type to
// `server/sale.ts`; add recipes under `server/recipes/` and route them here.

import { createFactaSession, verifyFactaSession } from "../../src/server/session.ts";
import { visitorFrom, type JwksSource, type Visitor } from "./access.ts";
import type { PlaygroundEnv } from "./env.ts";
import { createFactaParts, visitorTag, type FactaParts } from "./facta.ts";
import { FixturesError, parseFixtures, publicFixtures, type PlaygroundFixtures } from "./fixtures.ts";
import { checkGuard, STAGING_API_HOST } from "./guard.ts";
import { isGenerationCode, listIssued, ownsDocument, updateIssuedState } from "./issued-codes.ts";
import { projectDocument } from "../../src/server/capabilities.ts";
import { quotaMessage, type QuotaDecision } from "./quota.ts";
import { buildSale, SaleError, SUPPORTED_SALE_TYPES } from "./sale.ts";
import type { FactaLike } from "../../src/server/handler.ts";

export interface ApiDeps {
  keys?: JwksSource;
  now?: () => number;
  /** Tests inject a fake client; production builds the real `Facta`. */
  facta?: FactaLike;
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

const errorBody = (code: string, message: string, retryable = false) => ({ error: { code, message, retryable } });

// One handler per environment object (an isolate keeps the same `env`).
const partsCache = new WeakMap<object, { parts: FactaParts; visitors: WeakMap<Request, Promise<Visitor | null>> }>();

function partsFor(env: PlaygroundEnv, deps: ApiDeps) {
  const cached = partsCache.get(env);
  if (cached !== undefined && deps.facta === undefined) return cached;
  const visitors = new WeakMap<Request, Promise<Visitor | null>>();
  const visitorOf = (req: Request) => {
    let pending = visitors.get(req);
    if (pending === undefined) {
      pending = visitorFrom(req, env, deps.keys, deps.now?.());
      visitors.set(req, pending);
    }
    return pending;
  };
  const entry = { parts: createFactaParts(env, visitorOf, deps.facta), visitors };
  // `visitors` is keyed by Request, so a shared cache entry is safe across requests.
  if (deps.facta === undefined) partsCache.set(env, entry);
  return entry;
}

async function consumeQuota(env: PlaygroundEnv, email: string, key: string): Promise<QuotaDecision | null> {
  if (!env.QUOTA) return null;
  const stub = env.QUOTA.get(env.QUOTA.idFromName(email.toLowerCase()));
  const response = await stub.fetch(new Request("https://quota/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  }));
  if (!response.ok) return null;
  return (await response.json()) as QuotaDecision;
}

async function peekQuota(env: PlaygroundEnv, email: string): Promise<QuotaDecision | null> {
  if (!env.QUOTA) return null;
  const stub = env.QUOTA.get(env.QUOTA.idFromName(email.toLowerCase()));
  const response = await stub.fetch(new Request("https://quota/peek"));
  return response.ok ? ((await response.json()) as QuotaDecision) : null;
}

function requireBrowserJson(request: Request): Response | null {
  if (request.method !== "POST") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta POST."), { allow: "POST" });
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return jsonResponse(415, errorBody("bad_request", "El contenido debe ser application/json."));
  }
  if (request.headers.get("x-facta-ui") !== "1") return jsonResponse(400, errorBody("bad_request", "Falta el encabezado x-facta-ui."));
  return null;
}

async function loadFixtures(env: PlaygroundEnv): Promise<PlaygroundFixtures> {
  return parseFixtures(env.FACTA_DTE_FIXTURES_JSON);
}

/** Handler actions that name one document: only its issuer's visitor may use them. */
const PER_DOCUMENT_ACTIONS = new Set(["documents.get", "documents.download", "documents.copies", "documents.retryStorage"]);
const REGISTRY_ENRICH_LIMIT = 25;

export async function handleApi(request: Request, env: PlaygroundEnv, deps: ApiDeps = {}): Promise<Response> {
  const path = new URL(request.url).pathname;

  // 1. Fail closed, before anything else.
  const verdict = checkGuard(env, request.url);
  if (!verdict.ok) {
    return jsonResponse(503, errorBody(`playground_${verdict.code}`, verdict.message));
  }
  if (!env.QUOTA) {
    return jsonResponse(503, errorBody("playground_quota_missing", "Falta el contador de límites del playground."));
  }

  const { parts, visitors } = partsFor(env, deps);
  const visitorOf = (req: Request) => {
    let pending = visitors.get(req);
    if (pending === undefined) {
      pending = visitorFrom(req, env, deps.keys, deps.now?.());
      visitors.set(req, pending);
    }
    return pending;
  };

  if (path === "/api/state") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const visitor = await visitorOf(request);
    let fixtures: PlaygroundFixtures;
    try {
      fixtures = await loadFixtures(env);
    } catch (error) {
      if (error instanceof FixturesError) return jsonResponse(503, errorBody("playground_fixtures_invalid", "Los datos de demostración no son válidos."));
      throw error;
    }
    return jsonResponse(200, {
      environment: "00",
      apiHost: STAGING_API_HOST,
      visitor: visitor === null ? null : { email: visitor.email, via: visitor.via },
      quota: visitor === null ? null : await peekQuota(env, visitor.email),
      supportedTypes: SUPPORTED_SALE_TYPES,
      catalog: Boolean(env.FACTA_UNLOCK_KEY),
      demo: publicFixtures(fixtures),
    });
  }

  if (path === "/api/session") {
    const bad = requireBrowserJson(request);
    if (bad) return bad;
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para emitir facturas de prueba."));
    const body = await request.json().catch(() => null);
    try {
      const { sale, sendEmail } = buildSale(body, await loadFixtures(env));
      const idempotencyKey = `${await visitorTag(visitor.email)}.${crypto.randomUUID()}`;
      const session = await createFactaSession({
        request: sale.request,
        idempotencyKey,
        display: { total: sale.total, title: sale.title, reference: "Playground" },
        // D-6: e-mail only, only to the verified visitor. WhatsApp is never requested.
        ...(sendEmail ? { deliver: { email: visitor.email } } : {}),
      }, env.FACTA_SESSION_SECRET!, deps.now?.());
      return jsonResponse(200, { session, total: sale.total, title: sale.title, emailTo: sendEmail ? visitor.email : null });
    } catch (error) {
      if (error instanceof SaleError) return jsonResponse(400, errorBody(error.code, error.message));
      if (error instanceof FixturesError) return jsonResponse(503, errorBody("playground_fixtures_invalid", "Los datos de demostración no son válidos."));
      throw error;
    }
  }

  if (path === "/api/registro") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver su registro."));
    const entries = await listIssued(env, visitor.email);
    // Current state only for codes the visitor owns (they come from their own record), newest first.
    const documents = await Promise.all(entries.map(async (entry, index) => {
      if (index >= REGISTRY_ENRICH_LIMIT || typeof parts.facta.getDocumentStatus !== "function") return { ...entry, current: null };
      try {
        const status = await parts.facta.getDocumentStatus(entry.codigoGeneracion);
        const current = projectDocument(status, { exposeRecipient: false });
        if (typeof current.estado === "string" && current.estado !== entry.estado) {
          await updateIssuedState(env, visitor.email, entry.codigoGeneracion, current.estado).catch(() => undefined);
          entry = { ...entry, estado: current.estado };
        }
        return { ...entry, current };
      } catch {
        return { ...entry, current: null };
      }
    }));
    return jsonResponse(200, { documents, enriched: Math.min(entries.length, REGISTRY_ENRICH_LIMIT) });
  }

  if (path === "/api/facta") {
    // Count an issue before the SDK handler spends a fiscal number. A replay of
    // the same session carries the same idempotency key and is free.
    if (request.method === "POST") {
      const peeked = await request.clone().json().catch(() => null) as { action?: unknown; session?: unknown; codigoGeneracion?: unknown } | null;
      // Per-document reads: the code must be one this visitor issued.
      if (typeof peeked?.action === "string" && PER_DOCUMENT_ACTIONS.has(peeked.action)) {
        const visitor = await visitorOf(request);
        if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver documentos."));
        const code = (peeked as { codigoGeneracion?: unknown }).codigoGeneracion;
        if (!isGenerationCode(code) || !(await ownsDocument(env, visitor.email, code))) {
          return jsonResponse(403, errorBody("document_not_yours", "Ese documento no fue emitido desde su sesión del playground."));
        }
      }
      if (peeked?.action === "issue") {
        const visitor = await visitorOf(request);
        const session = visitor === null ? null : await verifyFactaSession(peeked.session, env.FACTA_SESSION_SECRET!, deps.now?.()).catch(() => null);
        if (visitor !== null && session !== null && session.idempotencyKey.startsWith(`${await visitorTag(visitor.email)}.`)) {
          const decision = await consumeQuota(env, visitor.email, session.idempotencyKey);
          if (decision === null) return jsonResponse(503, errorBody("playground_quota_unavailable", "No se pudo comprobar el límite de emisiones. Intente de nuevo."));
          if (!decision.allowed) {
            return jsonResponse(429, errorBody("quota_exceeded", quotaMessage(decision)), {
              "retry-after": String(decision.retryAfterSeconds ?? 60),
            });
          }
        }
      }
    }
    return parts.handler(request);
  }

  return jsonResponse(404, errorBody("not_found", "Ruta no encontrada."));
}
