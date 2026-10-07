// The request handler that sits between the browser window and `Facta`
// (docs/react-signing-ui.md §3 and §5, simplified: the window never edits data).
//
// It owns the `Facta` instance, so the apiKey and signKey never leave the
// implementer's server. Every response is built from an allow-list of fields.
// Actions: `session.describe`, `issue`, `status`, `delivery.status`, plus the
// data actions declared in `capabilities` (documents, downloads, catalog,
// service and storage status, session-bound invalidation).

import { FactaError } from "../errors.ts";
import type { Facta } from "../client.ts";
import type { ArchiveEmissionResult } from "../archive.ts";
import { archivoDteOf } from "../archivo-dte.ts";
import type {
  DeliverOptions,
  DeliveryChannel,
  DeliveryChannels,
  DeliveryChannelStatus,
  DocumentStatus,
  IssueResult,
  ManagedStorageArtifactState,
  ManagedStorageReceipt,
} from "../types.ts";
import { openDeliveryHandle, sealDeliveryHandle } from "./delivery-handle.ts";
import {
  allows,
  type FactaAction,
  type FactaCapabilities,
  type FactaInvalidationAction,
  type FactaReadAction,
  INVALIDATION_ACTIONS,
  READ_ACTIONS,
  validateCapabilities,
} from "./capabilities.ts";
import { createDataActions, DataActionError, type FactaDataLike } from "./data-actions.ts";
import {
  base64urlDecode,
  base64urlEncode,
  FactaSessionError,
  type FactaInvalidationSession,
  type FactaSession,
  hmac,
  secretBytes,
  timingSafeEqual,
  verifyFactaInvalidationSession,
  verifyFactaSession,
} from "./session.ts";

/** The slice of `Facta` the handler uses; a fake can stand in for tests. */
export type FactaLike =
  & Pick<Facta, "issue" | "getDocumentStatus">
  & Partial<Pick<Facta, "issueAndArchive" | "archiveConfigured" | "environment" | "deliverEmail" | "deliverWhatsApp" | "getDelivery">>
  & FactaDataLike;

/**
 * What `authorize` receives. `action` is always present. For the issuing and
 * invalidation actions the session's own fields are spread in (so code written
 * for the earlier `(req, session)` shape keeps working) and `session` holds it
 * whole; read actions carry no session.
 */
export type FactaAuthorizeContext =
  & Partial<Omit<FactaSession, "v">>
  & { action: FactaAction; session?: FactaSession | FactaInvalidationSession };

/** Filters the host forces onto `documents.list`; the browser cannot widen them. */
export type FactaListScope = Partial<Pick<import("../types.ts").ListDocumentsFilters, "desde" | "hasta" | "estado" | "tipoDte">>;

/** What the browser learns about storage. No paths, bucket names, destination ids or credentials. */
export interface FactaStorageSummary {
  /** Worst of Facta's managed JSON and PDF copies; null when the API reported no receipt. */
  managed: ManagedStorageArtifactState | null;
  /** The integrator's own archive: `off` when this handler did not archive. */
  archive: "complete" | "partial" | "failed" | "off";
  /** Remote (BYOS) copy counts, present only when destinations were configured. */
  copies?: { complete: number; pending: number; failed: number };
}

export type FactaArchiveMode = "auto" | "required" | "off";

/** Context handed to `onIssued`. Server-side only: it may name destinations. */
export interface FactaIssuedContext {
  session: FactaSession;
  /** The archive outcome, or null when no archive was used. */
  archive: ArchiveEmissionResult["archive"] | null;
  storage: FactaStorageSummary;
}

/** A field Hacienda or the API pointed at, so the host can highlight it in its own form. */
export interface FactaFieldIssue {
  /** Dotted path with `[n]` indices, e.g. `receptor.nrc` or `items[2].precioUni`. */
  path: string;
  message: string;
}

/** For the integrator's logging. Never carries a credential or the session secret. */
export type FactaHandlerEvent =
  | { type: "issued"; idempotencyKey: string; codigoGeneracion: string; numeroControl: string; tipoDte: string; ambiente: string; storage: FactaStorageSummary }
  | { type: "contingency"; idempotencyKey: string; codigoGeneracion: string; numeroControl: string; tipoDte: string; ambiente: string; storage: FactaStorageSummary }
  | {
    type: "rejected";
    idempotencyKey: string;
    code: string;
    status: number;
    observaciones: string[];
    spent?: { codigoGeneracion: string; numeroControl: string };
  }
  | { type: "error"; idempotencyKey?: string; code: string; status: number; retryable: boolean }
  | { type: "invalidated"; idempotencyKey: string; codigoGeneracion: string; alreadyInvalidated: boolean }
  /** A channel POST failed (token expired, network, …). Never carries the delivery token or the recipient. */
  | { type: "delivery_error"; idempotencyKey?: string; codigoGeneracion: string; channel: DeliveryChannel; code: string; status: number };

/** `code` of the `error` event emitted when `onIssued` throws. */
export const ON_ISSUED_FAILED = "on_issued_failed";

export interface FactaHandlerOptions {
  facta: FactaLike;
  /** At least 32 bytes. Signs session tokens. */
  sessionSecret: string | Uint8Array;
  /**
   * REQUIRED. Check the implementer's own login/cookie. Return `true` to
   * continue; `false` answers 403 and a throw answers 401. The literal
   * `"session-only"` accepts any valid session token (anonymous checkout pages).
   */
  authorize: "session-only" | ((req: Request, ctx: FactaAuthorizeContext) => boolean | Promise<boolean>);
  /**
   * What the browser may read or do beyond issuing. Default `{}`: nothing.
   * Anything not declared answers 403 `action_not_allowed`.
   */
  capabilities?: FactaCapabilities;
  /** Filters forced onto `documents.list` (e.g. only this branch). Runs after `authorize`. */
  scope?: (req: Request, ctx: FactaAuthorizeContext) => FactaListScope | Promise<FactaListScope>;
  /**
   * Send the receiver's name (and the document number masked) to the browser in
   * lists and details, and customers' document numbers in full. Default false:
   * personal data stays on the server (D-6).
   */
  exposeRecipient?: boolean;
  /** Largest file `documents.download` returns, in bytes. Default 8 MiB. */
  maxDownloadBytes?: number;
  /** Return `jws` and the full `documento` in sealed results. Default false. */
  exposeDocument?: boolean;
  /** Default 32 768. */
  maxBodyBytes?: number;
  /**
   * `auto` (default): archive locally and replicate through `issueAndArchive`
   * when the client has `runtime.archive`, else plain `issue`. `required`:
   * throw at construction when no archive is configured. `off`: never archive.
   */
  archive?: FactaArchiveMode;
  /**
   * Awaited after a fiscal result (sealed or contingency) so you can persist it
   * in your own database. If it throws, an `error` event is emitted and the
   * browser still receives the fiscal result.
   */
  onIssued?: (result: IssueResult, context: FactaIssuedContext) => void | Promise<void>;
  /**
   * How long a sealed `issue` waits for the channel POSTs it just started
   * (they never block beyond this; the final state is read through
   * `delivery.status`). Default 1 500 ms. Needed because a serverless runtime
   * may stop work that is still running once the response is sent.
   */
  deliveryStartTimeoutMs?: number;
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
    /** Present with `spent`: lets the window ask `status` about that document. */
    statusToken?: string;
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
const ACTIONS = ["session.describe", "issue", "status", "delivery.status"];
const DEFAULT_MAX_DOWNLOAD = 8 * 1024 * 1024;
const DEFAULT_DELIVERY_START_TIMEOUT_MS = 1_500;
const DELIVERY_FIELDS = ["estado", "destino", "motivo", "actualizado"] as const;

const STATUS_DOMAIN = "facta-status-v1.";

/** `HMAC(sessionSecret, nonce + ":" + codigoGeneracion)`: ties a `status` lookup to the session that produced the document. */
export async function statusTokenFor(secret: string | Uint8Array, nonce: string, codigoGeneracion: string): Promise<string> {
  return base64urlEncode(await hmac(secret, `${STATUS_DOMAIN}${nonce}:${codigoGeneracion}`));
}

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
    // The server's own field, or built from the same pieces for an API that predates it.
    const archivoDte = download ? archivoDteOf(result) : null;
    if (archivoDte !== null) out.archivoDte = archivoDte;
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

function markedChannels(deliver: DeliverOptions | undefined): DeliveryChannel[] {
  const out: DeliveryChannel[] = [];
  if (deliver?.email !== undefined) out.push("correo");
  if (deliver?.whatsapp !== undefined) out.push("whatsapp");
  return out;
}

/** Allow-list of what the browser learns per channel: state, masked destination, reason, time. */
function summarizeDelivery(canales: DeliveryChannels | undefined, channels: DeliveryChannel[]): Record<string, unknown> {
  const out: Record<string, DeliveryChannelStatus> = {};
  for (const channel of channels) {
    const source = canales?.[channel] as unknown as Record<string, unknown> | undefined;
    if (!isObject(source) || typeof source.estado !== "string") continue;
    const view: Record<string, unknown> = {};
    for (const field of DELIVERY_FIELDS) {
      const value = source[field];
      if (typeof value === "string" || (field === "motivo" && value === null)) view[field] = value;
    }
    out[channel] = view as unknown as DeliveryChannelStatus;
  }
  return { canales: out };
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

// --- Storage summary ----------------------------------------------------------

const MANAGED_SEVERITY: ManagedStorageArtifactState[] = ["failed", "pending", "unsupported", "not_configured", "stored"];

function managedState(receipt: ManagedStorageReceipt | undefined, errorCode: string | undefined): ManagedStorageArtifactState | null {
  if (receipt) {
    const states = [receipt.json?.state, receipt.pdf?.state].filter((v): v is ManagedStorageArtifactState => v !== undefined);
    for (const candidate of MANAGED_SEVERITY) if (states.includes(candidate)) return candidate;
  }
  return errorCode === undefined ? null : "failed";
}

/** Count-only view of one archived emission; fiscal success never depends on it. */
export function summarizeStorage(result: IssueResult, archived: ArchiveEmissionResult | null): FactaStorageSummary {
  const managed = managedState(archived?.managedStorage ?? result.storage, archived?.storageErrorCode ?? result.storageErrorCode);
  if (archived === null) return { managed, archive: "off" };
  const records = archived.archive.remoteCopies ?? [];
  const copies = { complete: 0, pending: 0, failed: 0 };
  for (const record of records) {
    if (record.state === "stored") copies.complete++;
    else if (record.state === "failed") copies.failed++;
    else copies.pending++;
  }
  let archive: FactaStorageSummary["archive"];
  if (archived.archive.state === "complete") archive = copies.pending + copies.failed > 0 ? "partial" : "complete";
  else archive = archived.archive.artifacts.length > 0 ? "partial" : "failed";
  return { managed, archive, ...(records.length > 0 ? { copies } : {}) };
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
  if (error instanceof DataActionError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, retryable: false } } };
  }
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
  const { facta, sessionSecret, onEvent, onIssued } = options;
  const archiveMode = options.archive ?? "auto";
  if (archiveMode !== "auto" && archiveMode !== "required" && archiveMode !== "off") {
    throw new TypeError("archive must be \"auto\", \"required\" or \"off\".");
  }
  const archiveAvailable = facta.archiveConfigured === true && typeof facta.issueAndArchive === "function";
  if (archiveMode === "required" && !archiveAvailable) {
    throw new TypeError(
      "archive: \"required\" needs a Facta client configured with runtime.archive (see issueAndArchive).",
    );
  }
  const useArchive = archiveMode !== "off" && archiveAvailable;
  const exposeDocument = options.exposeDocument === true;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const secretText = typeof sessionSecret === "string" ? sessionSecret : null;
  const deliveryTimeout = options.deliveryStartTimeoutMs ?? DEFAULT_DELIVERY_START_TIMEOUT_MS;
  const capabilities = validateCapabilities(options.capabilities);
  const data = createDataActions({
    facta,
    capabilities,
    exposeRecipient: options.exposeRecipient === true,
    maxDownloadBytes: options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD,
    statusTtlMs: 15_000,
  });

  async function check(req: Request, context: FactaAuthorizeContext): Promise<void> {
    if (authorize === "session-only") return;
    let allowed: boolean;
    try {
      allowed = (await (authorize as (r: Request, c: FactaAuthorizeContext) => boolean | Promise<boolean>)(req, context)) === true;
    } catch {
      throw new HandlerError("unauthorized", "Not authorized.", 401);
    }
    if (!allowed) throw new HandlerError("unauthorized", "Not authorized.", 403);
  }

  function declared(action: FactaReadAction | FactaInvalidationAction): void {
    if (!allows(capabilities, action)) {
      throw new HandlerError("action_not_allowed", "This action is not enabled on this handler.", 403);
    }
  }

  /** After a sealed issue: start the marked channels and mint the handle. Empty when nothing was marked. */
  async function startDelivery(session: FactaSession, result: IssueResult): Promise<Record<string, unknown>> {
    const channels = markedChannels(session.deliver);
    const offer = result.entrega;
    if (channels.length === 0 || !isObject(offer) || !isObject(offer.canales)) return {};
    let canales: DeliveryChannels = offer.canales;
    const token = typeof offer.token === "string" && offer.token !== "" ? offer.token : undefined;
    const tokenExp = typeof offer.venceEn === "string" && Number.isFinite(Date.parse(offer.venceEn))
      ? Math.floor(Date.parse(offer.venceEn) / 1000)
      : undefined;
    if (result.estado === "sellado" && token !== undefined) {
      const starting = channels.filter((c) => canales[c]?.estado === "pendiente");
      if (starting.length > 0) {
        canales = { ...canales, ...await startChannels(session, result.codigoGeneracion, token, starting) };
      }
    }
    const deliveryHandle = await sealDeliveryHandle(sessionSecret, session.nonce, {
      codigoGeneracion: result.codigoGeneracion,
      ...(token === undefined ? {} : { token }),
      ...(token === undefined || tokenExp === undefined ? {} : { tokenExp }),
    });
    return { deliveryHandle, delivery: summarizeDelivery(canales, channels) };
  }

  function emit(event: FactaHandlerEvent): void {
    if (!onEvent) return;
    // Fire and forget: a slow or failing hook must not change the response.
    void Promise.resolve().then(() => onEvent(event)).catch(() => undefined);
  }

  /**
   * Start the given channels with Facta's delivery token, waiting at most
   * `deliveryTimeout` for them. Failures become `delivery_error` events;
   * whatever finished in time is returned so the first browser view is fresher.
   */
  async function startChannels(
    session: FactaSession,
    codigoGeneracion: string,
    token: string,
    channels: DeliveryChannel[],
  ): Promise<DeliveryChannels> {
    const finished: DeliveryChannels = {};
    const work = channels.map(async (channel) => {
      const send = channel === "correo" ? facta.deliverEmail : facta.deliverWhatsApp;
      if (typeof send !== "function") {
        emit({ type: "delivery_error", idempotencyKey: session.idempotencyKey, codigoGeneracion, channel, code: "delivery_unsupported", status: 0 });
        return;
      }
      try {
        const answer = await send.call(facta, codigoGeneracion, token);
        if (isObject(answer) && typeof answer.estado === "string") finished[channel] = answer;
      } catch (error) {
        const known = error instanceof FactaError;
        emit({
          type: "delivery_error",
          idempotencyKey: session.idempotencyKey,
          codigoGeneracion,
          channel,
          code: known ? error.code : "internal_error",
          status: known ? error.status : 0,
        });
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(work),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deliveryTimeout);
      }),
    ]);
    clearTimeout(timer);
    return { ...finished };
  }

  async function handle(req: Request, ctx: { session?: FactaSession; invalidation?: FactaInvalidationSession }): Promise<Response> {
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
    const action = body.action;
    if ((READ_ACTIONS as readonly string[]).includes(action)) {
      // Reads carry no session: the capability list and `authorize` are the gate.
      const readAction = action as FactaReadAction;
      declared(readAction);
      const context: FactaAuthorizeContext = { action: readAction };
      await check(req, context);
      const forced = readAction === "documents.list" && options.scope ? await options.scope(req, context) : {};
      return json(200, await data.read(readAction, body, forced));
    }
    if ((INVALIDATION_ACTIONS as readonly string[]).includes(action)) {
      const invAction = action as FactaInvalidationAction;
      declared(invAction);
      const inv = await verifyFactaInvalidationSession(body.session, sessionSecret);
      ctx.invalidation = inv;
      await check(req, { action: invAction, session: inv, idempotencyKey: inv.idempotencyKey, nonce: inv.nonce, iat: inv.iat, exp: inv.exp });
      if (invAction === "invalidate.describe") {
        return json(200, await data.describeInvalidation(inv, facta.environment ?? null));
      }
      const done = await data.invalidate(inv);
      emit({
        type: "invalidated",
        idempotencyKey: inv.idempotencyKey,
        codigoGeneracion: inv.generationCode,
        alreadyInvalidated: "yaEstabaInvalidado" in done.result && done.result.yaEstabaInvalidado === true,
      });
      return json(200, done.body);
    }
    if (!ACTIONS.includes(action)) throw new HandlerError("bad_request", "Unknown action.", 400);
    const session = await verifyFactaSession(body.session, sessionSecret);
    ctx.session = session;
    await check(req, { ...session, action: action as FactaAction, session });
    const download = session.download !== false;

    switch (body.action) {
      case "session.describe":
        return json(200, {
          draft: session.request,
          environment: facta.environment ?? null,
          download,
          expiresAt: new Date(session.exp * 1000).toISOString(),
          ...(session.display ? { display: session.display } : {}),
        });
      case "issue": {
        const key = session.idempotencyKey;
        let result: IssueResult;
        let archived: ArchiveEmissionResult | null = null;
        if (useArchive) {
          archived = await facta.issueAndArchive!(session.request, {
            operationId: key,
            idempotencyKey: key,
            includeTicket: false,
            ...(session.deliver ? { deliver: session.deliver } : {}),
          });
          // A recovered operation may omit the emission; the same idempotency key replays it.
          result = archived.emission ?? await facta.issue(session.request, { idempotencyKey: key, ...(session.deliver ? { deliver: session.deliver } : {}) });
        } else {
          result = await facta.issue(session.request, { idempotencyKey: key, ...(session.deliver ? { deliver: session.deliver } : {}) });
        }
        const storage = summarizeStorage(result, archived);
        emit({
          type: result.estado === "sellado" ? "issued" : "contingency",
          idempotencyKey: key,
          codigoGeneracion: result.codigoGeneracion,
          numeroControl: result.numeroControl,
          tipoDte: result.tipoDte,
          ambiente: result.ambiente,
          storage,
        });
        if (onIssued) {
          try {
            await onIssued(result, { session, archive: archived?.archive ?? null, storage });
          } catch {
            // Never hide a fiscal document from the browser because the host's own persistence failed.
            emit({ type: "error", idempotencyKey: key, code: ON_ISSUED_FAILED, status: 200, retryable: false });
          }
        }
        const delivery = await startDelivery(session, result);
        return json(200, {
          result: summarizeIssue(result, download, exposeDocument),
          storage,
          ...(result.emergency === undefined ? {} : { emergency: { saved: result.emergency.saved, reason: result.emergency.reason, ...(result.emergency.critical ? { critical: true } : {}) } }),
          statusToken: await statusTokenFor(sessionSecret, session.nonce, result.codigoGeneracion),
          // Only when the host's own client asked the API for timings (`debug: { timings: true }`).
          ...(result.debug === undefined ? {} : { debug: result.debug }),
          ...delivery,
        });
      }
      case "delivery.status": {
        const opened = await openDeliveryHandle(sessionSecret, body.deliveryHandle, session.nonce);
        if (opened === null) {
          throw new HandlerError("action_not_allowed", "This delivery does not belong to this session.", 403);
        }
        if (typeof facta.getDelivery !== "function") {
          throw new HandlerError("bad_request", "This Facta client cannot read delivery states.", 400);
        }
        const channels = markedChannels(session.deliver);
        let status = await facta.getDelivery(opened.codigoGeneracion);
        // A POST that never got through leaves its channel `pendiente`: the route is idempotent per
        // channel, so while the token lives, start it again.
        const stalled = channels.filter((c) => status.canales?.[c]?.estado === "pendiente");
        if (opened.token !== undefined && stalled.length > 0 && (opened.tokenExp ?? 0) * 1000 > Date.now()) {
          const refreshed = await startChannels(session, opened.codigoGeneracion, opened.token, stalled);
          status = { ...status, canales: { ...status.canales, ...refreshed } };
        }
        return json(200, { delivery: summarizeDelivery(status.canales, channels) });
      }
      default: {
        const code = body.codigoGeneracion;
        if (typeof code !== "string" || !/^[0-9A-Fa-f-]{36}$/.test(code) || typeof body.statusToken !== "string") {
          throw new HandlerError("bad_request", "codigoGeneracion and statusToken are required.", 400);
        }
        const given = base64urlDecode(body.statusToken);
        const expected = base64urlDecode(await statusTokenFor(sessionSecret, session.nonce, code));
        if (given === null || expected === null || !timingSafeEqual(given, expected)) {
          throw new HandlerError("action_not_allowed", "This document does not belong to this session.", 403);
        }
        return json(200, { status: summarizeStatus(await facta.getDocumentStatus(code)) });
      }
    }
  }

  return async (req: Request): Promise<Response> => {
    const ctx: { session?: FactaSession; invalidation?: FactaInvalidationSession } = {};
    try {
      return await handle(req, ctx);
    } catch (error) {
      const { status, body } = errorBody(error, secretText);
      const idempotencyKey = ctx.session?.idempotencyKey ?? ctx.invalidation?.idempotencyKey;
      if (ctx.session && body.error.spent) {
        body.error.statusToken = await statusTokenFor(sessionSecret, ctx.session.nonce, body.error.spent.codigoGeneracion);
      }
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
      new Request(`http://${host}${req.url ?? "/"}`, { method, headers, body: (body ?? null) as BodyInit | null }),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(new Uint8Array(await response.arrayBuffer()));
  };
}
