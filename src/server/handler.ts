// The request handler that sits between the browser window and `Facta`
// (docs/react-signing-ui.md §3 and §5).
//
// It owns the `Facta` instance, so the apiKey and signKey never leave the
// implementer's server. Every response is built from an allow-list of fields.

import { FactaError } from "../errors.ts";
import type { Facta } from "../client.ts";
import type {
  DocumentStatus,
  DteRequest,
  IssueResult,
  PreparedDte,
  Recipient,
} from "../types.ts";
import {
  base64urlDecode,
  base64urlEncode,
  FactaSessionError,
  hmac,
  type FactaSession,
  secretBytes,
  timingSafeEqual,
  verifyFactaSession,
} from "./session.ts";
import { mergeRecipient, resolveTipoDte, type RecipientFieldError, validateRecipient } from "./recipient.ts";

/** The slice of `Facta` the handler uses; a fake can stand in for tests. */
export type FactaLike = Pick<Facta, "issue" | "prepare" | "sign" | "getDocumentStatus">;

export interface FactaHandlerOptions {
  facta: FactaLike;
  /** At least 32 bytes. Signs session tokens and prepared seals. */
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
}

export interface FactaHandlerErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    spent?: { codigoGeneracion: string; numeroControl: string };
    observaciones?: string[];
    /** Present on `recipient_invalid`: which fields failed and why. */
    fields?: RecipientFieldError[];
  };
}

const DEFAULT_MAX_BODY = 32 * 1024;
const PREPARED_DOMAIN = "facta-prepared-v1.";
const RETRYABLE = new Set([
  "network_error",
  "mh_unreachable",
  "service_unavailable",
  "rate_limited",
  "idempotency_in_flight",
  "operation_outcome_unknown",
]);
const MODE_ACTIONS: Record<FactaSession["mode"], readonly string[]> = {
  "confirm-then-issue": ["session.describe", "issue", "status"],
  "review-prepared": ["session.describe", "prepare", "sign", "status"],
};
const ALL_ACTIONS = ["session.describe", "issue", "prepare", "sign", "status"];

class HandlerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: RecipientFieldError[],
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable JSON: keys sorted, so a round trip through the browser cannot change the seal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function seal(secret: string | Uint8Array, nonce: string, prepared: unknown): Promise<string> {
  return base64urlEncode(await hmac(secret, `${PREPARED_DOMAIN}${nonce}.${canonical(prepared)}`));
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

/** `sign` needs the canonical document and the token back, so they travel in `prepared`. */
function summarizePrepared(prepared: PreparedDte): PreparedDte {
  return {
    estado: "preparado",
    codigoGeneracion: prepared.codigoGeneracion,
    numeroControl: prepared.numeroControl,
    tipoDte: prepared.tipoDte,
    ambiente: prepared.ambiente,
    totales: prepared.totales,
    documento: prepared.documento,
    prepareToken: prepared.prepareToken,
  };
}

function isPrepared(value: unknown): value is PreparedDte {
  return isObject(value) && value.estado === "preparado" &&
    ["codigoGeneracion", "numeroControl", "tipoDte", "ambiente", "prepareToken"].every((k) => typeof value[k] === "string") &&
    isObject(value.totales) && isObject(value.documento);
}

function errorResponse(error: unknown, secretText: string | null): Response {
  let status = 500;
  const body: FactaHandlerErrorBody = {
    error: { code: "internal_error", message: "The request could not be completed.", retryable: false },
  };
  if (error instanceof HandlerError) {
    status = error.status;
    body.error = { code: error.code, message: error.message, retryable: false };
    if (error.fields) body.error.fields = error.fields;
  } else if (error instanceof FactaSessionError) {
    status = 401;
    body.error = { code: error.code, message: error.message, retryable: false };
  } else if (error instanceof FactaError) {
    status = error.status >= 400 && error.status <= 599 ? error.status : error.code === "network_error" ? 502 : 500;
    let message = error.message;
    if (secretText !== null) message = message.replaceAll(secretText, "[REDACTED]");
    body.error = { code: error.code, message, retryable: RETRYABLE.has(error.code) };
    const spent = error.spent;
    if (spent !== null) body.error.spent = spent;
    const observaciones = error.mhObservations;
    if (observaciones.length > 0) body.error.observaciones = observaciones;
  }
  return json(status, body, status === 405 ? { allow: "POST" } : {});
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

/** Build the fiscal request from the session plus whatever the browser may change. */
function buildRequest(session: FactaSession, body: Record<string, unknown>): DteRequest {
  const tipo = resolveTipoDte(body.tipoDte, session.allow, session.request.tipoDte);
  if (!tipo.ok) throw new HandlerError("recipient_invalid", "The document type is not allowed.", 422, tipo.errors);
  const base = session.request.receptor as Recipient | null | undefined;
  const checked = validateRecipient(body.recipient, {
    tipoDte: tipo.tipoDte,
    policy: session.allow.recipient,
    base: isObject(base) ? base : null,
  });
  if (!checked.ok) throw new HandlerError("recipient_invalid", "The recipient data is not valid.", 422, checked.errors);
  const merged = mergeRecipient(isObject(base) ? base : null, checked.recipient);
  const request = { ...session.request, tipoDte: tipo.tipoDte } as Record<string, unknown>;
  if (merged !== undefined && merged !== null) request.receptor = merged;
  return request as unknown as DteRequest;
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
  const { facta, sessionSecret } = options;
  const exposeDocument = options.exposeDocument === true;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const secretText = typeof sessionSecret === "string" ? sessionSecret : null;

  async function handle(req: Request): Promise<Response> {
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
    if (!ALL_ACTIONS.includes(body.action)) throw new HandlerError("bad_request", "Unknown action.", 400);
    const session = await verifyFactaSession(body.session, sessionSecret);

    if (authorize !== "session-only") {
      let allowed: boolean;
      try {
        allowed = (await (authorize as (r: Request, s: FactaSession) => boolean | Promise<boolean>)(req, session)) === true;
      } catch {
        throw new HandlerError("unauthorized", "Not authorized.", 401);
      }
      if (!allowed) throw new HandlerError("unauthorized", "Not authorized.", 403);
    }
    if (!MODE_ACTIONS[session.mode].includes(body.action)) {
      throw new HandlerError("action_not_allowed", "This action is not allowed for this session.", 403);
    }
    const download = session.allow.download !== false;
    const key = session.idempotencyKey;

    switch (body.action) {
      case "session.describe":
        return json(200, {
          draft: session.request,
          allow: session.allow,
          mode: session.mode,
          environment: session.environment ?? null,
          expiresAt: new Date(session.exp * 1000).toISOString(),
          ...(session.display ? { display: session.display } : {}),
        });
      case "issue": {
        const result = await facta.issue(buildRequest(session, body), { idempotencyKey: key });
        return json(200, { result: summarizeIssue(result, download, exposeDocument) });
      }
      case "prepare": {
        const prepared = summarizePrepared(await facta.prepare(buildRequest(session, body), { idempotencyKey: key }));
        return json(200, { prepared, preparedSeal: await seal(sessionSecret, session.nonce, prepared) });
      }
      case "sign": {
        if (!isPrepared(body.prepared) || typeof body.preparedSeal !== "string") {
          throw new HandlerError("bad_request", "prepared and preparedSeal are required.", 400);
        }
        const given = base64urlDecode(body.preparedSeal);
        const expected = base64urlDecode(await seal(sessionSecret, session.nonce, body.prepared));
        if (given === null || expected === null || !timingSafeEqual(given, expected)) {
          throw new HandlerError("bad_request", "The prepared document does not match its seal.", 400);
        }
        const result = await facta.sign(body.prepared, { idempotencyKey: `${key}:sign` });
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
    try {
      return await handle(req);
    } catch (error) {
      return errorResponse(error, secretText);
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

