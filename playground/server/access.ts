// Cloudflare Access verification: RS256 JWT in `Cf-Access-Jwt-Assertion`.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
// Web Crypto only; the key set is fetched from the team's certs endpoint and cached.

import type { PlaygroundEnv } from "./env.ts";
import { isLocalHostname } from "./guard.ts";

export interface AccessJwk extends JsonWebKey {
  kid?: string;
}

export interface AccessConfig {
  /** `team.cloudflareaccess.com`, with or without `https://`. */
  teamDomain: string;
  /** The Application Audience (AUD) tag. */
  aud: string;
}

export type AccessFailure = "missing" | "malformed" | "unknown_key" | "bad_signature" | "bad_claims" | "expired" | "keys_unavailable";

export class AccessError extends Error {
  override readonly name = "AccessError";
  constructor(readonly code: AccessFailure) {
    super(code);
  }
}

export interface Visitor {
  /** Lower-cased e-mail from the verified token (or the dev bypass). */
  email: string;
  via: "access" | "dev-bypass";
}

const decoder = new TextDecoder();
const CLOCK_SKEW_SECONDS = 30;
const JWKS_TTL_MS = 10 * 60 * 1000;

export function normalizeTeamDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

function b64urlToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new AccessError("malformed");
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AccessError("malformed");
}

export type JwksSource = (teamDomain: string) => Promise<AccessJwk[]>;

let cachedKeys: { team: string; at: number; keys: AccessJwk[] } | null = null;

/** Default key source: the team's certs endpoint, cached for ten minutes. */
export const fetchAccessKeys: JwksSource = async (teamDomain) => {
  const now = Date.now();
  if (cachedKeys !== null && cachedKeys.team === teamDomain && now - cachedKeys.at < JWKS_TTL_MS) return cachedKeys.keys;
  let response: Response;
  try {
    response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch {
    throw new AccessError("keys_unavailable");
  }
  if (!response.ok) throw new AccessError("keys_unavailable");
  const body = (await response.json().catch(() => null)) as { keys?: AccessJwk[] } | null;
  if (!body || !Array.isArray(body.keys)) throw new AccessError("keys_unavailable");
  cachedKeys = { team: teamDomain, at: now, keys: body.keys };
  return body.keys;
};

/** Verify the token and return its claims. Throws `AccessError`. */
export async function verifyAccessJwt(
  token: string | null | undefined,
  config: AccessConfig,
  keys: JwksSource = fetchAccessKeys,
  nowMs: number = Date.now(),
): Promise<Record<string, unknown>> {
  if (!token) throw new AccessError("missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessError("malformed");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = parseJson(b64urlToBytes(parts[0]));
    claims = parseJson(b64urlToBytes(parts[1]));
    signature = b64urlToBytes(parts[2]);
  } catch (error) {
    throw error instanceof AccessError ? error : new AccessError("malformed");
  }
  // Only RS256 is accepted: never `none`, never a symmetric algorithm.
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AccessError("malformed");

  const team = normalizeTeamDomain(config.teamDomain);
  const jwk = (await keys(team)).find((key) => key.kid === header.kid);
  if (!jwk) throw new AccessError("unknown_key");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    throw new AccessError("unknown_key");
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as BufferSource, signed);
  if (!valid) throw new AccessError("bad_signature");

  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= now) throw new AccessError("expired");
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > now) throw new AccessError("bad_claims");
  if (claims.iss !== `https://${team}`) throw new AccessError("bad_claims");
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : [];
  if (!audiences.includes(config.aud)) throw new AccessError("bad_claims");
  return claims;
}

/**
 * Who is calling. Returns `null` when nobody verified is. The dev bypass only
 * ever applies on a localhost host, on top of the guard's own refusal.
 */
export async function visitorFrom(
  request: Request,
  env: PlaygroundEnv,
  keys: JwksSource = fetchAccessKeys,
  nowMs: number = Date.now(),
): Promise<Visitor | null> {
  if (env.PLAYGROUND_DEV_BYPASS === "1" && isLocalHostname(new URL(request.url).hostname)) {
    const email = (env.PLAYGROUND_DEV_EMAIL ?? "dev@localhost.test").trim().toLowerCase();
    return { email, via: "dev-bypass" };
  }
  try {
    const claims = await verifyAccessJwt(
      request.headers.get("cf-access-jwt-assertion"),
      { teamDomain: env.ACCESS_TEAM_DOMAIN ?? "", aud: env.ACCESS_AUD ?? "" },
      keys,
      nowMs,
    );
    const email = claims.email;
    if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(email)) return null;
    return { email: email.toLowerCase(), via: "access" };
  } catch {
    return null;
  }
}
