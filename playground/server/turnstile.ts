// Cloudflare Turnstile verification (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
//
// Every action that costs something (an issue session, an e-mail send or resend, a recipe run that
// issues or sends, an invalidation) carries one Turnstile token in the `x-turnstile-token` header.
// Tokens are single-use, so one action is one token. The Worker never trusts the page: it asks
// Cloudflare's siteverify, sending the caller's IP and checking the hostname Cloudflare saw.

import type { PlaygroundEnv } from "./env.ts";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_HEADER = "x-turnstile-token";
const MAX_TOKEN_CHARS = 2048;

/** Turnstile's documented dummy secrets: `1x…` always passes, `2x…` always fails, `3x…` already spent. */
export const TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const TEST_SECRET_FAIL = "2x0000000000000000000000000000000AA";
export const TEST_SITEKEY_PASS = "1x00000000000000000000AA";
export const TEST_SITEKEY_FAIL = "2x00000000000000000000AB";

const isTestSecret = (secret: string) => /^[123]x0{20,}/.test(secret);

export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; code: "turnstile_missing" | "turnstile_failed" | "turnstile_unavailable"; message: string };

/** The caller's IP as Cloudflare saw it. Null when the header is absent (local development, tests). */
export function clientIp(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  return ip !== undefined && ip !== "" && ip.length <= 64 ? ip : null;
}

export async function verifyTurnstile(
  request: Request,
  env: PlaygroundEnv,
  fetcher: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
): Promise<TurnstileVerdict> {
  const token = request.headers.get(TURNSTILE_HEADER)?.trim() ?? "";
  if (token === "" || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, code: "turnstile_missing", message: "Complete la verificación antes de continuar." };
  }
  const secret = env.TURNSTILE_SECRET ?? "";
  const form = new URLSearchParams({ secret, response: token });
  const ip = clientIp(request);
  if (ip !== null) form.set("remoteip", ip);
  let answer: { success?: unknown; hostname?: unknown } | null;
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    answer = response.ok ? ((await response.json().catch(() => null)) as { success?: unknown; hostname?: unknown } | null) : null;
  } catch {
    answer = null;
  }
  if (answer === null) {
    return { ok: false, code: "turnstile_unavailable", message: "No se pudo comprobar la verificación. Intente de nuevo." };
  }
  if (answer.success !== true) {
    return { ok: false, code: "turnstile_failed", message: "La verificación no pasó. Intente de nuevo." };
  }
  // The token must have been solved on this site. Turnstile's dummy keys always answer `example.com`.
  const expected = new URL(request.url).hostname;
  if (!isTestSecret(secret) && typeof answer.hostname === "string" && answer.hostname !== expected) {
    return { ok: false, code: "turnstile_failed", message: "La verificación no corresponde a este sitio." };
  }
  return { ok: true };
}
