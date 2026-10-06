// An opaque, expiring, tamper-proof blob the browser carries between two stages
// of a recipe (prepare → sign). AES-GCM under a key derived from the session secret,
// so the visitor can neither read nor alter what is inside, and a blob made for one
// visitor is useless to another.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function keyFor(secret: string, label: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`facta-playground/${label}`) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealJson(secret: string, label: string, owner: string, payload: unknown, ttlMs: number, now = Date.now()): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ owner, exp: now + ttlMs, payload }));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret, label), body));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return b64url(out);
}

/** Returns the payload, or null when the blob is forged, expired or someone else's. */
export async function openJson<T>(secret: string, label: string, owner: string, blob: unknown, now = Date.now()): Promise<T | null> {
  if (typeof blob !== "string" || blob.length < 40 || blob.length > 200_000) return null;
  try {
    const bytes = fromB64url(blob);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await keyFor(secret, label), bytes.slice(12));
    const value = JSON.parse(dec.decode(plain)) as { owner?: unknown; exp?: unknown; payload?: unknown };
    if (value.owner !== owner || typeof value.exp !== "number" || value.exp < now) return null;
    return value.payload as T;
  } catch {
    return null;
  }
}
