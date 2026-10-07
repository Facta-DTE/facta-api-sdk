import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import {
  type ArtifactStore,
  createStorageArtifactDestination,
} from "./storage-adapter.ts";
import { DEFAULT_CLOCK_URL } from "./clock-config.ts";
import { createReferenceClock } from "./reference-clock.ts";

/** The part of a reference clock the S3 signer needs. */
export interface S3ClockSource {
  now(): Date;
  ensure?(options?: { maxUncertaintyMs?: number }): Promise<unknown>;
  calibrate?(): Promise<unknown>;
}

export interface S3ArtifactStoreConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** S3-compatible endpoint. Omit for the AWS regional endpoint. */
  endpoint?: string;
  /** Defaults to path style for custom endpoints and virtual-host style for AWS. */
  pathStyle?: boolean;
  /** Optional private prefix inside the bucket. */
  prefix?: string;
  /** Permit plain HTTP only for a local development endpoint such as MinIO. */
  allowInsecureEndpoint?: boolean;
}

export interface S3ArtifactDestinationOptions {
  id: string;
  label: string;
  config: S3ArtifactStoreConfig;
  /** Defaults to api-invoices/{generation-code}/{artifact-kind}. */
  pathForArtifact?: (artifact: ArchiveArtifact) => string;
  fetch?: typeof fetch;
  /**
   * Time source for the SigV4 date. S3 refuses a request signed more than 15
   * minutes away from its own clock (`RequestTimeTooSkewed`), so a device with
   * a wrong clock cannot write. Default: this destination keeps its own
   * lazily calibrated reference clock (`https://clock.factadte.com/`); pass
   * `facta.clock` to share the client's one, a URL to use another endpoint, or
   * `false` to sign with the device clock. A calibration never fails a request: the
   * first one waits for it (about 6 s when the clock service is unreachable) and
   * then the device clock is used, as before.
   */
  clock?: S3ClockSource | string | false;
  /** Fetch used only for clock calibration. Defaults to `fetch`. */
  clockFetch?: typeof fetch;
}

/**
 * Create a verified archive destination for AWS S3 and S3-compatible stores.
 * Uses SigV4 and conditional PUT (`If-None-Match: *`) so a concurrent replay
 * cannot overwrite an existing object with different bytes.
 */
export function createS3ArtifactDestination(
  options: S3ArtifactDestinationOptions,
): RemoteArtifactDestination {
  const fetcher = options.fetch ?? fetch;
  const clockOption = options.clock;
  const clock: S3ClockSource | null = clockOption === false
    ? null
    : typeof clockOption === "object"
    ? clockOption
    : createReferenceClock({
      url: typeof clockOption === "string" ? clockOption : DEFAULT_CLOCK_URL,
      fetch: options.clockFetch ?? fetcher,
      wallNow: () => Date.now(),
      monoNow: () => performance.now(),
    });
  const store = createS3ArtifactStore(options.config, fetcher, clock);
  return createStorageArtifactDestination({
    id: options.id,
    kind: "s3",
    label: options.label,
    store,
    pathForArtifact: options.pathForArtifact ??
      ((artifact) =>
        `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`),
    isNotFound: (error) => error instanceof S3ObjectNotFoundError,
  });
}

async function isTimeSkew(response: Response): Promise<boolean> {
  try {
    return (await response.clone().text()).includes("RequestTimeTooSkewed");
  } catch {
    return false;
  }
}

export class S3ObjectNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super("The S3 object does not exist.");
    this.name = "S3ObjectNotFoundError";
  }
}

export class S3ArtifactStoreError extends Error {
  constructor(readonly status: number, message: string) {
    super(`S3 request failed with status ${status}: ${message.slice(0, 240)}`);
    this.name = "S3ArtifactStoreError";
  }
}

function createS3ArtifactStore(
  config: S3ArtifactStoreConfig,
  fetcher: typeof fetch,
  clock: S3ClockSource | null = null,
): ArtifactStore {
  validateConfig(config);
  const endpoint = new URL(
    config.endpoint ?? `https://s3.${config.region}.amazonaws.com`,
  );
  if (config.bucket.includes("/") || config.bucket.includes("\\")) {
    throw new TypeError("S3 bucket must be a single bucket name.");
  }
  const pathStyle = config.pathStyle ?? config.endpoint !== undefined;
  const prefix = config.prefix
    ? `${config.prefix.replace(/^\/+|\/+$/g, "")}/`
    : "";

  function locate(key: string): { url: string; path: string; host: string } {
    const fullKey = prefix + key;
    const encodedKey = encodeS3Path(fullKey);
    if (pathStyle) {
      const path = `/${encodeS3Path(config.bucket)}/${encodedKey}`;
      return { url: `${endpoint.origin}${path}`, path, host: endpoint.host };
    }
    const virtualHost = `${config.bucket}.${endpoint.host}`;
    const url = new URL(endpoint.toString());
    url.host = virtualHost;
    const path = `/${encodedKey}`;
    return { url: `${url.origin}${path}`, path, host: virtualHost };
  }

  async function request(
    method: "GET" | "PUT",
    key: string,
    body: Uint8Array<ArrayBufferLike> = new Uint8Array(),
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const target = locate(key);
    // Lazy: the first request that needs the time calibrates; afterwards the
    // clock answers from memory. Never throws, never blocks beyond its timeouts.
    await clock?.ensure?.();
    const send = async (): Promise<Response> => {
      const headers = await signS3Request({
        method,
        path: target.path,
        host: target.host,
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        body,
        ...(contentType ? { contentType } : {}),
        ...(method === "PUT" ? { ifNoneMatch: "*" } : {}),
        ...(clock ? { now: clock.now() } : {}),
      });
      return await fetcher(target.url, {
        method,
        headers,
        ...(method === "PUT" ? { body: body.slice() as BodyInit } : {}),
        ...(signal ? { signal } : {}),
      });
    };
    let response = await send();
    if (response.status === 403 && clock?.calibrate && await isTimeSkew(response)) {
      // The signing time was refused: recalibrate once and retry once.
      await clock.calibrate();
      response = await send();
    }
    return response;
  }

  async function putIfAbsent(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options?: { signal?: AbortSignal },
  ): Promise<"created" | "exists"> {
    const response = await request(
      "PUT",
      path,
      bytes,
      contentType,
      options?.signal,
    );
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return "created";
    }
    if (response.status === 409 || response.status === 412) {
      await response.body?.cancel().catch(() => undefined);
      return "exists";
    }
    throw await responseError(response);
  }

  return {
    async get(path, options) {
      const response = await request(
        "GET",
        path,
        undefined,
        undefined,
        options?.signal,
      );
      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        throw new S3ObjectNotFoundError();
      }
      if (!response.ok) throw await responseError(response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(path, bytes, contentType, options) {
      const outcome = await putIfAbsent(path, bytes, contentType, options);
      if (outcome === "exists") {
        throw new S3ArtifactStoreError(412, "Object already exists.");
      }
    },
    async putIfAbsent(path, bytes, contentType, options) {
      return await putIfAbsent(path, bytes, contentType, options);
    },
  };
}

async function responseError(
  response: Response,
): Promise<S3ArtifactStoreError> {
  await response.body?.cancel().catch(() => undefined);
  return new S3ArtifactStoreError(response.status, "Provider rejected the request.");
}

function validateConfig(config: S3ArtifactStoreConfig): void {
  if (
    !config.bucket.trim() || !config.region.trim() ||
    !config.accessKeyId.trim() ||
    !config.secretAccessKey.trim()
  ) {
    throw new TypeError(
      "S3 artifact storage requires bucket, region, and credentials.",
    );
  }
  const endpoint = new URL(
    config.endpoint ?? `https://s3.${config.region}.amazonaws.com`,
  );
  if (
    endpoint.username || endpoint.password || endpoint.pathname !== "/" ||
    endpoint.search || endpoint.hash ||
    (endpoint.protocol !== "https:" && !(
      config.allowInsecureEndpoint === true && endpoint.protocol === "http:" &&
      (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" ||
        endpoint.hostname === "[::1]")
    ))
  ) {
    throw new TypeError(
      "S3 endpoint must use HTTPS (HTTP is limited to explicit localhost development). ",
    );
  }
}

function encodeS3Path(value: string): string {
  return value.split("/").map((part) =>
    encodeURIComponent(part).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
  ).join("/");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer as ArrayBuffer,
  );
  return hex(new Uint8Array(digest));
}

async function hmac(
  key: Uint8Array<ArrayBufferLike>,
  message: string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.slice().buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

export async function signS3Request(input: {
  method: "GET" | "PUT";
  path: string;
  host: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: Uint8Array;
  contentType?: string;
  ifNoneMatch?: string;
  extraHeaders?: Record<string, string>;
  now?: Date;
}): Promise<Record<string, string>> {
  const encoder = new TextEncoder();
  const dateStamp = (input.now ?? new Date()).toISOString().replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = dateStamp.slice(0, 8);
  const payloadHash = await sha256(input.body);
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateStamp,
    ...(input.contentType ? { "content-type": input.contentType } : {}),
    ...(input.ifNoneMatch ? { "if-none-match": input.ifNoneMatch } : {}),
    ...(input.extraHeaders ?? {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) =>
    `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`
  ).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const requestHash = hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)),
    ),
  );
  const stringToSign =
    `AWS4-HMAC-SHA256\n${dateStamp}\n${scope}\n${requestHash}`;
  let signingKey: Uint8Array<ArrayBufferLike> = encoder.encode(
    `AWS4${input.secretAccessKey}`,
  );
  for (const part of [day, input.region, "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, part);
  }
  const signature = hex(await hmac(signingKey, stringToSign));
  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
