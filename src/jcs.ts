// RFC 8785 (JSON Canonicalization Scheme) for the request fingerprint.
//
// Dependency-free on purpose: the same algorithm is re-implemented in every
// Facta SDK and checked against conformance/fingerprint-v1.vectors.json.
// Strings and numbers are serialized by JSON.stringify, which is exactly what
// RFC 8785 requires (ECMAScript number formatting, minimal string escaping,
// non-ASCII kept as UTF-8). Object keys are sorted by UTF-16 code units, the
// default JavaScript string order.

/** RFC 8785 serialization of a JSON-compatible value. */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: ${path} is not a finite number.`);
      }
      return JSON.stringify(value); // -0 becomes "0", as RFC 8785 requires
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((item, index) => serialize(item === undefined ? null : item, `${path}[${index}]`)).join(",") + "]";
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return "{" + keys.map((key) => JSON.stringify(key) + ":" + serialize(record[key], `${path}.${key}`)).join(",") + "}";
    }
    default:
      throw new TypeError(`canonicalJson: ${path} has an unsupported type (${typeof value}).`);
  }
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text`. */
export async function sha256HexOfText(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * fingerprint-v1: the SHA-256 of the RFC 8785 form of the caller's request
 * before any catalog resolution. See conformance/fingerprint-v1.md.
 */
export async function fingerprintV1(request: unknown): Promise<string> {
  return await sha256HexOfText(canonicalJson(request));
}

/**
 * Digest of a vault or catalog envelope as the API publishes it: SHA-256 of
 * `JSON.stringify([envelope])` for an object whose keys are, in this order,
 * `id, kind, iv, ciphertext, formatVersion, revision`.
 */
export async function envelopeDigest(envelope: object): Promise<string> {
  return await sha256HexOfText(JSON.stringify([envelope]));
}
