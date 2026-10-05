// Signed session tokens for the React signing window (docs/react-signing-ui.md §3).
//
// The implementer's server builds the fiscal request from ITS OWN order and
// seals it in a token. The browser carries the token and can change only what
// `allow` declares. Nothing here touches Facta credentials: the token is
// authenticated (HMAC-SHA256), not encrypted, so it must hold no secret.
//
// Web Crypto only, so it runs unchanged on Node 22, Deno and Bun.

import type { DteRequest, DteType } from "../types.ts";

export type FactaSessionMode = "confirm-then-issue" | "review-prepared";
export type FactaRecipientPolicy = "none" | "optional" | "required";

export interface FactaSessionAllow {
  /** Whether the person in the browser may supply or must supply the receptor. */
  recipient: FactaRecipientPolicy;
  /** Document types the browser may choose from. Absent: the request's type only. */
  types?: DteType[];
  /** Whether the PDF/JSON files travel to the browser. Default true. */
  download?: boolean;
}

export interface FactaSessionDisplay {
  /** The implementer's own total, shown as «Total de su pedido». Never computed here. */
  total?: number;
  currency?: "USD";
  reference?: string;
}

export interface CreateFactaSessionInput {
  /** The draft, authored by the implementer's server. */
  request: DteRequest;
  /** The implementer's own id for this sale (order number). Required. */
  idempotencyKey: string;
  allow?: Partial<FactaSessionAllow>;
  /** Default `confirm-then-issue`. */
  mode?: FactaSessionMode;
  display?: FactaSessionDisplay;
  /** Lifetime in seconds. Default 900 (15 min), at most 86 400. */
  expiresIn?: number;
  /** Only shown in the window header chip; the API decides the real environment. */
  environment?: "00" | "01";
}

export interface FactaSession {
  v: 1;
  nonce: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  request: DteRequest;
  idempotencyKey: string;
  allow: FactaSessionAllow;
  mode: FactaSessionMode;
  display?: FactaSessionDisplay;
  environment?: "00" | "01";
}

export class FactaSessionError extends Error {
  override readonly name = "FactaSessionError";
  readonly code: "session_invalid" | "session_expired";
  constructor(code: "session_invalid" | "session_expired", message: string) {
    super(message);
    this.code = code;
  }
}

export const DEFAULT_SESSION_TTL_SECONDS = 900;
const MAX_SESSION_TTL_SECONDS = 86_400;
const MIN_SECRET_BYTES = 32;
const DTE_TYPES: readonly string[] = ["01", "03", "05", "06", "11", "14"];
const SESSION_DOMAIN = "facta-session-v1.";

const encoder = new TextEncoder();

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function secretBytes(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === "string" ? encoder.encode(secret) : secret;
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new TypeError(`The session secret must be at least ${MIN_SECRET_BYTES} bytes.`);
  }
  return bytes;
}

/** HMAC-SHA256 of `domain + message` under `secret`. */
export async function hmac(secret: string | Uint8Array, message: string): Promise<Uint8Array> {
  const raw = secretBytes(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Compares two byte strings without an early exit on the first difference. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAllow(allow: Partial<FactaSessionAllow> | undefined): FactaSessionAllow {
  const recipient = allow?.recipient ?? "none";
  if (recipient !== "none" && recipient !== "optional" && recipient !== "required") {
    throw new TypeError("allow.recipient must be \"none\", \"optional\" or \"required\".");
  }
  const out: FactaSessionAllow = { recipient };
  if (allow?.types !== undefined) {
    if (
      !Array.isArray(allow.types) || allow.types.length === 0 ||
      allow.types.some((t) => !DTE_TYPES.includes(t)) ||
      new Set(allow.types).size !== allow.types.length
    ) {
      throw new TypeError("allow.types must be a non-empty list of distinct DTE types.");
    }
    out.types = [...allow.types];
  }
  if (allow?.download !== undefined) out.download = allow.download === true;
  return out;
}

function normalizeDisplay(display: FactaSessionDisplay | undefined): FactaSessionDisplay | undefined {
  if (display === undefined) return undefined;
  const out: FactaSessionDisplay = {};
  if (display.total !== undefined) {
    if (!Number.isFinite(display.total) || display.total < 0) {
      throw new TypeError("display.total must be a non-negative number.");
    }
    out.total = display.total;
  }
  if (display.currency !== undefined) {
    if (display.currency !== "USD") throw new TypeError("display.currency must be \"USD\".");
    out.currency = "USD";
  }
  if (display.reference !== undefined) {
    if (typeof display.reference !== "string" || display.reference.length > 80) {
      throw new TypeError("display.reference must be a string of at most 80 characters.");
    }
    out.reference = display.reference;
  }
  return out;
}

/**
 * Seal a draft into an opaque session token:
 * `base64url(json) + "." + base64url(HMAC-SHA256)`.
 *
 * Replaying a valid token is harmless: the idempotency key is inside it, so the
 * API answers with the same document.
 */
export async function createFactaSession(
  input: CreateFactaSessionInput,
  secret: string | Uint8Array,
  now: number = Date.now(),
): Promise<string> {
  secretBytes(secret);
  if (!isObject(input.request) || typeof input.request.tipoDte !== "string" || !Array.isArray(input.request.items)) {
    throw new TypeError("request must be a DTE request with tipoDte and items.");
  }
  if (
    typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim() === "" ||
    input.idempotencyKey.length > 200
  ) {
    throw new TypeError("idempotencyKey is required (your own order id, at most 200 characters).");
  }
  const mode = input.mode ?? "confirm-then-issue";
  if (mode !== "confirm-then-issue" && mode !== "review-prepared") {
    throw new TypeError("mode must be \"confirm-then-issue\" or \"review-prepared\".");
  }
  const ttl = input.expiresIn ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SESSION_TTL_SECONDS) {
    throw new TypeError(`expiresIn must be between 1 and ${MAX_SESSION_TTL_SECONDS} seconds.`);
  }
  if (input.environment !== undefined && input.environment !== "00" && input.environment !== "01") {
    throw new TypeError("environment must be \"00\" or \"01\".");
  }
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const iat = Math.floor(now / 1000);
  const display = normalizeDisplay(input.display);
  const payload: FactaSession = {
    v: 1,
    nonce: base64urlEncode(nonce),
    iat,
    exp: iat + Math.ceil(ttl),
    request: input.request,
    idempotencyKey: input.idempotencyKey,
    allow: normalizeAllow(input.allow),
    mode,
    ...(display === undefined ? {} : { display }),
    ...(input.environment === undefined ? {} : { environment: input.environment }),
  };
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  const mac = await hmac(secret, SESSION_DOMAIN + body);
  return `${body}.${base64urlEncode(mac)}`;
}

/**
 * Check the MAC and the expiry and return the payload.
 * Throws `FactaSessionError` (`session_invalid` | `session_expired`).
 */
export async function verifyFactaSession(
  token: unknown,
  secret: string | Uint8Array,
  now: number = Date.now(),
): Promise<FactaSession> {
  secretBytes(secret);
  const invalid = () => new FactaSessionError("session_invalid", "The session token is not valid.");
  if (typeof token !== "string" || token.length > 64 * 1024) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 2) throw invalid();
  const [body, macText] = parts;
  const given = base64urlDecode(macText);
  if (given === null) throw invalid();
  const expected = await hmac(secret, SESSION_DOMAIN + body);
  if (!timingSafeEqual(given, expected)) throw invalid();
  const raw = base64urlDecode(body);
  if (raw === null) throw invalid();
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw invalid();
  }
  if (
    !isObject(payload) || payload.v !== 1 || typeof payload.exp !== "number" ||
    typeof payload.nonce !== "string" || typeof payload.idempotencyKey !== "string" ||
    !isObject(payload.request) || !isObject(payload.allow) ||
    (payload.mode !== "confirm-then-issue" && payload.mode !== "review-prepared")
  ) {
    throw invalid();
  }
  if (payload.exp * 1000 <= now) {
    throw new FactaSessionError("session_expired", "The session has expired.");
  }
  return payload as unknown as FactaSession;
}
