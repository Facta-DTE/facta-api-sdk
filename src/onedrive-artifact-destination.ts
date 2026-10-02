import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import {
  type ArtifactStore,
  createStorageArtifactDestination,
} from "./storage-adapter.ts";

const GRAPH = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const DRIVE = "https://graph.microsoft.com/v1.0/me/drive";

export interface OneDriveArtifactDestinationOptions {
  id: string;
  label: string;
  /** Token scoped to Files.ReadWrite.AppFolder. */
  accessToken: string;
  /** Optional runtime-owned token refresh; called once after a 401. */
  refreshAccessToken?: () => Promise<string>;
  prefix?: string;
  pathForArtifact?: (artifact: ArchiveArtifact) => string;
  fetch?: typeof fetch;
}

/** Creates a verified, conflict-safe archive destination in OneDrive's app folder. */
export function createOneDriveArtifactDestination(
  options: OneDriveArtifactDestinationOptions,
): RemoteArtifactDestination {
  const store = createOneDriveArtifactStore(options, options.fetch ?? fetch);
  return createStorageArtifactDestination({
    id: options.id,
    kind: "onedrive",
    label: options.label,
    store,
    pathForArtifact: options.pathForArtifact ?? ((artifact) =>
      `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`),
    isNotFound: (error) => error instanceof OneDriveObjectNotFoundError,
  });
}

export class OneDriveObjectNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("The OneDrive object does not exist.");
    this.name = "OneDriveObjectNotFoundError";
  }
}

export class OneDriveArtifactStoreError extends Error {
  constructor(readonly status: number) {
    super(`OneDrive request failed with status ${status}.`);
    this.name = "OneDriveArtifactStoreError";
  }
}

function createOneDriveArtifactStore(
  options: OneDriveArtifactDestinationOptions,
  fetcher: typeof fetch,
): ArtifactStore {
  if (!options.accessToken.trim()) throw new TypeError("OneDrive access token is required.");
  const prefix = normalizePrefix(options.prefix ?? "");
  let accessToken = options.accessToken;

  async function safeFetch(
    input: string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetcher(input, { ...init, ...(signal ? { signal } : {}) });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      // In particular, do not leak the preauthenticated upload URL via a Fetch error.
      throw new OneDriveArtifactStoreError(0);
    }
  }

  function itemUrl(path: string, suffix = ""): string {
    const relative = path ? normalizePath(path) : [];
    return absoluteItemUrl([...prefix, ...relative], suffix);
  }

  function absoluteItemUrl(parts: string[], suffix = ""): string {
    const segments = parts.map(encodeURIComponent);
    if (segments.length === 0) return `${GRAPH}${suffix}`;
    return `${GRAPH}:/${segments.join("/")}:${suffix}`;
  }

  async function graphRequest(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response = await safeFetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${accessToken}` },
    }, signal);
    if (response.status === 401 && options.refreshAccessToken) {
      await response.body?.cancel().catch(() => undefined);
      accessToken = await options.refreshAccessToken();
      response = await safeFetch(url, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${accessToken}` },
      }, signal);
    }
    return response;
  }

  async function ensureFolders(path: string, signal?: AbortSignal): Promise<void> {
    const folders = [...prefix, ...normalizePath(path).slice(0, -1)];
    let parent = GRAPH;
    const createdPath: string[] = [];
    for (const name of folders) {
      const response = await graphRequest(`${parent}/children`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      }, signal);
      if (response.status === 409) {
        await response.body?.cancel().catch(() => undefined);
      } else if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new OneDriveArtifactStoreError(response.status);
      } else {
        const created = await response.json() as { id?: string };
        if (!created.id) throw new OneDriveArtifactStoreError(502);
        parent = `${DRIVE}/items/${encodeURIComponent(created.id)}`;
        createdPath.push(name);
        continue;
      }
      // Resolve an existing folder so the next child is addressed by stable item ID.
      createdPath.push(name);
      const existing = await graphRequest(
        absoluteItemUrl(createdPath),
        { method: "GET" },
        signal,
      );
      if (!existing.ok) {
        await existing.body?.cancel().catch(() => undefined);
        throw new OneDriveArtifactStoreError(existing.status);
      }
      const item = await existing.json() as { id: string };
      parent = `${DRIVE}/items/${encodeURIComponent(item.id)}`;
    }
  }

  return {
    async get(path, requestOptions) {
      const response = await graphRequest(itemUrl(path, "/content"), { method: "GET" }, requestOptions?.signal);
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        throw new OneDriveObjectNotFoundError();
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new OneDriveArtifactStoreError(response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(path, bytes, _contentType, requestOptions) {
      const outcome = await putIfAbsent(path, bytes, requestOptions?.signal);
      if (outcome === "exists") throw new OneDriveArtifactStoreError(409);
    },
    putIfAbsent(path, bytes, _contentType, requestOptions) {
      return putIfAbsent(path, bytes, requestOptions?.signal);
    },
  };

  async function putIfAbsent(
    path: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<"created" | "exists"> {
    await ensureFolders(path, signal);
    const session = await graphRequest(itemUrl(path, "/createUploadSession"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
    }, signal);
    if (session.status === 409) {
      await session.body?.cancel().catch(() => undefined);
      return "exists";
    }
    if (!session.ok) {
      await session.body?.cancel().catch(() => undefined);
      throw new OneDriveArtifactStoreError(session.status);
    }
    const payload = await session.json() as { uploadUrl?: string };
    if (!payload.uploadUrl) throw new OneDriveArtifactStoreError(502);
    const uploadUrl = new URL(payload.uploadUrl);
    if (uploadUrl.protocol !== "https:" || uploadUrl.username || uploadUrl.password || uploadUrl.hash) {
      throw new OneDriveArtifactStoreError(502);
    }
    // Upload URLs are preauthenticated; Microsoft explicitly says not to send the Graph bearer token.
    // 10 MiB is a multiple of Microsoft's 320 KiB alignment and stays below
    // the per-request upload-session limit.
    const chunkSize = 10 * 1024 * 1024;
    for (let start = 0; start < bytes.byteLength; start += chunkSize) {
      const end = Math.min(start + chunkSize, bytes.byteLength) - 1;
      const uploaded = await safeFetch(uploadUrl, {
        method: "PUT",
        headers: { "content-range": `bytes ${start}-${end}/${bytes.byteLength}` },
        body: bytes.slice(start, end + 1) as BodyInit,
      }, signal);
      if (uploaded.status === 409 || uploaded.status === 412) {
        await uploaded.body?.cancel().catch(() => undefined);
        return "exists";
      }
      const finalChunk = end === bytes.byteLength - 1;
      if ((finalChunk && !uploaded.ok) || (!finalChunk && uploaded.status !== 202)) {
        await uploaded.body?.cancel().catch(() => undefined);
        throw new OneDriveArtifactStoreError(uploaded.status);
      }
      await uploaded.body?.cancel().catch(() => undefined);
    }
    return "created";
  }
}

function normalizePrefix(value: string): string[] {
  return value ? normalizePath(value) : [];
}

function normalizePath(value: string): string[] {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new TypeError("OneDrive artifact paths must be safe relative paths.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("OneDrive artifact paths must be safe relative paths.");
  }
  return parts;
}
