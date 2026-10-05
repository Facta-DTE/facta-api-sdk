// The request handler that sits between the browser window and `Facta`
// (docs/react-signing-ui.md §3 and §5, simplified: the window never edits data).
//
// It owns the `Facta` instance, so the apiKey and signKey never leave the
// implementer's server. Every response is built from an allow-list of fields.
// Actions: `session.describe`, `issue`, `status`.

import { FactaError } from "../errors.ts";
import type { Facta } from "../client.ts";
import type { DocumentStatus, IssueResult } from "../types.ts";
import { FactaSessionError, type FactaSession, secretBytes, verifyFactaSession } from "./session.ts";

/** The slice of `Facta` the handler uses; a fake can stand in for tests. */
export type FactaLike = Pick<Facta, "issue" | "getDocumentStatus">;

/** A field Hacienda or the API pointed at, so the host can highlight it in its own form. */
export interface FactaFieldIssue {
  /** Dotted path with `[n]` indices, e.g. `receptor.nrc` or `items[2].precioUni`. */
  path: string;
  message: string;
}

/** For the integrator's logging. Never carries a credential or the session secret. */
export type FactaHandlerEvent =
  | { type: "issued"; idempotencyKey: string; codigoGeneracion: string; numeroControl: string; tipoDte: string; ambiente: string }
  | { type: "contingency"; idempotencyKey: string; codigoGeneracion: string; numeroControl: string; tipoDte: string; ambiente: string }
  | {
    type: "rejected";
    idempotencyKey: string;
    code: string;
    status: number;
    observaciones: string[];
    spent?: { codigoGeneracion: string; numeroControl: string };
  }
  | { type: "error"; idempotencyKey?: string; code: string; status: number; retryable: boolean };

export interface FactaHandlerOptions {
  facta: FactaLike;
  /** At least 32 bytes. Signs session tokens. */
  sessionSecret: string | Uint8Array;
  /**
   * REQUIRED. Check the implementer's own login/cookie. Return `true` to
   * continue; `false` answers 403 and a throw answers 401. The literal
   * `"session-only"` accepts any valid session token (anonymous checkout pages).
   */
  authorize: "session-only" | ((req: Request, session: FactaSession) => boolean | Promise<boolean>);
  /** Return `jws` and the full `documento` in sealed results. Default false. */
  exposeDocument?: boolean;
  /** Default 32 768. */
  maxBodyBytes?: number;
  /** Called after each outcome. Failures inside the hook are swallowed. */
  onEvent?: (event: FactaHandlerEvent) => void | Promise<void>;
}

export interface FactaHandlerErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    spent?: { codigoGeneracion: string; numeroControl: string };
    observaciones?: string[];
    /** Present only when a JSON path could be read out of Hacienda's text or the details. */
    fields?: FactaFieldIssue[];
  };
}

const DEFAULT_MAX_BODY = 32 * 1024;
const RETRYABLE = new Set([
  "network_error",
  "mh_unreachable",
  "service_unavailable",
  "rate_limited",
  "idempotency_in_flight",
  "operation_outcome_unknown",
]);
const ACTIONS = ["session.describe", "issue", "status"];

class HandlerError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
}

function summarizeIssue(result: IssueResult, download: boolean, exposeDocument: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    estado: result.estado,
    codigoGeneracion: result.codigoGeneracion,
    numeroControl: result.numeroControl,
    tipoDte: result.tipoDte,
    ambiente: result.ambiente,
    fecEmi: result.fecEmi,
    horEmi: result.horEmi,
  };
  if (result.estado === "sellado") {
    out.selloRecibido = result.selloRecibido;
    out.totales = result.totales;
    out.observaciones = result.observaciones ?? [];
    if (download && result.representacionGrafica != null) out.representacionGrafica = result.representacionGrafica;
  } else {
    out.detalle = result.detalle;
  }
  if (download && typeof result.archivoJson === "string") out.archivoJson = result.archivoJson;
  if (exposeDocument) {
    out.jws = result.jws;
    out.documento = result.documento;
  }
  return out;
}

function summarizeStatus(status: DocumentStatus): Record<string, unknown> {
  return {
    estado: status.estado,
    codigoGeneracion: status.codigoGeneracion,
    numeroControl: status.numeroControl,
    tipoDte: status.tipoDte,
    ambiente: status.ambiente,
    fecEmi: status.fecEmi,
    horEmi: status.horEmi ?? null,
    selloRecibido: status.selloRecibido,
    observaciones: status.observaciones ?? [],
    totales: status.totales,
  };
}

// --- Best-effort JSON path extraction ----------------------------------------
// Only paths that are literally present in the text or in the details are
// reported. Nothing is guessed from field names or message meaning.

const PATH_SHAPE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[\d+\])*$/;

/** `#/receptor/nrc` · `/items/2/precioUni` · `receptor.nrc` → `receptor.nrc` · `items[2].precioUni`. */
export function normalizeFieldPath(raw: string): string | null {
  let text = raw.trim().replace(/^#/, "");
  if (text.startsWith("/")) {
    const segments = text.slice(1).split("/").filter((s) => s !== "");
    if (segments.length === 0) return null;
    text = segments.map((s, i) => (/^\d+$/.test(s) ? `[${s}]` : i === 0 ? s : `.${s}`)).join("");
  }
  return PATH_SHAPE.test(text) ? text : null;
}

// A slash path, not part of a word or URL; `items[2].precioUni`; or `[a.b]` in brackets.
const SLASH_PATH = /(?<![\w/:.])#?(\/[A-Za-z_]\w*(?:\/(?:[A-Za-z_]\w*|\d+))*)(?![\w/])/g;
const INDEXED_PATH = /(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\[\d+\](?:\.[A-Za-z_]\w*|\[\d+\])*)/g;
const BRACKET_DOTTED = /\[([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\]/g;

function pathsIn(text: string): string[] {
  const found: string[] = [];
  for (const re of [SLASH_PATH, INDEXED_PATH, BRACKET_DOTTED]) {
    for (const match of text.matchAll(re)) {
      const path = normalizeFieldPath(match[1]);
      if (path !== null) found.push(path);
    }
  }
  return found;
}

function collectDetailFields(details: unknown, fallback: string, out: FactaFieldIssue[], depth = 0): void {
  if (depth > 4) return;
  if (Array.isArray(details)) {
    for (const item of details.slice(0, 50)) collectDetailFields(item, fallback, out, depth + 1);
    return;
  }
  if (!isObject(details)) return;
  const message = typeof details.message === "string" ? details.message : fallback;
  for (const key of ["field", "path", "instancePath", "pointer"]) {
    const value = details[key];
    if (typeof value === "string") {
      const path = normalizeFieldPath(value);
      if (path !== null) out.push({ path, message });
    }
  }
  for (const key of ["errors", "issues", "fields", "details"]) collectDetailFields(details[key], fallback, out, depth + 1);
}

/** Exposed for tests. */
export function extractFieldIssues(error: FactaError): FactaFieldIssue[] {
  const out: FactaFieldIssue[] = [];
  for (const observation of error.mhObservations) {
    for (const path of pathsIn(observation)) out.push({ path, message: observation });
  }
  collectDetailFields(error.details, error.message, out);
  const seen = new Set<string>();
  return out.filter((f) => {
    const id = `${f.path}\0${f.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 50);
}

function errorBody(error: unknown, secretText: string | null): { status: number; body: FactaHandlerErrorBody } {
  const redact = (text: string) => (secretText !== null ? text.replaceAll(secretText, "[REDACTED]") : text);
  if (error instanceof HandlerError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, retryable: false } } };
  }
  if (error instanceof FactaSessionError) {
    return { status: 401, body: { error: { code: error.code, message: error.message, retryable: false } } };
  }
  if (error instanceof FactaError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : error.code === "network_error" ? 502 : 500;
    const body: FactaHandlerErrorBody = {
      error: { code: error.code, message: redact(error.message), retryable: RETRYABLE.has(error.code) },
    };
    const spent = error.spent;
    if (spent !== null) body.error.spent = spent;
    const observaciones = error.mhObservations.map(redact);
    if (observaciones.length > 0) body.error.observaciones = observaciones;
    const fields = extractFieldIssues(error).map((f) => ({ path: f.path, message: redact(f.message) }));
    if (fields.length > 0) body.error.fields = fields;
    return { status, body };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "The request could not be completed.", retryable: false } },
  };
}

async function readBody(req: Request, max: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) {
    throw new HandlerError("bad_request", "The request body is too large.", 413);
  }
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new HandlerError("bad_request", "The request body is too large.", 413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * Create the `Request` → `Response` handler. Mount it on a route that accepts
 * POST (Next.js route handler, Hono, Deno, Bun; Express via `toNodeHandler`).
 * It emits no CORS headers: serve it from the same origin as the page.
 */
export function createFactaHandler(options: FactaHandlerOptions): (req: Request) => Promise<Response> {
  if (!options || typeof options.facta !== "object" || options.facta === null) {
    throw new TypeError("createFactaHandler requires a `facta` client.");
  }
  secretBytes(options.sessionSecret);
  const authorize = options.authorize as unknown;
  if (authorize !== "session-only" && typeof authorize !== "function") {
    throw new TypeError(
      "createFactaHandler requires `authorize`: a function that checks your own login, or the literal \"session-only\".",
    );
  }
  const { facta, sessionSecret, onEvent } = options;
  const exposeDocument = options.exposeDocument === true;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const secretText = typeof sessionSecret === "string" ? sessionSecret : null;

  function emit(event: FactaHandlerEvent): void {
    if (!onEvent) return;
    // Fire and forget: a slow or failing hook must not change the response.
    void Promise.resolve().then(() => onEvent(event)).catch(() => undefined);
  }

  async function handle(req: Request, ctx: { session?: FactaSession }): Promise<Response> {
    if (req.method !== "POST") throw new HandlerError("method_not_allowed", "Only POST is accepted.", 405);
    const contentType = req.headers.get("content-type") ?? "";
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      throw new HandlerError("bad_request", "The content type must be application/json.", 415);
    }
    if (req.headers.get("x-facta-ui") !== "1") {
      throw new HandlerError("bad_request", "The x-facta-ui header is missing.", 400);
    }
    const raw = await readBody(req, maxBody);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HandlerError("bad_request", "The body is not valid JSON.", 400);
    }
    if (!isObject(body) || typeof body.action !== "string") {
      throw new HandlerError("bad_request", "The body must be an object with an action.", 400);
    }
    if (!ACTIONS.includes(body.action)) throw new HandlerError("bad_request", "Unknown action.", 400);
    const session = await verifyFactaSession(body.session, sessionSecret);
    ctx.session = session;

    if (authorize !== "session-only") {
      let allowed: boolean;
      try {
        allowed = (await (authorize as (r: Request, s: FactaSession) => boolean | Promise<boolean>)(req, session)) === true;
      } catch {
        throw new HandlerError("unauthorized", "Not authorized.", 401);
      }
      if (!allowed) throw new HandlerError("unauthorized", "Not authorized.", 403);
    }
    const download = session.download !== false;

    switch (body.action) {
      case "session.describe":
        return json(200, {
          draft: session.request,
          download,
          expiresAt: new Date(session.exp * 1000).toISOString(),
          ...(session.display ? { display: session.display } : {}),
        });
      case "issue": {
        const result = await facta.issue(session.request, { idempotencyKey: session.idempotencyKey });
        emit({
          type: result.estado === "sellado" ? "issued" : "contingency",
          idempotencyKey: session.idempotencyKey,
          codigoGeneracion: result.codigoGeneracion,
          numeroControl: result.numeroControl,
          tipoDte: result.tipoDte,
          ambiente: result.ambiente,
        });
        return json(200, { result: summarizeIssue(result, download, exposeDocument) });
      }
      default: {
        const code = body.codigoGeneracion;
        if (typeof code !== "string" || !/^[0-9A-Fa-f-]{36}$/.test(code)) {
          throw new HandlerError("bad_request", "codigoGeneracion is required.", 400);
        }
        return json(200, { status: summarizeStatus(await facta.getDocumentStatus(code)) });
      }
    }
  }

  return async (req: Request): Promise<Response> => {
    const ctx: { session?: FactaSession } = {};
    try {
      return await handle(req, ctx);
    } catch (error) {
      const { status, body } = errorBody(error, secretText);
      const idempotencyKey = ctx.session?.idempotencyKey;
      if (error instanceof FactaError && error.isRejection && idempotencyKey !== undefined) {
        emit({
          type: "rejected",
          idempotencyKey,
          code: body.error.code,
          status,
          observaciones: body.error.observaciones ?? [],
          ...(body.error.spent ? { spent: body.error.spent } : {}),
        });
      } else {
        emit({
          type: "error",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          code: body.error.code,
          status,
          retryable: body.error.retryable,
        });
      }
      return json(status, body, status === 405 ? { allow: "POST" } : {});
    }
  };
}

// --- Node adapter -----------------------------------------------------------
// Structural types only: no `node:` import, so the module loads on any runtime.

export interface NodeRequestLike extends AsyncIterable<Uint8Array | string> {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Present when a body parser (express.json) already consumed the stream. */
  body?: unknown;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk?: string | Uint8Array): unknown;
}

/** Wrap a handler for Express or `node:http`. */
export function toNodeHandler(
  handler: (req: Request) => Promise<Response>,
  options: { maxBodyBytes?: number } = {},
): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  return async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = req.method ?? "POST";
    let body: Uint8Array | undefined;
    if (method !== "GET" && method !== "HEAD") {
      if (req.body !== undefined && req.body !== null) {
        body = new TextEncoder().encode(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for await (const chunk of req) {
          const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
          total += bytes.length;
          if (total > limit) {
            res.statusCode = 413;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: { code: "bad_request", message: "The request body is too large.", retryable: false } }));
            return;
          }
          chunks.push(bytes);
        }
        body = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          body.set(c, offset);
          offset += c.length;
        }
      }
      headers.delete("content-length");
    }
    const host = headers.get("host") ?? "localhost";
    const response = await handler(
      new Request(`http://${host}${req.url ?? "/"}`, { method, headers, body: body as BodyInit | undefined }),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(new Uint8Array(await response.arrayBuffer()));
  };
}
