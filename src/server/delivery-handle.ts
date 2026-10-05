// The delivery handle: what the browser holds instead of the Facta delivery token
// (docs/api-delivery-tokens.md §5).
//
// `body.mac`, both base64url. The body is JSON `{ v, n, cg, exp, te?, t? }`:
//   n   the session nonce, so a handle only works inside the session that made it;
//   cg  the generation code it answers for;
//   exp when the handle stops being accepted (status reads outlive the 5-minute token);
//   te  when the Facta token expires (epoch seconds), so the server never retries with a dead one;
//   t   the Facta delivery token, AES-256-GCM encrypted (iv ‖ ciphertext) under a key derived from
//       the session secret, with `n:cg` as additional data.
//
// The MAC makes the handle tamper-evident; the encryption keeps the token from being usable
// (or even readable) in the browser. Web Crypto only, like session.ts.

import { base64urlDecode, base64urlEncode, hmac, secretBytes, timingSafeEqual } from "./session.ts";

const HANDLE_DOMAIN = "facta-delivery-v1.";
const KEY_LABEL = "facta-delivery-enc-key-v1";
const DEFAULT_TTL_SECONDS = 3600;
const encoder = new TextEncoder();

export interface DeliveryHandleContents {
  codigoGeneracion: string;
  /** The Facta delivery token; absent for a contingency document. */
  token?: string;
  /** Epoch seconds at which `token` expires. */
  tokenExp?: number;
}

async function encryptionKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const raw = await hmac(secret, KEY_LABEL);
  return await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function aad(nonce: string, cg: string): BufferSource {
  return encoder.encode(`${nonce}:${cg.toUpperCase()}`) as BufferSource;
}

export async function sealDeliveryHandle(
  secret: string | Uint8Array,
  nonce: string,
  contents: DeliveryHandleContents,
  options: { now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  secretBytes(secret);
  const exp = Math.floor((options.now ?? Date.now()) / 1000) + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload: Record<string, unknown> = { v: 1, n: nonce, cg: contents.codigoGeneracion, exp };
  if (contents.token !== undefined) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(nonce, contents.codigoGeneracion) },
        await encryptionKey(secret),
        encoder.encode(contents.token) as BufferSource,
      ),
    );
    const blob = new Uint8Array(iv.length + sealed.length);
    blob.set(iv);
    blob.set(sealed, iv.length);
    payload.t = base64urlEncode(blob);
    if (contents.tokenExp !== undefined) payload.te = contents.tokenExp;
  }
  const body = base64urlEncode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64urlEncode(await hmac(secret, HANDLE_DOMAIN + body))}`;
}

/**
 * Verify and open a handle. Returns `null` for anything wrong (bad shape, bad MAC, expired,
 * another session's nonce, tampered ciphertext): the caller answers one generic 403.
 */
export async function openDeliveryHandle(
  secret: string | Uint8Array,
  handle: unknown,
  nonce: string,
  now: number = Date.now(),
): Promise<DeliveryHandleContents | null> {
  secretBytes(secret);
  if (typeof handle !== "string" || handle.length > 8192) return null;
  const parts = handle.split(".");
  if (parts.length !== 2) return null;
  const [body, macText] = parts;
  const given = base64urlDecode(macText);
  if (given === null || !timingSafeEqual(given, await hmac(secret, HANDLE_DOMAIN + body))) return null;
  const raw = base64urlDecode(body);
  if (raw === null) return null;
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    payload.v !== 1 || typeof payload.n !== "string" || typeof payload.cg !== "string" ||
    typeof payload.exp !== "number" || payload.n !== nonce || payload.exp * 1000 <= now
  ) return null;
  const out: DeliveryHandleContents = { codigoGeneracion: payload.cg };
  if (typeof payload.t === "string") {
    const blob = base64urlDecode(payload.t);
    if (blob === null || blob.length < 13) return null;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: blob.slice(0, 12) as BufferSource, additionalData: aad(nonce, payload.cg) },
        await encryptionKey(secret),
        blob.slice(12) as BufferSource,
      );
      out.token = new TextDecoder().decode(plain);
    } catch {
      return null;
    }
    if (typeof payload.te === "number") out.tokenExp = payload.te;
  }
  return out;
}
