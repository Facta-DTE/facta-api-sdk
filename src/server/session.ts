// Signed session tokens for the React signing window (docs/react-signing-ui.md §3).
//
// The implementer's server builds the fiscal request from ITS OWN order and
// seals it in a token. The browser carries the token and can change nothing:
// the request is final. Nothing here touches Facta credentials: the token is
// authenticated (HMAC-SHA256), not encrypted, so it must hold no secret.
//
// Web Crypto only, so it runs unchanged on Node 22, Deno and Bun.

import { deliveryRequestFor } from "../delivery.ts";
import type { DeliverOptions, DteRequest } from "../types.ts";

export interface FactaSessionDisplay {
  /** The implementer's own total, shown as «Total de su pedido». Never computed here. */
  total?: number;
  reference?: string;
  title?: string;
}

export interface CreateFactaSessionInput {
  /** The final request, authored by the implementer's server. The window never edits it. */
  request: DteRequest;
  /** The implementer's own id for this sale (order number). Required. */
  idempotencyKey: string;
  display?: FactaSessionDisplay;
  /** Whether the PDF/JSON files travel to the browser. Default true. */
  download?: boolean;
  /**
   * Delivery channels to start after a sealed issue. Set by YOUR server only:
   * the browser can neither add nor change it (it rides inside the signed
   * token, which is authenticated but readable, like the draft itself).
   */
  deliver?: DeliverOptions;
  /** Lifetime in seconds. Default 900 (15 min), at most 86 400. */
  expiresIn?: number;
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
  display?: FactaSessionDisplay;
  download?: boolean;
  deliver?: DeliverOptions;
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

function normalizeDisplay(display: FactaSessionDisplay | undefined): FactaSessionDisplay | undefined {
  if (display === undefined) return undefined;
  const out: FactaSessionDisplay = {};
  if (display.total !== undefined) {
    if (!Number.isFinite(display.total) || display.total < 0) {
      throw new TypeError("display.total must be a non-negative number.");
    }
    out.total = display.total;
  }
  for (const [key, max] of [["reference", 80], ["title", 120]] as const) {
    const value = display[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > max) {
      throw new TypeError(`display.${key} must be a string of at most ${max} characters.`);
    }
    out[key] = value;
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
  const ttl = input.expiresIn ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SESSION_TTL_SECONDS) {
    throw new TypeError(`expiresIn must be between 1 and ${MAX_SESSION_TTL_SECONDS} seconds.`);
  }
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const iat = Math.floor(now / 1000);
  const display = normalizeDisplay(input.display);
  if (input.deliver !== undefined) deliveryRequestFor(input.deliver); // throws on a malformed marking
  const payload: FactaSession = {
    v: 1,
    nonce: base64urlEncode(nonce),
    iat,
    exp: iat + Math.ceil(ttl),
    request: input.request,
    idempotencyKey: input.idempotencyKey,
    ...(display === undefined ? {} : { display }),
    ...(input.download === undefined ? {} : { download: input.download === true }),
    ...(input.deliver === undefined ? {} : { deliver: input.deliver }),
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
    !isObject(payload.request)
  ) {
    throw invalid();
  }
  if (payload.exp * 1000 <= now) {
    throw new FactaSessionError("session_expired", "The session has expired.");
  }
  return payload as unknown as FactaSession;
}
