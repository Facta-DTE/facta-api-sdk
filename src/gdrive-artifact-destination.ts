import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import {
  type ArtifactStore,
  createStorageArtifactDestination,
} from "./storage-adapter.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ARTIFACT_PROPERTY = "factaArtifactPath";

export interface GoogleDriveArtifactStoreConfig {
  accessToken: string;
  /** Facta's user-created folder under the narrow `drive.file` OAuth scope. */
  folderId: string;
  prefix?: string;
}

export interface GoogleDriveArtifactDestinationOptions {
  id: string;
  label: string;
  config: GoogleDriveArtifactStoreConfig;
  /** Google browser tokens expire; refresh or reauthorize in the owning runtime. */
  refreshAccessToken?: () => Promise<string>;
  pathForArtifact?: (artifact: ArchiveArtifact) => string;
  fetch?: typeof fetch;
}

/** Create a verified archive destination in the caller's Facta Drive folder. */
export function createGoogleDriveArtifactDestination(
  options: GoogleDriveArtifactDestinationOptions,
): RemoteArtifactDestination {
  const store = createGoogleDriveArtifactStore(options, options.fetch ?? fetch);
  return createStorageArtifactDestination({
    id: options.id,
    kind: "gdrive",
    label: options.label,
    store,
    pathForArtifact: options.pathForArtifact ?? ((artifact) =>
      `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`),
    isNotFound: (error) => error instanceof GoogleDriveObjectNotFoundError,
  });
}

export class GoogleDriveObjectNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("The Google Drive object does not exist.");
    this.name = "GoogleDriveObjectNotFoundError";
  }
}

export class GoogleDriveArtifactStoreError extends Error {
  constructor(readonly status: number) {
    super(`Google Drive request failed with status ${status}.`);
    this.name = "GoogleDriveArtifactStoreError";
  }
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
}

function createGoogleDriveArtifactStore(
  options: GoogleDriveArtifactDestinationOptions,
  fetcher: typeof fetch,
): ArtifactStore {
  if (!options.config.accessToken.trim() || !options.config.folderId.trim()) {
    throw new TypeError("Google Drive access token and Facta folder ID are required.");
  }
  const rootFolderId = options.config.folderId;
  const prefix = options.config.prefix ? safePath(options.config.prefix) : [];
  let accessToken = options.config.accessToken;
  const folderCache = new Map<string, Promise<string>>();
  const artifactWrites = new Map<string, Promise<"created" | "exists">>();

  async function safeFetch(
    input: string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetcher(input, { ...init, ...(signal ? { signal } : {}) });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new GoogleDriveArtifactStoreError(0);
    }
  }

  async function call(
    url: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    retried = false,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    const response = await safeFetch(url, { ...init, headers }, signal);
    if (response.status === 401 && !retried && options.refreshAccessToken) {
      await response.body?.cancel().catch(() => undefined);
      accessToken = await options.refreshAccessToken();
      return await call(url, init, signal, true);
    }
    return response;
  }

  async function listFiles(query: string, signal?: AbortSignal): Promise<DriveFile[]> {
    const found: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${DRIVE}/files`);
      url.searchParams.set("q", query);
      url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,appProperties)");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await call(url.toString(), {}, signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new GoogleDriveArtifactStoreError(response.status);
      }
      const payload = await response.json() as {
        files?: DriveFile[];
        nextPageToken?: string;
        incompleteSearch?: boolean;
      };
      if (payload.incompleteSearch) throw new GoogleDriveArtifactStoreError(503);
      found.push(...payload.files ?? []);
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return found;
  }

  async function folderId(path: string, signal?: AbortSignal): Promise<string> {
    const cacheKey = path;
    const cached = folderCache.get(cacheKey);
    if (cached) return await cached;
    const creating = (async () => {
      let parent = rootFolderId;
      const segments = [...prefix, ...(path ? safePath(path) : [])];
      for (const segment of segments) {
        const existing = await listFiles(
          `name = '${escapeQuery(segment)}' and '${escapeQuery(parent)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
          signal,
        );
        if (existing[0]?.id) {
          parent = existing[0].id;
          continue;
        }
        const response = await call(`${DRIVE}/files?fields=id`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: segment, mimeType: FOLDER_MIME, parents: [parent] }),
        }, signal);
        if (response.status === 409) {
          await response.body?.cancel().catch(() => undefined);
          const raced = await listFiles(
            `name = '${escapeQuery(segment)}' and '${escapeQuery(parent)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
            signal,
          );
          if (!raced[0]?.id) throw new GoogleDriveArtifactStoreError(409);
          parent = raced[0].id;
        } else if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new GoogleDriveArtifactStoreError(response.status);
        } else {
          const created = await response.json() as { id?: string };
          if (!created.id) throw new GoogleDriveArtifactStoreError(502);
          parent = created.id;
        }
      }
      return parent;
    })();
    folderCache.set(cacheKey, creating);
    try {
      return await creating;
    } catch (error) {
      folderCache.delete(cacheKey);
      throw error;
    }
  }

  async function artifactKey(path: string): Promise<string> {
    const input = new TextEncoder().encode(`${rootFolderId}\0${[...prefix, ...safePath(path)].join("/")}`);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function findArtifacts(path: string, signal?: AbortSignal): Promise<DriveFile[]> {
    const key = await artifactKey(path);
    return await listFiles(
      `appProperties has { key='${ARTIFACT_PROPERTY}' and value='${key}' } and trashed = false`,
      signal,
    );
  }

  async function content(id: string, signal?: AbortSignal): Promise<Uint8Array> {
    const url = new URL(`${DRIVE}/files/${encodeURIComponent(id)}`);
    url.searchParams.set("alt", "media");
    const response = await call(url.toString(), {}, signal);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new GoogleDriveObjectNotFoundError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GoogleDriveArtifactStoreError(response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  return {
    async get(path, requestOptions) {
      const files = await findArtifacts(path, requestOptions?.signal);
      if (!files.length) throw new GoogleDriveObjectNotFoundError();
      const candidates = await Promise.all(files.map((file) => content(file.id, requestOptions?.signal)));
      const first = candidates[0];
      if (candidates.some((candidate) => !sameBytes(first, candidate))) {
        throw new GoogleDriveArtifactStoreError(409);
      }
      return first;
    },
    async put(path, bytes, contentType, requestOptions) {
      const outcome = await putIfAbsent(path, bytes, contentType, requestOptions);
      if (outcome === "exists") throw new GoogleDriveArtifactStoreError(409);
    },
    putIfAbsent,
  };

  async function putIfAbsent(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<"created" | "exists"> {
    const key = await artifactKey(path);
    const ongoing = artifactWrites.get(key);
    if (ongoing) {
      await ongoing;
      return "exists";
    }
    const write = createArtifact(path, bytes, contentType, key, requestOptions);
    artifactWrites.set(key, write);
    try {
      return await write;
    } finally {
      if (artifactWrites.get(key) === write) artifactWrites.delete(key);
    }
  }

  async function createArtifact(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    key: string,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<"created" | "exists"> {
    const existing = await findArtifacts(path, requestOptions?.signal);
    if (existing.length) return "exists";
    const parts = safePath(path);
    const name = parts.pop()!;
    const parent = await folderId(parts.join("/"), requestOptions?.signal);
    const boundary = `facta${crypto.randomUUID().replace(/-/g, "")}`;
    const metadata = JSON.stringify({
      name,
      parents: [parent],
      appProperties: { [ARTIFACT_PROPERTY]: key },
    });
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const payload = new Uint8Array(head.length + bytes.length + tail.length);
    payload.set(head);
    payload.set(bytes, head.length);
    payload.set(tail, head.length + bytes.length);
    const response = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: payload as BodyInit,
    }, requestOptions?.signal);
    if (response.status === 409) {
      await response.body?.cancel().catch(() => undefined);
      return "exists";
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GoogleDriveArtifactStoreError(response.status);
    }
    await response.body?.cancel().catch(() => undefined);
    return "created";
  }
}

function safePath(value: string): string[] {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new TypeError("Google Drive artifact paths must be safe relative paths.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("Google Drive artifact paths must be safe relative paths.");
  }
  return parts;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
