// POST /api/recipes/run — run one stage of one fixed recipe.
//
// The router has already applied the fail-closed guard. This adds: a verified visitor,
// the browser-JSON checks, parameter validation (recipes/index.ts), the issue/invalidate
// quota, execution against staging and the redaction of whatever goes back.

import { visitorTag } from "../facta.ts";
import type { Visitor } from "../visitor.ts";
import type { PlaygroundEnv } from "../env.ts";
import type { PlaygroundFixtures } from "../fixtures.ts";
import { FixturesError } from "../fixtures.ts";
import { quotaMessage, type QuotaDecision } from "../quota.ts";
import { mailMessage, type MailDecision } from "../delivery.ts";
import { readStashedToken, type MailCheck } from "../gates.ts";
import { RECIPES, RecipeError } from "./index.ts";
import { listIssued, ownsDocument, recordIssued, updateIssuedState } from "../issued-codes.ts";
import { execute } from "./runner.ts";
import { apiCacheOf } from "../api-cache.ts";
import { documentKey } from "../api-budget.ts";

export interface RecipeRouteDeps {
  env: PlaygroundEnv;
  visitor: Visitor | null;
  fixtures(): Promise<PlaygroundFixtures>;
  /** Counts (or, with `commit: false`, only checks) one issue under `key`. */
  consume(email: string, key: string, commit?: boolean): Promise<QuotaDecision | null>;
  /** Turnstile for a run that issues, invalidates or sends. Null when it passed. */
  turnstile?(): Promise<Response | null>;
  /** E-mail limits for a run that sends (the router adds the caller). */
  mail?(check: Omit<MailCheck, "caller">): Promise<MailDecision | null>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const MAX_BODY = 16_000;

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });

const failure = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  reply(status, { error: { code, message, retryable: false } }, extra);

export async function handleRecipeRun(request: Request, deps: RecipeRouteDeps): Promise<Response> {
  if (request.method !== "POST") return failure(405, "method_not_allowed", "Solo se acepta POST.", { allow: "POST" });
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return failure(415, "bad_request", "El contenido debe ser application/json.");
  if (request.headers.get("x-facta-ui") !== "1") return failure(400, "bad_request", "Falta el encabezado x-facta-ui.");
  if (deps.visitor === null) return failure(401, "unauthorized", "Inicie sesión para ejecutar recetas en el ambiente de pruebas.");

  const raw = await request.text();
  if (raw.length > MAX_BODY) return failure(413, "bad_request", "La solicitud es demasiado grande.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return failure(400, "bad_request", "El cuerpo no es un JSON válido.");
  }
  const input = body as { recipe?: unknown; stage?: unknown; runId?: unknown; params?: unknown } | null;
  const def = typeof input?.recipe === "string" && Object.hasOwn(RECIPES, input.recipe) ? RECIPES[input.recipe] : undefined;
  if (input === null || typeof input !== "object" || def === undefined) return failure(404, "recipe_unknown", "Esa receta no existe.");
  const stage = input.stage === undefined ? def.stages[0]! : input.stage;
  if (typeof stage !== "string" || !def.stages.includes(stage)) return failure(400, "stage_unknown", "Esa etapa no existe.");
  const runId = input.runId === undefined ? crypto.randomUUID() : input.runId;
  if (typeof runId !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(runId)) return failure(400, "bad_request", "El identificador de ejecución no es válido.");
  const params = input.params;
  if (params === null || typeof params !== "object" || Array.isArray(params)) return failure(400, "bad_request", "Faltan los parámetros de la receta.");

  const { env, visitor } = deps;
  const secret = env.FACTA_SESSION_SECRET!;
  const tag = await visitorTag(visitor.id);

  let bound;
  try {
    bound = await def.bind({
      stage,
      params: params as Record<string, unknown>,
      fixtures: await deps.fixtures(),
      email: visitor.id,
      baseKey: `${tag}.${runId}`,
      tag,
      secret,
      hasCatalog: Boolean(env.FACTA_UNLOCK_KEY),
      owns: (code) => ownsDocument(env, visitor.id, code),
      stash: async (code) => (await readStashedToken(env, visitor.id, code.toUpperCase())),
      mine: async () => (await listIssued(env, visitor.id)).map((entry) => entry.codigoGeneracion),
      ownedDocs: async () => (await listIssued(env, visitor.id)).map((entry) => ({ codigoGeneracion: entry.codigoGeneracion, tipoDte: entry.tipoDte })),
      now: deps.now?.() ?? Date.now(),
    });
  } catch (error) {
    if (error instanceof RecipeError) return failure(error.status, error.code, error.message);
    if (error instanceof FixturesError) return failure(503, "playground_fixtures_invalid", "Los datos de demostración no son válidos.");
    throw error;
  }

  // Anything that costs something (an issue, an invalidation, an e-mail) needs a fresh Turnstile token.
  if ((bound.quotaKeys.length > 0 || bound.mail !== undefined) && deps.turnstile !== undefined) {
    const blocked = await deps.turnstile();
    if (blocked) return blocked;
  }
  // E-mail limits first (they also name the document cooldown), then the issue quota.
  if (bound.mail !== undefined && deps.mail !== undefined) {
    const decision = await deps.mail({
      key: bound.mail.key,
      recipient: bound.mail.recipient,
      ...(bound.mail.doc === undefined ? {} : { doc: bound.mail.doc }),
    });
    if (decision === null) return failure(503, "playground_quota_unavailable", "No se pudo comprobar el límite de envíos. Intente de nuevo.");
    if (!decision.allowed) return failure(429, "mail_quota_exceeded", mailMessage(decision), { "retry-after": String(decision.retryAfterSeconds ?? 60) });
  }
  // The gate: is there room for this run? Nothing is counted yet. A key already counted (a retry of the same run) is free.
  for (const key of [...(bound.gateKeys ?? []), ...bound.quotaKeys]) {
    const decision = await deps.consume(visitor.id, key, false);
    if (decision === null) return failure(503, "playground_quota_unavailable", "No se pudo comprobar el límite de emisiones. Intente de nuevo.");
    if (!decision.allowed) {
      return failure(429, "quota_exceeded", quotaMessage(decision), { "retry-after": String(decision.retryAfterSeconds ?? 60) });
    }
  }

  const { output, outcome } = await execute(env, deps.fetch, bound.exec);
  // The count: once, and only for a run that sealed (or put in contingency) a document or invalidated one.
  // A rejection, a rate limit or any failure before or at the API costs the visitor nothing.
  if (output.ok && ((outcome?.issued?.length ?? 0) > 0 || (outcome?.invalidated?.length ?? 0) > 0)) {
    for (const key of bound.quotaKeys) await deps.consume(visitor.id, key, true);
  }
  // Record what this run issued or invalidated in the visitor's own ledger (issued-codes.ts).
  const issued: Array<{ codigoGeneracion: string; tipoDte?: string }> = [];
  for (const document of outcome?.issued ?? []) {
    try {
      await recordIssued(env, visitor.id, document);
      issued.push({ codigoGeneracion: document.codigoGeneracion, ...(document.tipoDte === undefined ? {} : { tipoDte: document.tipoDte }) });
    } catch {
      // The document exists in Hacienda's test service even if the ledger write failed; the page still shows it.
      issued.push({ codigoGeneracion: document.codigoGeneracion, ...(document.tipoDte === undefined ? {} : { tipoDte: document.tipoDte }) });
    }
  }
  for (const code of outcome?.invalidated ?? []) {
    await updateIssuedState(env, visitor.id, code, "invalidado").catch(() => undefined);
    // The cached «sellado» must not outlive the invalidation.
    await apiCacheOf(env.QUOTA).del(documentKey(code)).catch(() => undefined);
  }
  return reply(200, {
    recipe: input.recipe,
    stage,
    runId,
    ...output,
    issued,
    invalidated: outcome?.invalidated ?? [],
    ...(outcome?.continuation === undefined ? {} : { continuation: outcome.continuation }),
  });
}
