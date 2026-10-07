// Who is calling. Two modes (PLAYGROUND_AUTH):
//   turnstile (default) anonymous visitors told apart by a signed, HttpOnly cookie holding a random id.
//   access              Cloudflare Access: the verified e-mail is the identity (access.ts, unchanged).
//
// `Visitor.id` is the key for everything per visitor: ownership (issued-codes), Registro and the quotas.

import { visitorFrom, type JwksSource } from "./access.ts";
import type { PlaygroundEnv } from "./env.ts";
import { authModeOf, isLocalHostname } from "./guard.ts";

export interface Visitor {
  /** Stable per-visitor key: the cookie's random id, or the Access e-mail. */
  id: string;
  /** Present only in Access mode. */
  email: string | null;
  /** Short name for the page («V-3FA9C2» or the e-mail). */
  label: string;
  via: "cookie" | "access" | "dev-bypass";
}

export const VISITOR_COOKIE = "facta_pg_visitor";
export const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const REISSUE_AFTER_SECONDS = 15 * 24 * 60 * 60;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const encoder = new TextEncoder();

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function mac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`facta-playground-visitor-v1.${text}`))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newVisitorId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** `id.issuedAtSeconds.mac` */
export async function signVisitorCookie(secret: string, id: string, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return `${id}.${iat}.${await mac(secret, `${id}.${iat}`)}`;
}

export async function readVisitorCookie(secret: string, value: string | null, nowMs: number): Promise<{ id: string; ageSeconds: number } | null> {
  if (value === null) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, iatText, given] = parts as [string, string, string];
  if (!ID_PATTERN.test(id) || !/^\d{1,12}$/.test(iatText)) return null;
  if (!safeEqual(given, await mac(secret, `${id}.${iatText}`))) return null;
  const age = Math.floor(nowMs / 1000) - Number(iatText);
  if (age < -60 || age > COOKIE_MAX_AGE_SECONDS) return null;
  return { id, ageSeconds: Math.max(0, age) };
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === VISITOR_COOKIE) return part.slice(at + 1).trim();
  }
  return null;
}

export function setCookieHeader(request: Request, value: string): string {
  const secure = isLocalHostname(new URL(request.url).hostname) ? "" : "; Secure";
  return `${VISITOR_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export const visitorLabel = (id: string) => `V-${id.slice(0, 6).toUpperCase()}`;

export async function resolveVisitor(
  request: Request,
  env: PlaygroundEnv,
  keys?: JwksSource,
  nowMs: number = Date.now(),
): Promise<Visitor | null> {
  if (authModeOf(env) === "access") {
    const found = await visitorFrom(request, env, keys, nowMs);
    return found === null ? null : { id: found.email, email: found.email, label: found.email, via: found.via };
  }
  const read = await readVisitorCookie(env.FACTA_SESSION_SECRET ?? "", cookieValue(request), nowMs);
  return read === null ? null : { id: read.id, email: null, label: visitorLabel(read.id), via: "cookie" };
}

/**
 * For `GET /api/state`: the visitor, plus a `Set-Cookie` value when the cookie is missing, invalid
 * or old enough to refresh (the id is kept so quotas and documents stay with the visitor).
 */
export async function ensureVisitor(
  request: Request,
  env: PlaygroundEnv,
  keys: JwksSource | undefined,
  nowMs: number,
): Promise<{ visitor: Visitor | null; setCookie?: string }> {
  if (authModeOf(env) === "access") return { visitor: await resolveVisitor(request, env, keys, nowMs) };
  const secret = env.FACTA_SESSION_SECRET ?? "";
  const read = await readVisitorCookie(secret, cookieValue(request), nowMs);
  if (read !== null && read.ageSeconds < REISSUE_AFTER_SECONDS) return { visitor: { id: read.id, email: null, label: visitorLabel(read.id), via: "cookie" } };
  const id = read?.id ?? newVisitorId();
  return {
    visitor: { id, email: null, label: visitorLabel(id), via: "cookie" },
    setCookie: setCookieHeader(request, await signVisitorCookie(secret, id, nowMs)),
  };
}
