// The fail-closed guard (docs/playground.md §4). It runs before anything else on
// every /api/* request: the playground must never be able to reach production.

import type { PlaygroundEnv } from "./env.ts";

/** The only API host the playground may talk to: Facta's staging project. */
export const STAGING_API_HOST = "eobxzotnqzgtpuqvmpkc.supabase.co";

const MIN_KEY_CHARS = 16;
const MIN_SESSION_SECRET_BYTES = 32;

export type GuardCode =
  | "key_missing"
  | "key_not_test"
  | "sign_key_missing"
  | "base_url_missing"
  | "base_url_not_staging"
  | "session_secret_short"
  | "access_not_configured"
  | "bypass_not_local"
  | "fixtures_invalid";

export interface GuardFailure {
  ok: false;
  code: GuardCode;
  /** Shown on the page. Names the problem, never a secret value. */
  message: string;
}

export interface GuardSuccess {
  ok: true;
  /** True when Cloudflare Access is skipped (localhost only). */
  devBypass: boolean;
}

export type GuardResult = GuardSuccess | GuardFailure;

const fail = (code: GuardCode, message: string): GuardFailure => ({ ok: false, code, message });

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/**
 * Decide whether this deployment is allowed to serve the request. Pure: reads
 * the environment and the request host and returns a verdict.
 */
export function checkGuard(env: PlaygroundEnv, requestUrl: string): GuardResult {
  const apiKey = env.FACTA_API_KEY ?? "";
  if (apiKey.length < MIN_KEY_CHARS) {
    return fail("key_missing", "Falta la llave de la API de pruebas. El playground no puede emitir hasta que se configure.");
  }
  if (!apiKey.startsWith("facta_test_")) {
    // `facta_live_` is the case that matters; anything that is not a test key is refused the same way.
    return fail(
      "key_not_test",
      "La llave configurada no es una llave de pruebas (facta_test_). El playground solo funciona en el ambiente de pruebas y se detuvo.",
    );
  }
  if ((env.FACTA_SIGN_KEY ?? "").length < MIN_KEY_CHARS) {
    return fail("sign_key_missing", "Falta la llave de firma (FACTA_SIGN_KEY) del playground.");
  }
  const rawBase = env.FACTA_API_BASE_URL ?? "";
  if (rawBase === "") {
    return fail("base_url_missing", "Falta la dirección del API de pruebas (FACTA_API_BASE_URL).");
  }
  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    return fail("base_url_not_staging", "La dirección del API configurada no es válida. El playground se detuvo.");
  }
  if (base.protocol !== "https:" || base.hostname !== STAGING_API_HOST || base.username !== "" || base.password !== "") {
    return fail("base_url_not_staging", "La dirección del API configurada no es la de pruebas. El playground se detuvo.");
  }
  if (new TextEncoder().encode(env.FACTA_SESSION_SECRET ?? "").length < MIN_SESSION_SECRET_BYTES) {
    return fail("session_secret_short", "El secreto de sesión (FACTA_SESSION_SECRET) falta o tiene menos de 32 bytes.");
  }
  if (env.FACTA_DTE_FIXTURES_JSON !== undefined && env.FACTA_DTE_FIXTURES_JSON !== "") {
    try {
      JSON.parse(env.FACTA_DTE_FIXTURES_JSON);
    } catch {
      return fail("fixtures_invalid", "Los datos de demostración (FACTA_DTE_FIXTURES_JSON) no son un JSON válido.");
    }
  }

  const bypass = env.PLAYGROUND_DEV_BYPASS === "1";
  if (bypass) {
    if (!isLocalHostname(new URL(requestUrl).hostname)) {
      return fail("bypass_not_local", "El acceso de desarrollo está activo fuera de localhost. El playground se detuvo.");
    }
    return { ok: true, devBypass: true };
  }
  if ((env.ACCESS_TEAM_DOMAIN ?? "") === "" || (env.ACCESS_AUD ?? "") === "") {
    return fail("access_not_configured", "Falta configurar Cloudflare Access (ACCESS_TEAM_DOMAIN y ACCESS_AUD).");
  }
  return { ok: true, devBypass: false };
}
