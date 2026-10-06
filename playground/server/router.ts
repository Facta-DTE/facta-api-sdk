// The playground's API: everything under /api/*. A pure `Request -> Response`
// function over the environment so the tests drive it without a Worker runtime.
//
// Routes
//   GET  /api/state    visitor, quota and demo data for the page
//   POST /api/session  validated sale description -> session token
//   POST /api/facta    the SDK handler (issue, status, documents, downloads…);
//                      per-document reads are limited to documents this visitor issued
//   GET  /api/registro the visitor's own documents (ledger + cache; never calls the API)
//   GET  /api/registro/enrich?codes=  the API's view of a few of them (cached; at most ten)
//   GET  /api/issued   the generation codes THIS visitor issued here (issued-codes.ts)
//   POST /api/invalidation  seals an invalidation session for a document the visitor issued here
//   POST /api/recipes/run  one stage of a fixed server recipe (recipes/)
//
//   POST /api/delivery/resend  one more e-mail attempt for a document the visitor issued (5-minute token)
//
// Extension points for later batches: add a route to ROUTES; add a type to
// `server/sale.ts`; add recipes under `server/recipes/` and route them here.

import { createFactaInvalidationSession, createFactaSession, verifyFactaInvalidationSession, verifyFactaSession } from "../../src/server/session.ts";
import type { JwksSource } from "./access.ts";
import { ensureVisitor, resolveVisitor, type Visitor } from "./visitor.ts";
import { authModeOf } from "./guard.ts";
import { clientIp, verifyTurnstile } from "./turnstile.ts";
import { consumeIssue, consumeMail, peekMail, readStashedToken, type Caller } from "./gates.ts";
import { createDeliverySession, DeliveryError, maskAddress, mailMessage, mentionsWhatsApp, parseAddress, recipientKey } from "./delivery.ts";
import { FactaError } from "../../src/errors.ts";
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
import { apiCacheOf } from "./api-cache.ts";
import { documentKey, RATE_LIMIT_MESSAGE } from "./api-budget.ts";
import type { DocumentStatus } from "../../src/types.ts";

export interface ApiDeps {
  keys?: JwksSource;
  now?: () => number;
  /** Tests inject a fake client; production builds the real `Facta`. */
  facta?: FactaLike;
  /** Recipes: the HTTP client under the SDK (tests inject a fake). */
  fetch?: typeof globalThis.fetch;
  /** Turnstile siteverify (tests inject a fake that follows Cloudflare's documented dummy keys). */
  turnstileFetch?: typeof globalThis.fetch;
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

/** Who is paying for the action: the cookie's visitor and the caller's IP. */
function callerOf(request: Request, visitor: Visitor): Caller {
  return { visitorId: visitor.id, ip: clientIp(request) };
}

/** Turnstile on an action that costs something. Null when it passed (or the deployment uses Access). */
async function requireTurnstile(request: Request, env: PlaygroundEnv, deps: ApiDeps): Promise<Response | null> {
  if (authModeOf(env) !== "turnstile") return null;
  const verdict = await verifyTurnstile(request, env, deps.turnstileFetch);
  if (verdict.ok) return null;
  return jsonResponse(verdict.code === "turnstile_unavailable" ? 503 : 403, errorBody(verdict.code, verdict.message, verdict.code === "turnstile_unavailable"));
}

const mailLimited = (decision: { window?: "hour" | "day" | "recipient" | "document"; retryAfterSeconds?: number }) =>
  jsonResponse(429, errorBody("mail_quota_exceeded", mailMessage(decision)), { "retry-after": String(decision.retryAfterSeconds ?? 60) });

// One handler per environment object (an isolate keeps the same `env`).
const partsCache = new WeakMap<object, { parts: FactaParts; visitors: WeakMap<Request, Promise<Visitor | null>> }>();

function partsFor(env: PlaygroundEnv, deps: ApiDeps) {
  const cached = partsCache.get(env);
  if (cached !== undefined && deps.facta === undefined) return cached;
  const visitors = new WeakMap<Request, Promise<Visitor | null>>();
  const visitorOf = (req: Request) => {
    let pending = visitors.get(req);
    if (pending === undefined) {
      pending = resolveVisitor(req, env, deps.keys, deps.now?.());
      visitors.set(req, pending);
    }
    return pending;
  };
  const entry = { parts: createFactaParts(env, visitorOf, deps.facta), visitors };
  // `visitors` is keyed by Request, so a shared cache entry is safe across requests.
  if (deps.facta === undefined) partsCache.set(env, entry);
  return entry;
}

async function peekQuota(env: PlaygroundEnv, id: string): Promise<QuotaDecision | null> {
  if (!env.QUOTA) return null;
  const stub = env.QUOTA.get(env.QUOTA.idFromName(id.toLowerCase()));
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
/** Rows whose cached answer the registry list looks up (one Durable Object call), and rows enriched per request. */
const REGISTRY_CACHE_LOOKUPS = 60;
const REGISTRY_ENRICH_BATCH = 10;

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
      pending = resolveVisitor(req, env, deps.keys, deps.now?.());
      visitors.set(req, pending);
    }
    return pending;
  };

  if (path === "/api/state") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const ensured = await ensureVisitor(request, env, deps.keys, deps.now?.() ?? Date.now());
    const visitor = ensured.visitor;
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
      visitor: visitor === null ? null : { label: visitor.label, email: visitor.email, via: visitor.via },
      auth: authModeOf(env),
      turnstileSiteKey: authModeOf(env) === "turnstile" ? env.TURNSTILE_SITEKEY ?? null : null,
      quota: visitor === null ? null : await peekQuota(env, visitor.id),
      mail: visitor === null ? null : await peekMail(env, visitor.id),
      // D-6: e-mail only. The server never requests WhatsApp.
      whatsapp: false,
      supportedTypes: SUPPORTED_SALE_TYPES,
      catalog: Boolean(env.FACTA_UNLOCK_KEY),
      catalogReceiverTypes: CATALOG_RECEIVER_TYPES,
      demo: publicFixtures(fixtures),
    }, ensured.setCookie === undefined ? {} : { "set-cookie": ensured.setCookie });
  }

  if (path === "/api/session") {
    const bad = requireBrowserJson(request);
    if (bad) return bad;
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para emitir facturas de prueba."));
    const body = await request.json().catch(() => null);
    // The browser can never name another channel: any mention of WhatsApp is refused outright.
    if (mentionsWhatsApp(body)) return jsonResponse(400, errorBody("channel_not_allowed", "El playground solo entrega por correo."));
    const blocked = await requireTurnstile(request, env, deps);
    if (blocked) return blocked;
    try {
      const wantsMail = (body as { sendEmail?: unknown } | null)?.sendEmail === true;
      let address: string | null = null;
      if (wantsMail) {
        const typed = (body as { emailTo?: unknown }).emailTo;
        address = parseAddress(typed === undefined && visitor.email !== null ? visitor.email : typed);
        // Pre-flight, counting nothing: the real count happens when the document is issued.
        const check = await consumeMail(env, { caller: callerOf(request, visitor), key: "preflight", recipient: await recipientKey(env.FACTA_SESSION_SECRET!, address), commit: false });
        if (check !== null && !check.allowed) return mailLimited(check);
      }
      const owned = (await listIssued(env, visitor.id)).map((e) => ({ codigoGeneracion: e.codigoGeneracion, tipoDte: e.tipoDte }));
      // Catalog ids are confirmed against the key's catalog before anything is built.
      const catalog = await loadCatalogLookup(body, parts.facta, Boolean(env.FACTA_UNLOCK_KEY));
      const { sale } = buildSale(body, await loadFixtures(env), { owned, catalog });
      const idempotencyKey = `${await visitorTag(visitor.id)}.${crypto.randomUUID()}`;
      const session = await createDeliverySession({
        request: sale.request,
        idempotencyKey,
        display: { total: sale.total, title: sale.title, reference: "Playground", ...(sale.recipientLabel === undefined ? {} : { recipient: sale.recipientLabel }) },
        address,
      }, env.FACTA_SESSION_SECRET!, deps.now?.());
      return jsonResponse(200, { session, total: sale.total, title: sale.title, emailTo: address === null ? null : maskAddress(address) });
    } catch (error) {
      if (error instanceof DeliveryError) return jsonResponse(error.status, errorBody(error.code, error.message));
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
    return jsonResponse(200, { issued: await listIssued(env, visitor.id) });
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
    if (!(await ownsDocument(env, visitor.id, code))) return jsonResponse(403, errorBody("not_issued_here", "Solo puede anular documentos que usted emitió en este playground."));
    const blocked = await requireTurnstile(request, env, deps);
    if (blocked) return blocked;
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
      idempotencyKey: `${await visitorTag(visitor.id)}.invalidate-${code}`,
    }, env.FACTA_SESSION_SECRET!, deps.now?.());
    return jsonResponse(200, { session });
  }

  if (path === "/api/delivery/resend") {
    const bad = requireBrowserJson(request);
    if (bad) return bad;
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para reenviar documentos."));
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (mentionsWhatsApp(body)) return jsonResponse(400, errorBody("channel_not_allowed", "El playground solo entrega por correo."));
    // Only the document code travels: the address is the one marked when it was issued, never a new one.
    if (body === null || typeof body !== "object" || Object.keys(body).some((k) => k !== "codigoGeneracion")) {
      return jsonResponse(400, errorBody("bad_request", "Solo se acepta el código del documento."));
    }
    if (!isGenerationCode(body.codigoGeneracion)) return jsonResponse(400, errorBody("code_invalid", "El código de generación no es válido."));
    const code = body.codigoGeneracion.toUpperCase();
    if (!(await ownsDocument(env, visitor.id, code))) return jsonResponse(403, errorBody("not_issued_here", "Solo puede reenviar documentos que usted emitió en este playground."));
    const blocked = await requireTurnstile(request, env, deps);
    if (blocked) return blocked;
    const stashed = await readStashedToken(env, visitor.id, code);
    if (stashed === null || typeof parts.facta.deliverEmail !== "function") {
      return jsonResponse(410, errorBody("delivery_window_closed", "El plazo para reenviar este documento venció (cinco minutos desde que se emitió) o no se marcó el correo. Emita uno nuevo."));
    }
    const now = deps.now?.() ?? Date.now();
    const decision = await consumeMail(env, { caller: callerOf(request, visitor), key: `resend.${code}.${now}`, recipient: stashed.rcpt, doc: code });
    if (decision === null) return jsonResponse(503, errorBody("playground_quota_unavailable", "No se pudo comprobar el límite de envíos. Intente de nuevo."));
    if (!decision.allowed) return mailLimited(decision);
    try {
      const sent = await parts.facta.deliverEmail(code, stashed.token);
      return jsonResponse(200, { canal: { estado: sent.estado, destino: stashed.masked, ...(sent.motivo ? { motivo: sent.motivo } : {}) } });
    } catch (error) {
      if (error instanceof FactaError) {
        const gone = error.code === "entrega_vencida";
        return jsonResponse(gone ? 410 : 502, errorBody(gone ? "delivery_window_closed" : "delivery_failed", gone ? "El plazo para reenviar este documento venció. Emita uno nuevo." : "No se pudo enviar el correo. Intente de nuevo más tarde.", !gone));
      }
      throw error;
    }
  }

  if (path === "/api/registro") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver su registro."));
    // The ledger alone, plus whatever the shared cache already knows: this route NEVER calls the API.
    // The rows on screen ask for the rest through /api/registro/enrich, a few at a time.
    const entries = await listIssued(env, visitor.id);
    const known = await apiCacheOf(env.QUOTA).getMany<DocumentStatus>(entries.slice(0, REGISTRY_CACHE_LOOKUPS).map((e) => documentKey(e.codigoGeneracion)));
    const documents = entries.map((entry) => {
      const hit = known.get(documentKey(entry.codigoGeneracion));
      return { ...entry, current: hit === undefined ? null : projectDocument(hit.value, { exposeRecipient: false }) };
    });
    return jsonResponse(200, { documents });
  }

  if (path === "/api/registro/enrich") {
    if (request.method !== "GET") return jsonResponse(405, errorBody("method_not_allowed", "Solo se acepta GET."), { allow: "GET" });
    const visitor = await visitorOf(request);
    if (visitor === null) return jsonResponse(401, errorBody("unauthorized", "Inicie sesión para ver su registro."));
    const asked = (new URL(request.url).searchParams.get("codes") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => isGenerationCode(c));
    const codes = [...new Set(asked)].slice(0, REGISTRY_ENRICH_BATCH);
    if (codes.length === 0 || typeof parts.facta.getDocumentStatus !== "function") return jsonResponse(200, { documents: [] });
    // Only the visitor's own codes; the answers come from the cache when they can (final states never expire).
    const mine = new Map((await listIssued(env, visitor.id)).map((e) => [e.codigoGeneracion, e]));
    const documents: Array<Record<string, unknown>> = [];
    for (const code of codes) {
      const entry = mine.get(code);
      if (entry === undefined) continue;
      try {
        const current = projectDocument(await parts.facta.getDocumentStatus(code), { exposeRecipient: false });
        const totales = current.totales as { montoTotalOperacion?: unknown } | null;
        const total = typeof totales?.montoTotalOperacion === "number" ? totales.montoTotalOperacion : undefined;
        const estado = typeof current.estado === "string" ? current.estado : entry.estado;
        // Keep the ledger in step: the last known state, and the total when none was stored (older rows).
        if (estado !== entry.estado || (total !== undefined && entry.total === undefined)) {
          await updateIssuedState(env, visitor.id, code, estado, total).catch(() => undefined);
        }
        documents.push({ ...entry, estado, ...(entry.total === undefined && total !== undefined ? { total } : {}), current });
      } catch (error) {
        if (error instanceof FactaError && error.code === "rate_limited") {
          return jsonResponse(429, errorBody("rate_limited", RATE_LIMIT_MESSAGE, true), { "retry-after": "60" });
        }
        // One unreadable document does not stop the others: the row keeps what the ledger knows.
      }
    }
    return jsonResponse(200, { documents });
  }

  if (path === "/api/recipes/run") {
    const visitor0 = await visitorOf(request);
    const caller0 = visitor0 === null ? null : callerOf(request, visitor0);
    return handleRecipeRun(request, {
      env,
      visitor: visitor0,
      fixtures: () => loadFixtures(env),
      consume: (_id, key, commit = true) => consumeIssue(env, caller0!, key, commit),
      turnstile: () => requireTurnstile(request, env, deps),
      mail: (check) => consumeMail(env, { ...check, caller: caller0! }),
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
        if (!isGenerationCode(code) || !(await ownsDocument(env, visitor.id, code))) {
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
        const mine = new Set((await listIssued(env, visitor.id)).map((e) => e.codigoGeneracion));
        const documentos = page.documentos.filter((d) => typeof d.codigoGeneracion === "string" && mine.has(d.codigoGeneracion.toUpperCase()));
        return jsonResponse(200, { ...page, documentos });
      }
      if (peeked?.action === "issue") {
        const visitor = await visitorOf(request);
        const session = visitor === null ? null : await verifyFactaSession(peeked.session, env.FACTA_SESSION_SECRET!, deps.now?.()).catch(() => null);
        if (visitor !== null && session !== null && session.idempotencyKey.startsWith(`${await visitorTag(visitor.id)}.`)) {
          const caller = callerOf(request, visitor);
          const key = session.idempotencyKey;
          // The gate: is there room? Nothing is counted yet. A replay of the same session carries the same
          // idempotency key, so it is free; and a failure never costs the visitor anything.
          const decision = await consumeIssue(env, caller, key, false);
          if (decision === null) return jsonResponse(503, errorBody("playground_quota_unavailable", "No se pudo comprobar el límite de emisiones. Intente de nuevo."));
          if (!decision.allowed) {
            return jsonResponse(429, errorBody("quota_exceeded", quotaMessage(decision)), {
              "retry-after": String(decision.retryAfterSeconds ?? 60),
            });
          }
          // A session that marks the e-mail channel is also checked against the e-mail limits.
          const address = session.deliver?.email;
          const recipient = typeof address === "string" ? await recipientKey(env.FACTA_SESSION_SECRET!, address) : null;
          if (recipient !== null) {
            const mail = await consumeMail(env, { caller, key: `mail.${key}`, recipient, commit: false });
            if (mail === null) return jsonResponse(503, errorBody("playground_quota_unavailable", "No se pudo comprobar el límite de envíos. Intente de nuevo."));
            if (!mail.allowed) return mailLimited(mail);
          }
          const answer = await parts.handler(request);
          // The count, exactly once: only when the document was sealed or went to contingency.
          if (answer.ok) {
            const outcome = await answer.clone().json().catch(() => null) as { result?: { estado?: unknown } } | null;
            const estado = outcome?.result?.estado;
            if (estado === "sellado" || estado === "contingencia") {
              await consumeIssue(env, caller, key, true);
              if (recipient !== null) await consumeMail(env, { caller, key: `mail.${key}`, recipient });
            }
          }
          return answer;
        }
      }
    }
    // An invalidation keeps the visitor's record in step: the registry reads its own ledger, not the API.
    if (request.method === "POST") {
      const peeked = await request.clone().json().catch(() => null) as { action?: unknown; session?: unknown } | null;
      if (peeked?.action === "invalidate") {
        const answer = await parts.handler(request);
        const visitor = answer.ok ? await visitorOf(request) : null;
        const invalidation = visitor === null ? null : await verifyFactaInvalidationSession(peeked.session, env.FACTA_SESSION_SECRET!, deps.now?.()).catch(() => null);
        if (visitor !== null && invalidation !== null) await updateIssuedState(env, visitor.id, invalidation.generationCode, "invalidado").catch(() => undefined);
        return answer;
      }
    }
    return parts.handler(request);
  }

  return jsonResponse(404, errorBody("not_found", "Ruta no encontrada."));
}
