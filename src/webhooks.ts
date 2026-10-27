// Catalogue change feed, webhook management types and the delivery verifier.
//
// A webhook is a hint, never data: Facta POSTs `{ deliveryId, event, company, recordId, revision,
// generation, at }` signed with `Facta-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the
// HMAC is over `t + "." + rawBody` with the webhook secret. Verify the RAW body bytes, before parsing.
// Only WebCrypto is used, so the verifier runs on Node 22+, Deno, Bun, workers and browsers.

import { FactaError } from "./errors.ts";

export const WEBHOOK_SIGNATURE_HEADER = "Facta-Signature";
/** Deliveries older (or newer) than this many seconds are refused. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Events a webhook can subscribe to; an empty list means all of them. */
export const WEBHOOK_EVENTS = [
  "catalog.customer.created",
  "catalog.customer.updated",
  "catalog.customer.deactivated",
  "catalog.customer.deleted",
  "catalog.product.created",
  "catalog.product.updated",
  "catalog.product.deactivated",
  "catalog.product.deleted",
  "catalog.restored",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** A webhook of the key. The signing secret is never part of it. */
export interface Webhook {
  id: string;
  url: string;
  /** Empty means every event. */
  events: WebhookEventName[];
  description: string | null;
  active: boolean;
  /** `too_many_failures` when Facta switched it off after ten exhausted deliveries in a row. */
  disabledBy: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

/** What `createWebhook` and `rotateWebhookSecret` return: the webhook plus its secret, shown once. */
export interface WebhookWithSecret extends Webhook {
  /** `whsec_…`. Store it now; no route reads it back. */
  secret: string;
}

export interface WebhookInput {
  /** `https://`, port 443, a public host, no credentials. */
  url: string;
  events?: readonly WebhookEventName[];
  description?: string;
}

export interface WebhookChanges {
  url?: string;
  events?: readonly WebhookEventName[];
  description?: string | null;
  /** `true` switches it back on and clears the failure count. */
  active?: boolean;
}

export interface CatalogChangesOptions {
  /** Catalogue revision to continue from; 0 (the default) reads from the start. */
  since?: number;
  /** The `generation` of the previous page, so a restore is not mistaken for a long history. */
  generation?: string | null;
  /** Page size. */
  limit?: number;
  signal?: AbortSignal;
}

export interface CatalogChange {
  /** Position of this change in the company catalogue. */
  revision: number;
  type: "customer" | "product" | "catalog";
  /** `null` for a restore (`type: "catalog"`). */
  recordId: string | null;
  /** The record's own revision after the change. */
  recordRevision: number | null;
  operation: "create" | "update" | "deactivate" | "delete" | "restore";
  actor: { type: "owner" | "user" | "operator" | "api" | "system"; keyId?: string };
  at: string;
}

export interface CatalogChangesPage {
  generation: string | null;
  /** The current catalogue revision. */
  head: number;
  changes: CatalogChange[];
  /** Your next `since`. */
  next: number;
  hasMore: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const bad = (what: string): never => {
  throw new FactaError("internal_error", `La respuesta de ${what} no tiene la forma esperada.`, 502);
};

export function catalogChangesOf(payload: unknown): CatalogChangesPage {
  if (!isObject(payload) || !Array.isArray(payload["cambios"])) return bad("cambios del catálogo");
  return {
    generation: typeof payload["generacion"] === "string" ? payload["generacion"] : null,
    head: Number(payload["cabeza"] ?? 0),
    changes: payload["cambios"].map((row) => {
      const r = isObject(row) ? row : {};
      const actor = isObject(r["actor"]) ? r["actor"] : {};
      return {
        revision: Number(r["revision"]),
        type: r["tipo"] as CatalogChange["type"],
        recordId: typeof r["registroId"] === "string" ? r["registroId"] : null,
        recordRevision: typeof r["registroRevision"] === "number" ? r["registroRevision"] : null,
        operation: r["operacion"] as CatalogChange["operation"],
        actor: { type: actor["tipo"] as CatalogChange["actor"]["type"], ...(typeof actor["llave"] === "string" ? { keyId: actor["llave"] } : {}) },
        at: String(r["en"] ?? ""),
      };
    }),
    next: Number(payload["siguiente"] ?? 0),
    hasMore: payload["hayMas"] === true,
  };
}

export function webhookOf(payload: unknown, withSecret: true): WebhookWithSecret;
export function webhookOf(payload: unknown, withSecret: false): Webhook;
export function webhookOf(payload: unknown, withSecret: boolean): Webhook | WebhookWithSecret {
  const r = isObject(payload) && isObject(payload["webhook"]) ? payload["webhook"] : payload;
  if (!isObject(r) || typeof r["id"] !== "string" || typeof r["url"] !== "string") return bad("webhooks");
  const hook: Webhook = {
    id: r["id"],
    url: r["url"],
    events: Array.isArray(r["eventos"]) ? (r["eventos"] as WebhookEventName[]) : [],
    description: typeof r["descripcion"] === "string" ? r["descripcion"] : null,
    active: r["activo"] !== false,
    disabledBy: typeof r["desactivadoPor"] === "string" ? r["desactivadoPor"] : null,
    consecutiveFailures: Number(r["fallosSeguidos"] ?? 0),
    createdAt: String(r["creado"] ?? ""),
    updatedAt: String(r["actualizado"] ?? ""),
  };
  if (!withSecret) return hook;
  const secret = isObject(payload) ? (payload["secreto"] ?? r["secreto"]) : undefined;
  if (typeof secret !== "string") return bad("webhooks (sin secreto)");
  return { ...hook, secret: secret as string };
}

/** The wire body of `createWebhook` / `updateWebhook`. */
export function webhookBody(input: WebhookInput | WebhookChanges, creating: boolean): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("webhook input must be an object.");
  const allowed = new Set(["url", "events", "description", ...(creating ? [] : ["active"])]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`Unknown webhook field «${key}».`);
  const body: Record<string, unknown> = {};
  if (input.url !== undefined) body["url"] = input.url;
  else if (creating) throw new TypeError("A webhook needs a url.");
  if (input.events !== undefined) body["eventos"] = [...input.events];
  if (input.description !== undefined) body["descripcion"] = input.description;
  if ("active" in input && input.active !== undefined) body["activo"] = input.active;
  if (!creating && Object.keys(body).length === 0) throw new TypeError("Pass at least one field to change.");
  return body;
}

// ── delivery verification ───────────────────────────────────────────────────

/** The body Facta sends. Only ids and revisions, never customer or product data. */
export interface WebhookDelivery {
  deliveryId: string;
  event: string;
  company: string;
  recordId: string | null;
  revision: number;
  generation: string | null;
  at: string;
  [field: string]: unknown;
}

export type WebhookVerifyFailure = "malformed_header" | "stale_timestamp" | "bad_signature" | "malformed_body" | "replayed";

export type WebhookVerifyResult =
  | { ok: true; deliveryId: string; event: string; delivery: WebhookDelivery }
  | { ok: false; reason: WebhookVerifyFailure };

/** Remembers the `deliveryId`s a receiver already accepted. Back it with a database for more than one process. */
export interface WebhookReplayStore {
  has(deliveryId: string): boolean | Promise<boolean>;
  add(deliveryId: string, atSeconds: number): void | Promise<void>;
}

/** An in-memory store that forgets entries older than twice the tolerance (they could not verify anyway). */
export class MemoryWebhookReplayStore implements WebhookReplayStore {
  readonly #seen = new Map<string, number>();
  has(deliveryId: string): boolean { return this.#seen.has(deliveryId); }
  add(deliveryId: string, atSeconds: number): void {
    this.#seen.set(deliveryId, atSeconds);
    for (const [key, when] of this.#seen) if (atSeconds - when > WEBHOOK_TOLERANCE_SECONDS * 2) this.#seen.delete(key);
  }
  get size(): number { return this.#seen.size; }
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

const bodyText = (body: string | Uint8Array | ArrayBuffer): string =>
  typeof body === "string" ? body : new TextDecoder().decode(body instanceof ArrayBuffer ? new Uint8Array(body) : body);

/** The `Facta-Signature` value for a body (what Facta sends; useful to test your receiver). */
export async function signWebhook(secret: string, body: string | Uint8Array, atSeconds: number = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${atSeconds},v1=${await hmacHex(secret, `${atSeconds}.${bodyText(body)}`)}`;
}

export interface VerifyWebhookOptions {
  /** The `whsec_…` secret returned when the webhook was created or rotated. */
  secret: string;
  /** The `Facta-Signature` header, as received. */
  header: string | null | undefined;
  /** The RAW request body (do not re-serialize parsed JSON). */
  body: string | Uint8Array | ArrayBuffer;
  /** Defaults to now. */
  nowSeconds?: number;
  /** Rejects a `deliveryId` seen before. Only a delivery that passes every check is remembered. */
  replayStore?: WebhookReplayStore;
  toleranceSeconds?: number;
}

/**
 * Checks, in order: the header parses, the timestamp is within the tolerance, one `v1` matches the
 * HMAC of `t.body` (constant time; several `v1` are allowed so a secret can rotate), the body is the
 * delivery object, and the `deliveryId` is new. Never throws for a bad delivery: read `ok`.
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<WebhookVerifyResult> {
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const text = bodyText(options.body);
  let t: number | null = null;
  const candidates: string[] = [];
  for (const part of (options.header ?? "").split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t" && /^[0-9]{1,12}$/.test(value)) t = Number(value);
    if (name === "v1" && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (t === null || candidates.length === 0) return { ok: false, reason: "malformed_header" };
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: "stale_timestamp" };
  const expected = await hmacHex(options.secret, `${t}.${text}`);
  let matched = false;
  for (const candidate of candidates) if (equalConstantTime(expected, candidate)) matched = true;
  if (!matched) return { ok: false, reason: "bad_signature" };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: "malformed_body" }; }
  if (!isObject(parsed) || typeof parsed["deliveryId"] !== "string" || parsed["deliveryId"] === "" || typeof parsed["event"] !== "string") {
    return { ok: false, reason: "malformed_body" };
  }
  if (options.replayStore !== undefined) {
    if (await options.replayStore.has(parsed["deliveryId"])) return { ok: false, reason: "replayed" };
    await options.replayStore.add(parsed["deliveryId"], now);
  }
  return { ok: true, deliveryId: parsed["deliveryId"], event: parsed["event"], delivery: parsed as WebhookDelivery };
}

/** Thrown by `constructWebhookEvent`. `reason` says which check failed. */
export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
  readonly reason: WebhookVerifyFailure;
  constructor(reason: WebhookVerifyFailure) {
    super(`Webhook delivery refused: ${reason}.`);
    this.reason = reason;
  }
}

/** `verifyWebhook` that throws `WebhookVerificationError` and returns the delivery. Answer 2xx to a repeated `deliveryId`, not an error. */
export async function constructWebhookEvent(options: VerifyWebhookOptions): Promise<WebhookDelivery> {
  const result = await verifyWebhook(options);
  if (!result.ok) throw new WebhookVerificationError(result.reason);
  return result.delivery;
}
