// The playground's API: everything under /api/*. A pure `Request -> Response`
// function over the environment so the tests drive it without a Worker runtime.
//
// Routes
//   GET  /api/state    visitor, quota and demo data for the page
//   POST /api/session  validated sale description -> session token
//   POST /api/facta    the SDK handler (issue, status, documents, downloads…);
//                      per-document reads are limited to documents this visitor issued
//   GET  /api/registro the visitor's own documents, with their current state
//   GET  /api/issued   the generation codes THIS visitor issued here (issued-codes.ts)
//   POST /api/invalidation  seals an invalidation session for a document the visitor issued here
//   POST /api/recipes/run  one stage of a fixed server recipe (recipes/)
//
// Extension points for later batches: add a route to ROUTES; add a type to
// `server/sale.ts`; add recipes under `server/recipes/` and route them here.

import { createFactaInvalidationSession, createFactaSession, verifyFactaSession } from "../../src/server/session.ts";
import { visitorFrom, type JwksSource, type Visitor } from "./access.ts";
import type { PlaygroundEnv } from "./env.ts";
import { createFactaParts, visitorTag, type FactaParts } from "./facta.ts";
import { FixturesError, parseFixtures, publicFixtures, type PlaygroundFixtures } from "./fixtures.ts";
import { checkGuard, STAGING_API_HOST } from "./guard.ts";
import { isGenerationCode, listIssued, ownsDocument, updateIssuedState } from "./issued-codes.ts";
import { projectDocument } from "../../src/server/capabilities.ts";
import { quotaMessage, type QuotaDecision } from "./quota.ts";
import { buildSale, CATALOG_RECEIVER_TYPES, SaleError, SUPPORTED_SALE_TYPES } from "./sale.ts";
import { loadCatalogLookup } from "./sale-catalog.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleRecipeRun } from "./recipes/route.ts";

export interface ApiDeps {
  keys?: JwksSource;
  now?: () => number;
  /** Tests inject a fake client; production builds the real `Facta`. */
  facta?: FactaLike;
  /** Recipes: the HTTP client under the SDK (tests inject a fake). */
  fetch?: typeof globalThis.fetch;
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
      catalogReceiverTypes: CATALOG_RECEIVER_TYPES,
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
      const owned = (await listIssued(env, visitor.email)).map((e) => e.codigoGeneracion);
      // Catalog ids are confirmed against the key's catalog before anything is built.
      const catalog = await loadCatalogLookup(body, parts.facta, Boolean(env.FACTA_UNLOCK_KEY));
      const { sale, sendEmail } = buildSale(body, await loadFixtures(env), { ownedCodes: owned, catalog });
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
      if (error instanceof SaleError) {
        const status = error.code === "catalog_unreadable" ? 502 : 400;
        return jsonResponse(status, { error: { code: error.code, message: error.message, retryable: status === 502, ...(error.field === undefined ? {} : { field: error.field }) } });
      }
      if (error instanceof FixturesError) return jsonResponse(503, errorBody("playground_fixtures_invalid", "Los datos de demostración no son válidos."));
      throw error;
    }
  }

  if (path === "/api/issued") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver sus documentos."));
    return jsonResponse(200, { issued: await listIssued(env, visitor.email) });
  }

  if (path === "/api/invalidation") {
    const bad = requireBrowserJson(request);
    if (bad) return bad;
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para anular documentos de prueba."));
    const body = await request.json().catch(() => null) as { codigoGeneracion?: unknown; tipoAnulacion?: unknown; motivo?: unknown } | null;
    if (body === null || !isGenerationCode(body.codigoGeneracion)) return jsonResponse(400, errorBody("code_invalid", "El código de generación no es válido."));
    const code = body.codigoGeneracion.toUpperCase();
    // Ownership, enforced here: only a document this visitor issued in the playground.
    if (!(await ownsDocument(env, visitor.email, code))) return jsonResponse(403, errorBody("not_issued_here", "Solo puede anular documentos que usted emitió en este playground."));
    const tipoAnulacion = body.tipoAnulacion === 3 ? 3 : 2;
    const motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";
    if (tipoAnulacion === 3 && motivo === "") return jsonResponse(400, errorBody("motivo_required", "Escriba el motivo de la anulación."));
    let fixtures: PlaygroundFixtures;
    try {
      fixtures = await loadFixtures(env);
    } catch (error) {
      if (error instanceof FixturesError) return jsonResponse(503, errorBody("playground_fixtures_invalid", "Los datos de demostración no son válidos."));
      throw error;
    }
    if (fixtures.invalidation === null) {
      return jsonResponse(503, errorBody("invalidation_unavailable", "El playground no tiene responsables de demostración para anular."));
    }
    const session = await createFactaInvalidationSession({
      generationCode: code,
      tipoAnulacion,
      ...(tipoAnulacion === 3 ? { motivo } : {}),
      // People named on the event come from the fixtures, never from the browser.
      responsable: fixtures.invalidation.responsable,
      solicita: fixtures.invalidation.solicita,
      // Bound to the visitor like an issue session, so the handler's `authorize` checks the tag.
      idempotencyKey: `${await visitorTag(visitor.email)}.invalidate-${code}`,
    }, env.FACTA_SESSION_SECRET!, deps.now?.());
    return jsonResponse(200, { session });
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

  if (path === "/api/recipes/run") {
    return handleRecipeRun(request, {
      env,
      visitor: await visitorOf(request),
      fixtures: () => loadFixtures(env),
      consume: (email, key) => consumeQuota(env, email, key),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
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
      // The key sees every playground document: lists show only the visitor's own, holding is closed.
      if (peeked?.action === "documents.holding") {
        return jsonResponse(403, errorBody("action_not_allowed", "Esta acción no está disponible en el playground."));
      }
      if (peeked?.action === "documents.list") {
        const visitor = await visitorOf(request);
        if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver documentos."));
        const answer = await parts.handler(request);
        if (!answer.ok) return answer;
        const page = await answer.json().catch(() => null) as { documentos?: { codigoGeneracion?: string }[] } | null;
        if (page === null || !Array.isArray(page.documentos)) return jsonResponse(502, errorBody("bad_gateway", "No se pudo leer la lista."));
        const mine = new Set((await listIssued(env, visitor.email)).map((e) => e.codigoGeneracion));
        const documentos = page.documentos.filter((d) => typeof d.codigoGeneracion === "string" && mine.has(d.codigoGeneracion.toUpperCase()));
        return jsonResponse(200, { ...page, documentos });
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
