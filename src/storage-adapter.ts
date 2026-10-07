import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";

/** Minimal read/write surface needed to mirror an archived artifact. */
export interface ArtifactStore {
  put(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  /** Atomically create an object only when it does not already exist. */
  putIfAbsent?(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options?: { signal?: AbortSignal },
  ): Promise<"created" | "exists">;
  get(path: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
}

export interface StorageArtifactDestinationOptions {
  id: string;
  kind: string;
  label: string;
  store: ArtifactStore;
  /** Must return the same private object key for the same document and kind. */
  pathForArtifact(artifact: ArchiveArtifact): string;
  /** Identify only a definitive object-not-found result; auth/network failures are ambiguous. */
  isNotFound(error: unknown): boolean;
}

/**
 * Adapt a caller-owned storage client's `put/get` methods to the SDK's durable
 * remote-copy contract. Existing bytes are never overwritten unless the
 * caller's store already contains the exact SHA-256. Every new write is read
 * back before the adapter returns `stored`.
 */
export function createStorageArtifactDestination(
  options: StorageArtifactDestinationOptions,
): RemoteArtifactDestination {
  if (!options.id.trim() || !options.kind.trim() || !options.label.trim()) {
    throw new TypeError(
      "Storage artifact destination requires id, kind, and label.",
    );
  }

  function objectPath(artifact: ArchiveArtifact): string {
    const path = options.pathForArtifact(artifact);
    if (
      !path.trim() || path.startsWith("/") || path.includes("\\") ||
      path.includes("\0") ||
      path.split(/[\\/]/).some((part) => part === "." || part === "..")
    ) {
      throw new TypeError(
        "Storage artifact path must be a non-empty relative object key.",
      );
    }
    return path;
  }

  async function check(
    artifact: ArchiveArtifact,
    callOptions?: { signal?: AbortSignal },
  ): Promise<"stored" | "missing" | "unknown"> {
    const actual = await sha256(artifact.bytes);
    if (actual !== artifact.sha256) {
      throw new Error("Local artifact SHA-256 does not match its bytes.");
    }
    const path = objectPath(artifact);
    try {
      const remote = await options.store.get(path, callOptions);
      return await sha256(remote) === artifact.sha256 ? "stored" : "unknown";
    } catch (error) {
      if (callOptions?.signal?.aborted) throw error;
      return options.isNotFound(error) ? "missing" : "unknown";
    }
  }

  return {
    id: options.id,
    kind: options.kind,
    label: options.label,
    check,
    async read(path, callOptions) {
      if (!path.trim() || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
        path.split("/").some((part) => part === "." || part === "..")) {
        throw new TypeError("Storage artifact path must be a non-empty relative object key.");
      }
      try {
        return await options.store.get(path, callOptions);
      } catch (error) {
        if (callOptions?.signal?.aborted) throw error;
        if (options.isNotFound(error)) return null;
        throw error;
      }
    },
    async write(artifact, callOptions) {
      const existing = await check(artifact, callOptions);
      if (existing === "stored") return "stored";
      if (existing === "unknown") return "unknown";
      if (options.store.putIfAbsent) {
        const result = await options.store.putIfAbsent(
          objectPath(artifact),
          artifact.bytes.slice(),
          artifact.contentType,
          callOptions,
        );
        if (result === "exists") {
          return await check(artifact, callOptions) === "stored"
            ? "stored"
            : "unknown";
        }
      } else {
        await options.store.put(
          objectPath(artifact),
          artifact.bytes.slice(),
          artifact.contentType,
          callOptions,
        );
      }
      return await check(artifact, callOptions) === "stored"
        ? "stored"
        : "unknown";
    },
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array(bytes).buffer as ArrayBuffer,
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
