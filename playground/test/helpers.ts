import type { AccessJwk } from "../server/access.ts";
import type { PlaygroundEnv } from "../server/env.ts";
import { QuotaCounter } from "../server/quota.ts";

export const TEAM = "facta-test.cloudflareaccess.com";
export const AUD = "aud-tag-for-tests";

/** A complete, valid staging environment with the dev bypass off. Test values only. */
export function goodEnv(extra: Partial<PlaygroundEnv> = {}): PlaygroundEnv {
  return {
    FACTA_API_KEY: "facta_test_unit.unit-test-secret",
    FACTA_SIGN_KEY: "factask_unit-test-secret-0000",
    FACTA_API_BASE_URL: "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1",
    FACTA_SESSION_SECRET: "s".repeat(40),
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...extra,
  };
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const jsonB64 = (value: unknown) => b64url(enc.encode(JSON.stringify(value)));

export interface TestKeys {
  jwk: AccessJwk;
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  /** A second, unrelated key pair signing under the same kid. */
  forge(claims: Record<string, unknown>): Promise<string>;
}

export async function makeKeys(kid = "kid-1"): Promise<TestKeys> {
  const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" } as AccessJwk;
  const signWith = async (key: CryptoKey, claims: Record<string, unknown>, header: Record<string, unknown>) => {
    const signingInput = `${jsonB64({ alg: "RS256", kid, typ: "JWT", ...header })}.${jsonB64(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput)));
    return `${signingInput}.${b64url(signature)}`;
  };
  return {
    jwk,
    sign: (claims, header = {}) => signWith(pair.privateKey, claims, header),
    forge: (claims) => signWith(other.privateKey, claims, {}),
  };
}

export function accessClaims(now: number, extra: Record<string, unknown> = {}) {
  return { iss: `https://${TEAM}`, aud: [AUD], email: "Visitor@Example.com", iat: now, exp: now + 3600, ...extra };
}

/** A fake Durable Object namespace backed by the real QuotaCounter class and a Map. */
export function fakeQuotaNamespace(now: () => number = Date.now) {
  const storages = new Map<string, Map<string, unknown>>();
  const counters = new Map<string, QuotaCounter>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const name = String(id);
      if (!counters.has(name)) {
        const data = new Map<string, unknown>();
        storages.set(name, data);
        counters.set(name, new QuotaCounter({
          storage: {
            get: async <T>(key: string) => data.get(key) as T | undefined,
            put: async <T>(key: string, value: T) => void data.set(key, value),
          },
        }, undefined, now));
      }
      return { fetch: (request: Request) => counters.get(name)!.fetch(request) };
    },
  };
}
