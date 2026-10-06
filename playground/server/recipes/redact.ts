// Everything a recipe sends to the browser goes through here first.
//
// Defence in depth: the recipes are fixed files that never touch the
// Worker's secrets, but a response can still carry something that must not
// reach a visitor: a credential, a delivery token, a bucket or an object path.
// Redaction removes it by KEY (what it is called), by VALUE (a secret the Worker
// knows) and by SHAPE (a credential or a storage path in free text).

const SECRET_KEYS = new Set([
  "apikey", "signkey", "unlockkey", "x-facta-key", "x-facta-sign-key", "authorization", "secret", "sessionsecret",
  "password", "preparetoken", "token", "continuation",
  // Storage layout: where the bytes live is not the visitor's business.
  "bucket", "bucketname", "path", "objectkey", "storagekey", "storagepath", "endpoint", "region",
]);

/** Large or already-attached members: shown as files or omitted, not inlined. */
const BULKY_KEYS = new Set(["jws", "archivojson", "representaciongrafica", "documento"]);

const SHAPES: Array<[RegExp, string]> = [
  [/facta_(?:test|live)_[A-Za-z0-9_.-]+/g, "[llave omitida]"],
  [/factask_[A-Za-z0-9_-]+/g, "[llave omitida]"],
  [/factauk_[A-Za-z0-9_-]+/g, "[llave omitida]"],
  [/https?:\/\/[^\s"'<>]*\/storage\/v1\/[^\s"'<>]*/g, "[ruta omitida]"],
  [/\b(?:DTE|dte)\/\d{4}\/\d{2}\/[^\s"'<>]*/g, "[ruta omitida]"],
  // An e-mail address is shown masked («c•••@ejemplo.com»), never whole.
  [/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, "$1•••@$2"],
];

export interface RedactOptions {
  /** Exact secret values the Worker holds; any string containing one is scrubbed. */
  secrets?: readonly (string | undefined)[];
  /** Bulky keys to keep (e.g. `documento` when the page shows the canonical document). */
  keep?: readonly string[];
  /** Longest string kept whole. */
  maxString?: number;
}

export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const secrets = (options.secrets ?? []).filter((s): s is string => typeof s === "string" && s.length >= 8);
  const keep = new Set((options.keep ?? []).map((k) => k.toLowerCase()));
  const maxString = options.maxString ?? 600;

  const scrub = (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join("[secreto omitido]");
    for (const [pattern, replacement] of SHAPES) out = out.replace(pattern, replacement);
    return out;
  };

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 12) return "[demasiado profundo]";
    if (node === null || typeof node === "number" || typeof node === "boolean") return node;
    if (typeof node === "string") {
      const clean = scrub(node);
      return clean.length > maxString ? `[texto de ${clean.length} caracteres]` : clean;
    }
    if (node instanceof Uint8Array) return `[archivo de ${node.byteLength} bytes]`;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (SECRET_KEYS.has(lower)) continue;
        if (BULKY_KEYS.has(lower) && !keep.has(lower)) {
          out[key] = typeof child === "string" ? `[omitido: ${child.length} caracteres]` : "[omitido]";
          continue;
        }
        // A kept document keeps its long strings (the legal text) but still loses credentials and paths.
        out[key] = BULKY_KEYS.has(lower) ? redact(child, { ...options, keep: [], maxString: 100_000 }) : walk(child, depth + 1);
      }
      return out;
    }
    return String(node);
  };

  return walk(value, 0);
}

/** Same scrub for a plain message (an error text). */
export function redactText(text: string, options: RedactOptions = {}): string {
  const result = redact(text, { ...options, maxString: 100_000 });
  return typeof result === "string" ? result : "";
}
