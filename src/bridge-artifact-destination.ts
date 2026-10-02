import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import {
  type ArtifactStore,
  createStorageArtifactDestination,
} from "./storage-adapter.ts";

export interface LocalBridgeArtifactConfig {
  /** The port from this device's bridge pairing; it is not stored in the vault. */
  port: number;
  /** One-time key issued by facta-bridge and stored encrypted in the vault. */
  apiKey: string;
  /** Optional vault metadata retained for caller-side destination matching. */
  sessionId?: string;
  keyId?: string;
}

export interface BridgeArtifactDestinationOptions {
  id: string;
  label: string;
  config: LocalBridgeArtifactConfig;
  /** Defaults to `api-invoices/{generation}/{kind}` before the content digest. */
  pathForArtifact?: (artifact: ArchiveArtifact) => string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Create an FTP/SFTP artifact destination through the user's local Facta
 * bridge. The final remote path includes the SHA-256 so two different byte
 * sequences never target the same path on protocols without conditional PUT.
 */
export function createBridgeArtifactDestination(
  options: BridgeArtifactDestinationOptions,
): RemoteArtifactDestination {
  validateConfig(options.config);
  const fetcher = options.fetch ?? fetch;
  const origin = `http://127.0.0.1:${options.config.port}`;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError("Facta bridge timeout must be an integer between 1 and 300000 ms.");
  }

  async function request(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(`${origin}/v1/storage`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal,
        cache: "no-store",
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      if (timeout.aborted) throw new BridgeArtifactStoreError(0, "timeout");
      throw new BridgeArtifactStoreError(0, "unreachable");
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      // Bridge 403/421 and reverse-proxy errors can be text; do not expose them.
    }
    const rawCode = typeof payload.code === "string" ? payload.code : "";
    const code = /^[a-z0-9_-]{1,64}$/i.test(rawCode) ? rawCode : "unknown";
    if (!response.ok || payload.error !== undefined) {
      throw new BridgeArtifactStoreError(response.status, code);
    }
    return payload;
  }

  const store: ArtifactStore = {
    async get(path, callOptions) {
      const payload = await request({ op: "get", path }, callOptions?.signal);
      if (typeof payload.data !== "string") {
        throw new BridgeArtifactStoreError(502, "invalid_response");
      }
      return fromBase64(payload.data);
    },
    async put(path, bytes, _contentType, callOptions) {
      await request({ op: "put", path, body: toBase64(bytes) }, callOptions?.signal);
    },
  };

  return createStorageArtifactDestination({
    id: options.id,
    kind: "bridge",
    label: options.label,
    store,
    pathForArtifact: (artifact) => {
      const base = options.pathForArtifact?.(artifact) ??
        `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`;
      const filename = safeFilename(artifact.filename, artifact.kind);
      return `${base.replace(/\/+$/, "")}/sha256-${artifact.sha256}/${filename}`;
    },
    isNotFound: (error) => error instanceof BridgeArtifactStoreError &&
      (error.code === "not_found" || error.status === 404),
  });
}

export class BridgeArtifactStoreError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Facta bridge request failed (${code}, HTTP ${status}).`);
    this.name = "BridgeArtifactStoreError";
  }
}

function validateConfig(config: LocalBridgeArtifactConfig): void {
  if (
    !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
    !config.apiKey.trim()
  ) {
    throw new TypeError("Facta bridge requires a valid local port and API key.");
  }
}

function safeFilename(filename: string | null, kind: string): string {
  const chosen = filename?.split(/[\\/]/).at(-1)?.trim() || kind;
  if (!chosen || chosen === "." || chosen === ".." || chosen.includes("\0")) {
    throw new TypeError("Bridge artifact filename must be a safe path segment.");
  }
  return chosen;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new BridgeArtifactStoreError(502, "invalid_response");
  }
}
