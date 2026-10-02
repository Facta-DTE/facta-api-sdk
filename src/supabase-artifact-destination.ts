import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import {
  type ArtifactStore,
  createStorageArtifactDestination,
} from "./storage-adapter.ts";

export interface SupabaseArtifactStoreConfig {
  url: string;
  serviceKey: string;
  bucket: string;
  /** Optional private folder prefix inside the bucket. */
  prefix?: string;
  /** Permit plain HTTP only for an explicitly configured localhost project. */
  allowInsecureLocalhost?: boolean;
}

export interface SupabaseArtifactDestinationOptions {
  id: string;
  label: string;
  config: SupabaseArtifactStoreConfig;
  /** Defaults to api-invoices/{generation-code}/{artifact-kind}. */
  pathForArtifact?: (artifact: ArchiveArtifact) => string;
  fetch?: typeof fetch;
}

/**
 * Create a verified artifact destination for a private Supabase Storage bucket.
 * Uploads use x-upsert:false so a retry cannot replace different bytes.
 */
export function createSupabaseArtifactDestination(
  options: SupabaseArtifactDestinationOptions,
): RemoteArtifactDestination {
  const store = createSupabaseArtifactStore(
    options.config,
    options.fetch ?? fetch,
  );
  return createStorageArtifactDestination({
    id: options.id,
    kind: "supabase",
    label: options.label,
    store,
    pathForArtifact: options.pathForArtifact ??
      ((artifact) =>
        `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`),
    isNotFound: (error) => error instanceof SupabaseObjectNotFoundError,
  });
}

export class SupabaseObjectNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super("The Supabase Storage object does not exist.");
    this.name = "SupabaseObjectNotFoundError";
  }
}

export class SupabaseArtifactStoreError extends Error {
  constructor(readonly status: number, message: string) {
    super(
      `Supabase Storage request failed with status ${status}: ${
        message.slice(0, 240)
      }`,
    );
    this.name = "SupabaseArtifactStoreError";
  }
}

function createSupabaseArtifactStore(
  config: SupabaseArtifactStoreConfig,
  fetcher: typeof fetch,
): ArtifactStore {
  validateConfig(config);
  const base = new URL(config.url);
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/storage/v1`;
  const normalizedPrefix = config.prefix?.replace(/^\/+|\/+$/g, "") ?? "";
  if (
    normalizedPrefix.includes("\\") || normalizedPrefix.includes("\0") ||
    normalizedPrefix.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError(
      "Supabase storage prefix must be a safe relative object prefix.",
    );
  }
  const prefix = normalizedPrefix ? `${normalizedPrefix}/` : "";

  function objectUrl(path: string): string {
    const segments = `${prefix}${path}`.split("/").map(encodePathSegment);
    const bucket = encodePathSegment(config.bucket);
    return `${base.origin}${base.pathname}/object/${bucket}/${
      segments.join("/")
    }`;
  }

  async function request(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", config.serviceKey);
    headers.set("authorization", `Bearer ${config.serviceKey}`);
    let response: Response;
    try {
      response = await fetcher(objectUrl(path), {
        ...init,
        headers,
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new SupabaseArtifactStoreError(0, "Network request failed.");
    }
    return response;
  }

  async function putIfAbsent(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options?: { signal?: AbortSignal },
  ): Promise<"created" | "exists"> {
    const response = await request(path, {
      method: "POST",
      headers: { "content-type": contentType, "x-upsert": "false" },
      body: bytes.slice() as BodyInit,
    }, options?.signal);
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return "created";
    }
    if (response.status === 409 || await isDuplicateResponse(response)) {
      await response.body?.cancel().catch(() => undefined);
      return "exists";
    }
    throw await responseError(response);
  }

  return {
    async get(path, options) {
      const response = await request(path, { method: "GET" }, options?.signal);
      if (await isMissingObjectResponse(response)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SupabaseObjectNotFoundError();
      }
      if (!response.ok) throw await responseError(response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(path, bytes, contentType, options) {
      const outcome = await putIfAbsent(path, bytes, contentType, options);
      if (outcome === "exists") {
        throw new SupabaseArtifactStoreError(409, "Object already exists.");
      }
    },
    putIfAbsent,
  };
}

async function isMissingObjectResponse(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    return payload["statusCode"] === "404" &&
      (payload["error"] === "not_found" || payload["code"] === "NoSuchKey");
  } catch {
    return false;
  }
}

async function isDuplicateResponse(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const body = await response.clone().text().catch(() => "");
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const description = [payload["code"], payload["error"], payload["message"]]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    return /already exists|asset already exists|resourcealreadyexists|keyalreadyexists/i
      .test(description);
  } catch {
    return false;
  }
}

async function responseError(
  response: Response,
): Promise<SupabaseArtifactStoreError> {
  await response.body?.cancel().catch(() => undefined);
  return new SupabaseArtifactStoreError(
    response.status,
    "Provider rejected the request.",
  );
}

function validateConfig(config: SupabaseArtifactStoreConfig): void {
  const url = new URL(config.url);
  const isLocalhost = url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    !config.bucket.trim() || config.bucket.includes("/") ||
    !config.serviceKey.trim() || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    (url.protocol !== "https:" &&
      !(config.allowInsecureLocalhost && isLocalhost &&
        url.protocol === "http:"))
  ) {
    throw new TypeError(
      "Supabase Storage requires a project root URL, bucket, service key, and HTTPS (localhost HTTP is opt-in).",
    );
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
