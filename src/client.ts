// The Facta client. Node 22+, Deno, Bun and the browser — `fetch` and
// `crypto.randomUUID` are the only two globals it touches, and both are
// standard everywhere.
//
// TWO RULES THIS FILE OBEYS, and a test enforces (`test/architecture.test.ts`):
//
//   1. NO FISCAL LOGIC. Not one VAT rate, rounding rule, control-number format
//      or catalog. The server computes; this transports.
//   2. NO SIGNING. What signs a document never passes through here. Decision of
//      Marvin, 2-sep: «para los SDK no necesitas firmar, solo manejar los
//      vaults; las firmas es en el server».
//
//      What DOES pass through, on the two routes that sign, is
//      `X-Facta-Sign-Key`: the password that opens the signing vault ON THE
//      SERVER. The SDK forwards it and does nothing with it — no derivation, no
//      storage, no logging. That is the whole point of the two-vault design:
//      the API key alone authenticates and cannot sign, so a leaked token is a
//      scare rather than the power to emit fiscal documents in your name.
//
//      `FACTA_UNLOCK_KEY` (prefix `factauk_`) is the OTHER password and it must
//      never reach this class: it opens the storage credentials, locally, and
//      the day it travels to Facta the promise «tu almacenamiento no lo abrimos
//      nosotros» stops being true. The constructor refuses it by prefix.
//
// What it DOES add over a bare `fetch`, and why each thing earns its lines:
//
//   · An `Idempotency-Key` per operation, generated when the caller does not
//     supply one, and REUSED across retries. Retrying with a fresh key is the
//     bug this header exists to prevent, so the SDK must never generate a
//     second one for the same call.
//   · Retries only where a retry is safe: `409 idempotency_in_flight` (the
//     first attempt is still working) and 502/503 (nobody judged anything).
//     Never on 4xx and never on a rejection.
//   · Typed errors, so `catch (e) { if (e.isRejection) … }` is the whole
//     error-handling story.

import { FactaError, type FactaErrorCode } from "./errors.ts";
import { validateFactaConfig } from "./config-validation.ts";
import { resolveCatalogRefs } from "./catalog.ts";
import { submitPrintJob, type PrintResult, type PrintTransport } from "./printing.ts";
import { diagnoseStatus, type DiagnoseOptions, type DiagnosticsReport } from "./diagnostics.ts";
import type {
  ArchiveArtifact,
  ArchiveEmissionOptions,
  ArchiveEmissionResult,
  ArchiveOperation,
  ArchiveOperationIdentity,
  InvalidationArchive,
  InvalidationArchiveResult,
  InvalidationOperation,
  InvoiceArchive,
  PendingArchiveOperation,
  RemoteArtifactDestination,
  RemoteCopyRecord,
  RemoteDestinationProbeReport,
  RemoteReplicationReport,
} from "./archive.ts";
import { deliveryRequestFor, GENERATION_CODE, isFinalDeliveryState } from "./delivery.ts";
import type {
  CatalogCustomer,
  CatalogProduct,
  CatalogReadOptions,
  CatalogSearchOptions,
  CatalogSnapshot,
  CatalogState,
  DeliverOptions,
  DeliveryChannel,
  DeliveryChannelResult,
  DeliveryRequest,
  DeliveryStatus,
  DocumentStatus,
  PreparedDte,
  InvalidationResult,
  DtePage,
  DownloadedDocument,
  HoldingPage,
  ListDocumentsFilters,
  IssueResult,
  ManagedDocumentCopy,
  ManagedStorageReceipt,
  ManagedStorageStatus,
  InvalidationRequest,
  DteRequest,
  Status,
  WaitedDelivery,
  WaitForDeliveryOptions,
} from "./types.ts";

export interface FactaOptions {
  /** `facta_test_<id>.<secreto>` (or `facta_live_…`). Read it from your secret
   * manager, not from a file in the repository. */
  apiKey: string;
  /**
   * `factask_…` — the password that opens your signing vault, on Facta's
   * server, for the length of one signature. Required to emit; not needed to
   * query. Keep it in your deployment's secret manager and NOT in the same
   * `.env` as `apiKey`: storing both together throws away half the defence.
   */
  signKey?: string;
  /** `factauk_…` opens the downloaded destination vault locally; this value is never sent. */
  unlockKey?: string;
  /** Defaults to the public production function; a facta_test_ key still uses MH test mode. */
  baseUrl?: string;
  /** Whole-request deadline, milliseconds. The MH can take ~40 s to answer. */
  timeoutMs?: number;
  /** How many times to retry the two retryable conditions. */
  maxRetries?: number;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
  /** Versioned non-secret client behavior. Credentials remain separate above. */
  config?: FactaConfigV1;
  /** Runtime adapters and stores; keep separate from serializable scalar config and credentials. */
  runtime?: FactaRuntimeConfigV1;
}

/** Serializable behavioral defaults; never include credentials or runtime adapters here. */
export interface FactaConfigV1 {
  version: 1;
  /** Assert that this client is connected to the intended API key environment. */
  expectedEnvironment?: "00" | "01";
  /** Scopes the application expects this API key to have; checked by diagnose(). */
  requiredScopes?: readonly string[];
  /** Permit stale catalog reads by default for non-fiscal lookups only. */
  allowStaleCatalogReads?: boolean;
  /** Default ticket width in millimeters; 40–120, defaults to 80. */
  ticketPaperWidthMm?: number;
  /** Whole-request deadline, including reading the response body. */
  timeoutMs?: number;
  /** Retry count for explicitly retryable conditions. */
  maxRetries?: number;
  /** API base URL. */
  baseUrl?: string;
}

/** Runtime-only defaults for capabilities implemented by the integrator. */
export interface FactaRuntimeConfigV1 {
  version: 1;
  archive?: InvoiceArchive;
  invalidationArchive?: InvalidationArchive;
  remoteDestinations?: readonly RemoteArtifactDestination[];
  printTransport?: PrintTransport;
}

/** Per-operation fields remain explicit; configured runtime adapters are fallbacks. */
export type FactaArchiveEmissionOptions = Omit<ArchiveEmissionOptions, "archive"> & {
  archive?: InvoiceArchive;
  /** Mark delivery channels. Part of the journaled request, so a recovery replays it. */
  deliver?: DeliverOptions;
};

export interface FactaInvalidationArchiveOptions {
  archive?: InvalidationArchive;
  /** Stable application command ID, reused when resuming. */
  operationId: string;
  /** Stable API idempotency key, reused after process restarts. */
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface CallOptions {
  /**
   * Supply your own when your system already has an id for this sale (an order
   * number, a POS ticket). That is strictly better than a random one: it makes
   * the operation idempotent across process restarts, not just across retries.
   */
  idempotencyKey?: string;
  /** Abort this operation; retries are stopped with the same signal. */
  signal?: AbortSignal;
}

/** `CallOptions` of the calls that can mark delivery channels. */
export interface IssueOptions extends CallOptions {
  /**
   * Mark e-mail and/or WhatsApp delivery. Issuing never waits for it: the
   * result carries `entrega.token`, and `deliverEmail` / `deliverWhatsApp`
   * start each channel within five minutes.
   */
  deliver?: DeliverOptions;
}

export interface DownloadOptions {
  /** Require the managed copy without temporary holding fallback (JSON/PDF only). */
  source?: "managed";
  signal?: AbortSignal;
  /** Ticket roll width in millimeters. The renderer supports integer widths from 40 through 120; default 80. */
  paperWidthMm?: number;
}

export interface DestinationSnapshot {
  version: number;
  destinos: Array<{ id: string; kind: string; label: string; secret: string }>;
}

const DEFAULT_BASE_URL = "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1";
const RETRYABLE: ReadonlySet<FactaErrorCode> = new Set([
  "idempotency_in_flight",
  "mh_unreachable",
  "service_unavailable",
  "correlative_unavailable",
  "storage_unavailable",
  "network_error",
]);

function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Older Node without randomUUID. Random enough for a key whose only job is
  // to be unique within one caller's 24-hour window.
  return `facta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function digestEnvelope(envelope: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([envelope]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStorageSource(value: string | null): value is "managed" | "holding" | "archive" {
  return value === "managed" || value === "holding" || value === "archive";
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/i;
const validBytes = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validTimestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function isManagedStorageReceipt(value: unknown): value is ManagedStorageReceipt {
  if (!isRecord(value) || (value.destination !== "managed" && value.destination !== "none") ||
    (value.environment !== "00" && value.environment !== "01") || typeof value.operationId !== "string" || !uuidPattern.test(value.operationId)) return false;
  const validArtifact = (artifact: unknown) => {
    if (!isRecord(artifact) || !["stored", "pending", "failed", "not_configured", "unsupported"].includes(String(artifact.state)) ||
      !(artifact.sha256 === null || typeof artifact.sha256 === "string" && digestPattern.test(artifact.sha256)) ||
      !(artifact.bytes === null || validBytes(artifact.bytes)) || !(artifact.storedAt === null || validTimestamp(artifact.storedAt)) ||
      !(artifact.errorCode === null || typeof artifact.errorCode === "string" && /^[a-z][a-z0-9_]*$/.test(artifact.errorCode)) || typeof artifact.retryable !== "boolean") return false;
    if (value.destination === "none" && artifact.state === "stored") return false;
    return artifact.state !== "stored" || (typeof artifact.sha256 === "string" && validBytes(artifact.bytes) && validTimestamp(artifact.storedAt) && artifact.errorCode === null && !artifact.retryable);
  };
  return validArtifact(value.json) && validArtifact(value.pdf);
}

function isManagedStorageStatus(value: unknown): value is ManagedStorageStatus {
  if (!isRecord(value) || value.capabilityVersion !== 1 || !isRecord(value.managed) || !isRecord(value.byos)) return false;
  const managed = value.managed;
  const nullableBytes = (field: unknown) => field === null || validBytes(field);
  const nullableString = (field: unknown) => field === null || typeof field === "string";
  return typeof managed.configured === "boolean" && typeof managed.ready === "boolean" &&
    typeof managed.state === "string" && (managed.integration === "ready" || managed.integration === "unavailable") &&
    (!managed.ready || managed.configured && managed.integration === "ready" && managed.state === "ready" && managed.bucketState === "ready" &&
      validBytes(managed.quotaBytes) && validBytes(managed.usedBytesTotal) && validBytes(managed.reservedBytesTotal) &&
      (managed.usedBytesTotal as number) + (managed.reservedBytesTotal as number) < (managed.quotaBytes as number) &&
      (managed.coveredUntil === null || validTimestamp(managed.coveredUntil) && Date.parse(managed.coveredUntil as string) > Date.now())) &&
    [managed.quotaBytes, managed.usedBytes, managed.reservedBytes, managed.usedBytesTotal, managed.reservedBytesTotal].every(nullableBytes) &&
    [managed.coveredUntil, managed.accessUntil].every((field) => field === null || validTimestamp(field)) &&
    [managed.bucketState, managed.backupState].every(nullableString) && typeof value.byos.ready === "boolean" &&
    Array.isArray(value.supportedKinds) && value.supportedKinds.length === 2 && new Set(value.supportedKinds).size === 2 &&
    value.supportedKinds.every((kind) => kind === "json" || kind === "pdf") && Array.isArray(value.unsupportedKinds) &&
    value.unsupportedKinds.every((kind) => kind === "ticket" || kind === "invalidation");
}

function isManagedDocumentCopies(value: unknown): value is { capabilityVersion: 1; copies: ManagedDocumentCopy[] } {
  return isRecord(value) && value.capabilityVersion === 1 && Array.isArray(value.copies) &&
    new Set(value.copies.map((copy) => isRecord(copy) ? `${String(copy.generationCode).toUpperCase()}:${String(copy.kind)}` : "invalid")).size === value.copies.length && value.copies.every((copy) =>
    isRecord(copy) && typeof copy.generationCode === "string" && uuidPattern.test(copy.generationCode) && (copy.kind === "json" || copy.kind === "pdf") &&
    (copy.environment === "00" || copy.environment === "01") && ["stored", "pending", "failed"].includes(String(copy.state)) &&
    validBytes(copy.bytes) && typeof copy.sha256 === "string" && digestPattern.test(copy.sha256) && typeof copy.issuedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(copy.issuedDate) && Number.isFinite(Date.parse(copy.issuedDate)) && new Date(copy.issuedDate).toISOString().slice(0, 10) === copy.issuedDate &&
    (copy.storedAt === null || validTimestamp(copy.storedAt)) && (copy.state !== "stored" || validTimestamp(copy.storedAt))
  );
}

const cancelled = () => new DOMException("Operation cancelled.", "AbortError");
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  throwIfAborted(signal);
  const timer = setTimeout(done, ms);
  function done() {
    signal?.removeEventListener("abort", abort);
    resolve();
  }
  function abort() {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    reject(cancelled());
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
});

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Operation cancelled.", "AbortError");
  }
}

/** The routes that open the signing vault, and therefore the only ones that
 * carry the second password. `prepare` is deliberately not one of them: it
 * reserves a correlative and builds a document, and neither needs a signature. */
const SIGNING_PATHS: ReadonlySet<string> = new Set(["/v1/dte", "/v1/dte/sign"]);
const SENSITIVE_ERROR_FIELD = /(?:authorization|api[-_]?key|sign[-_]?key|unlock[-_]?key|password|passphrase|secret|token|credential|private[-_]?key|ciphertext|refresh[-_]?token|service[-_]?key)/i;

function redactErrorValue(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > 8) return "[omitted]";
  if (typeof value === "string") {
    return secrets.reduce(
      (safe, secret) => secret.length > 0 ? safe.replaceAll(secret, "[REDACTED]") : safe,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redactErrorValue(item, secrets, depth + 1));
  if (typeof value === "object" && value !== null) {
    const safe: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!SENSITIVE_ERROR_FIELD.test(key)) safe[key] = redactErrorValue(item, secrets, depth + 1);
    }
    return safe;
  }
  return value;
}

function withDelivery(request: DteRequest, deliver: DeliverOptions | undefined): DteRequest {
  return deliver === undefined ? request : ({ ...request, entrega: deliveryRequestFor(deliver) } as unknown as DteRequest);
}

const SIGN_KEY_PREFIX = "factask_";
const UNLOCK_KEY_PREFIX = "factauk_";

function normalizeCatalogQuery(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function catalogSearchLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('catalog search limit must be an integer from 1 to 500');
  }
  return limit;
}

/** How long the key's advertised catalog mode is trusted before status is asked again. */
const CATALOG_MODE_TTL_MS = 60_000;

export class Facta {
  readonly #apiKey: string;
  readonly #signKey: string | null;
  readonly #unlockKey: string | null;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #config: FactaConfigV1;
  readonly #runtime: FactaRuntimeConfigV1;
  readonly #secrets: readonly string[];
  #catalogCache: { revision: number; snapshot: CatalogSnapshot; fetchedAt: string } | null = null;
  #catalogModeCache: { readable: boolean; at: number } | null = null;

  constructor(options: FactaOptions) {
    const config = options.config;
    if (config !== undefined) validateFactaConfig(config);
    if (
      options.baseUrl !== undefined || options.timeoutMs !== undefined ||
      options.maxRetries !== undefined
    ) {
      validateFactaConfig({
        version: 1,
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      });
    }
    this.#config = config ?? { version: 1 };
    if (options.runtime !== undefined && options.runtime.version !== 1) {
      throw new TypeError("Facta runtime config version must be 1.");
    }
    this.#runtime = options.runtime ?? { version: 1 };
    if (typeof options.apiKey !== "string" || options.apiKey === "") {
      throw new FactaError("unauthorized", "API key is required.", 0);
    }
    if (options.signKey !== undefined && options.signKey.startsWith(UNLOCK_KEY_PREFIX)) {
      // Refused here rather than at the server, because by then it would
      // already have travelled. This is the one mistake in the whole SDK that
      // cannot be undone by fixing the code afterwards.
      throw new FactaError(
        "unauthorized",
        "This is your FACTA_UNLOCK_KEY (factauk_), which opens your local storage and is never sent. " +
          "Use FACTA_SIGN_KEY (factask_) for signing.",
        0,
      );
    }
    this.#apiKey = options.apiKey;
    this.#signKey = options.signKey ?? null;
    if (options.unlockKey !== undefined && !options.unlockKey.startsWith(UNLOCK_KEY_PREFIX)) {
      throw new FactaError('unauthorized', 'FACTA_UNLOCK_KEY must start with factauk_.', 0);
    }
    this.#unlockKey = options.unlockKey ?? null;
    this.#secrets = [this.#apiKey, this.#signKey ?? "", this.#unlockKey ?? ""];
    this.#baseUrl = (options.baseUrl ?? config?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? config?.timeoutMs ?? 60_000;
    this.#maxRetries = options.maxRetries ?? config?.maxRetries ?? 3;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * True when `runtime.archive` is configured, so `issueAndArchive` needs no
   * per-call archive. Lets a wrapper (the signing window's handler) decide
   * between `issue` and `issueAndArchive` without reaching into runtime config.
   */
  get archiveConfigured(): boolean { return this.#runtime.archive !== undefined; }
  /** Whether `invalidateAndArchive` can run without passing an archive. */
  get invalidationArchiveConfigured(): boolean { return this.#runtime.invalidationArchive !== undefined; }

  /**
   * The environment the API key selects: `facta_test_` is "00", `facta_live_`
   * is "01", anything else null. Read-only and derived from the prefix; the key
   * itself is never exposed.
   */
  get environment(): "00" | "01" | null {
    if (this.#apiKey.startsWith("facta_test_")) return "00";
    if (this.#apiKey.startsWith("facta_live_")) return "01";
    return null;
  }

  /** Health, environment and the ceilings left on this key. */
  status(options: CallOptions = {}): Promise<Status> {
    return this.#request<Status>("GET", "/v1/status", undefined, options);
  }

  /** Actionable readiness checks; this reads status but never opens a vault or reserves a correlative. */
  async diagnose(options: DiagnoseOptions = {}): Promise<DiagnosticsReport> {
    let status: Status;
    try {
      status = await this.status();
    } catch (cause) {
      const code = cause instanceof FactaError ? cause.code : "network_error";
      return {
        overall: "blocked",
        canIssue: false,
        canQuery: false,
        canDownload: false,
        canIssueAndArchive: false,
        pendingArchiveOperations: null,
        revisions: null,
        checks: [{
          id: "api",
          state: "blocked",
          message: "No se pudo consultar el estado de la API (" + code + ").",
        }],
      };
    }
    const expectedEnvironment = options.expectedEnvironment ?? this.#config.expectedEnvironment;
    const requiredScopes = options.requiredScopes ?? this.#config.requiredScopes;
    let storageCapability: ManagedStorageStatus | null = null;
    let storageFailure: unknown;
    try { storageCapability = await this.getStorageStatus(); } catch (cause) { storageFailure = cause; }
    const report = await diagnoseStatus(status, {
      ...options,
      ...((options.archive ?? this.#runtime.archive) === undefined ? {} : { archive: options.archive ?? this.#runtime.archive }),
      ...(expectedEnvironment === undefined ? {} : { expectedEnvironment }),
      ...(requiredScopes === undefined ? {} : { requiredScopes }),
    }, storageCapability?.managed.ready === true);
    let storageReady: boolean | null = null;
    try {
      if (!storageCapability) throw storageFailure;
      const storage = storageCapability;
      storageReady = storage.managed.ready || storage.byos.ready;
      report.checks.push({
        id: "managed-storage",
        state: storageReady ? "ok" : "blocked",
        message: storageReady
          ? storage.managed.ready ? "Facta-managed storage is ready." : "A verified BYOS destination is ready."
          : "Neither Facta-managed storage nor a verified BYOS destination is ready.",
      });
      if (!storageReady) {
        report.canIssue = false;
        report.canIssueAndArchive = false;
        report.overall = "blocked";
      }
    } catch (cause) {
      const capabilityMissing = cause instanceof FactaError && (
        cause.code === "storage_unsupported" || cause.code === "not_found" || cause.code === "forbidden_scope"
      );
      report.checks.push({
        id: "managed-storage",
        state: "unknown",
        message: capabilityMissing
          ? "This API key or server does not expose managed-storage readiness; the server still controls whether issuance can proceed."
          : "Could not confirm managed-storage readiness.",
      });
      if (!capabilityMissing) {
        report.canIssue = false; report.canIssueAndArchive = false; report.overall = "blocked";
        report.checks[report.checks.length - 1].state = "blocked";
      } else if (report.overall === "ready") report.overall = "attention";
    }
    report.storageReady = storageReady;
    return report;
  }

  #environment(): "00" | "01" { return this.#apiKey.startsWith("facta_test_") ? "00" : "01"; }

  /** Check managed-storage coverage, capacity, environment and BYOS readiness. */
  async getStorageStatus(options: CallOptions = {}): Promise<ManagedStorageStatus> {
    let value: unknown;
    try {
      value = await this.#request<unknown>("GET", "/v1/storage/status", undefined, options);
    } catch (cause) {
      if (cause instanceof FactaError && (cause.status === 404 || cause.status === 501)) {
        throw new FactaError("storage_unsupported", "This API server does not expose managed-storage status.", cause.status);
      }
      throw cause;
    }
    if (!isManagedStorageStatus(value)) {
      throw new FactaError("storage_contract_invalid", "API returned an invalid storage capability response.", 502);
    }
    return value;
  }

  /** List stored, pending, or failed managed JSON/PDF copies for this key's issuer and environment. */
  async getDocumentCopies(options: { generationCode?: string; signal?: AbortSignal } = {}): Promise<ManagedDocumentCopy[]> {
    const query = options.generationCode ? `?generationCode=${encodeURIComponent(options.generationCode)}` : "";
    let value: unknown;
    try {
      value = await this.#request<unknown>("GET", `/v1/storage/copies${query}`, undefined, options);
    } catch (cause) {
      if (cause instanceof FactaError && (cause.status === 404 || cause.status === 501)) {
        throw new FactaError("storage_unsupported", "This API server does not expose managed document-copy status.", cause.status);
      }
      throw cause;
    }
    if (!isManagedDocumentCopies(value) || value.copies.some((copy) => copy.environment !== this.#environment() ||
      options.generationCode !== undefined && copy.generationCode.toUpperCase() !== options.generationCode.toUpperCase())) {
      throw new FactaError("storage_contract_invalid", "API returned an invalid managed document-copy response.", 502);
    }
    return value.copies;
  }

  /** Repair only managed copies for an already sealed DTE; this method never submits a DTE. */
  async retryDocumentStorage(generationCode: string, options: CallOptions = {}): Promise<ManagedStorageReceipt> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationCode)) {
      throw new TypeError("generationCode must be a UUID.");
    }
    let value: unknown;
    try {
      value = await this.#request<unknown>("POST", `/v1/storage/copies/${encodeURIComponent(generationCode)}/repair`, undefined, options);
    } catch (cause) {
      if (cause instanceof FactaError && (cause.status === 404 || cause.status === 501)) {
        throw new FactaError("storage_unsupported", "This API server does not expose managed document-copy repair.", cause.status);
      }
      throw cause;
    }
    const receipt = isRecord(value) ? value.storage : undefined;
    if (!isManagedStorageReceipt(receipt) || receipt.environment !== this.#environment() || receipt.operationId.toLowerCase() !== generationCode.toLowerCase()) {
      throw new FactaError("storage_contract_invalid", "API returned an invalid managed-storage repair receipt.", 502);
    }
    return receipt;
  }

  /** Download and open the destination snapshot in this process only. */
  async syncDestinations(): Promise<DestinationSnapshot> {
    if (this.#unlockKey === null) {
      throw new FactaError('unauthorized', 'Configure FACTA_UNLOCK_KEY to open the destination vault locally.', 0);
    }
    const bundle = await this.#request<Record<string, unknown>>('GET', '/v1/vault/destinations');
    const status = bundle['syncStatus'];
    if (status !== 'ready' && status !== 'legacy') {
      throw new FactaError('no_storage_destination', 'Destination vault must be synced from the Facta app.', 422, {
        syncStatus: status,
        desiredRevision: bundle['desiredRevision'],
        publishedRevision: bundle['publishedRevision'],
      });
    }
    const vault = bundle['vault'] as Record<string, unknown> | null;
    const wrapped = vault?.['wrapPass'] as { iv?: string; ciphertext?: string } | undefined;
    const secret = vault?.['secret'] as Record<string, unknown> | null | undefined;
    const vaultId = vault?.['id'];
    const salt = vault?.['passSalt'];
    const companyId = bundle['companyId'];
    if (typeof vaultId !== 'string' || typeof salt !== 'string' || typeof companyId !== 'string' || !wrapped?.iv || !wrapped.ciphertext || !secret) {
      throw new FactaError('service_unavailable', 'Response does not contain a complete destination vault.', 503);
    }
    if (secret['formatVersion'] === 2 && bundle['syncStatus'] === 'ready') {
      const envelope = {
        id: secret['id'],
        kind: 'storage_destinations',
        iv: secret['iv'],
        ciphertext: secret['ciphertext'],
        formatVersion: secret['formatVersion'],
        revision: secret['revision'],
      };
      if (await digestEnvelope(envelope) !== bundle['envelopeDigest']) {
        throw new FactaError('service_unavailable', 'Destination vault digest does not match; snapshot was not opened.', 503);
      }
    }
    const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const dekBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: new TextEncoder().encode(`api-vault:${vaultId}:pass`) },
      await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: fromBase64(salt), info: new TextEncoder().encode('facta-api-vault-destinations') },
        await crypto.subtle.importKey('raw', new TextEncoder().encode(this.#unlockKey), 'HKDF', false, ['deriveKey']),
        { name: 'AES-GCM', length: 256 }, false, ['decrypt']),
      fromBase64(wrapped.ciphertext),
    );
    try {
      const dek = await crypto.subtle.importKey('raw', dekBytes, 'AES-GCM', false, ['decrypt']);
      const rowId = secret['id'];
      const version = secret['formatVersion'];
      const revision = secret['revision'];
      const aad = version === 2
        ? `api-secret:v2:${companyId}:${this.#keyId()}:destinations:storage_destinations:${String(rowId)}:${String(revision)}`
        : String(rowId);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(String(secret['iv'])), additionalData: new TextEncoder().encode(aad) },
        dek,
        fromBase64(String(secret['ciphertext'])),
      );
      const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as DestinationSnapshot;
      if (snapshot === null || snapshot.version !== 1 || !Array.isArray(snapshot.destinos)) {
        throw new FactaError('service_unavailable', 'Destination snapshot has an unrecognized format.', 503);
      }
      return snapshot;
    } finally {
      new Uint8Array(dekBytes).fill(0);
    }
  }

  /** Download and locally decrypt the latest customer/product snapshot. */
  async syncCatalog(): Promise<CatalogSnapshot> {
    if (this.#unlockKey === null) {
      throw new FactaError('unauthorized', 'Configure FACTA_UNLOCK_KEY to open the encrypted catalog locally.', 0);
    }
    const bundle = await this.#request<Record<string, unknown>>('GET', '/v1/vault/destinations');
    const vault = bundle['vault'] as Record<string, unknown> | null;
    const catalog = vault?.['catalog'] as Record<string, unknown> | null;
    if (catalog === null || catalog === undefined || catalog['syncStatus'] !== 'ready') {
      throw new FactaError('no_storage_destination', 'This key’s catalog must be synced from the Facta app.', 422, {
        syncStatus: catalog?.['syncStatus'] ?? 'missing',
        desiredRevision: catalog?.['desiredRevision'],
        publishedRevision: catalog?.['publishedRevision'],
      });
    }
    const catalogEnvelope = {
      id: catalog['id'],
      kind: 'catalog_snapshot',
      iv: catalog['iv'],
      ciphertext: catalog['ciphertext'],
      formatVersion: catalog['formatVersion'],
      revision: catalog['revision'],
    };
    if (await digestEnvelope(catalogEnvelope) !== catalog['envelopeDigest']) {
      throw new FactaError('service_unavailable', 'Catalog digest does not match; snapshot was not opened.', 503);
    }
    const wrapped = vault?.['wrapPass'] as { iv?: string; ciphertext?: string } | undefined;
    const vaultId = vault?.['id'];
    const salt = vault?.['passSalt'];
    const companyId = bundle['companyId'];
    if (typeof vaultId !== 'string' || typeof salt !== 'string' || typeof companyId !== 'string' || !wrapped?.iv || !wrapped.ciphertext) {
      throw new FactaError('service_unavailable', 'Response does not contain the envelopes needed to open the catalog.', 503);
    }
    const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const unlockMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.#unlockKey), 'HKDF', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: fromBase64(salt), info: new TextEncoder().encode('facta-api-vault-destinations') }, unlockMaterial,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const dekBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: new TextEncoder().encode(`api-vault:${vaultId}:pass`) },
      kek,
      fromBase64(wrapped.ciphertext),
    ));
    try {
      const master = await crypto.subtle.importKey('raw', dekBytes, 'HKDF', false, ['deriveKey']);
      const catalogDek = await crypto.subtle.deriveKey({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32),
        info: new TextEncoder().encode('facta-api-vault-catalog'),
      }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const rowId = String(catalog['id']);
      const revisionText = String(catalog['revision']);
      const aad = `api-secret:v2:${companyId}:${this.#keyId()}:catalog:catalog_snapshot:${rowId}:${revisionText}`;
      const clear = await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: fromBase64(String(catalog['iv'])),
        additionalData: new TextEncoder().encode(aad),
      }, catalogDek, fromBase64(String(catalog['ciphertext'])));
      const snapshot = JSON.parse(new TextDecoder().decode(clear)) as CatalogSnapshot & { excludedCustomerIds?: unknown };
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.customers) || !Array.isArray(snapshot.products)) {
        throw new FactaError('service_unavailable', 'Encrypted catalog uses a version this SDK does not recognize.', 503);
      }
      // The app's encrypted sync policy contains IDs for excluded customers.
      // Keep those control records private to the app; they are not part of
      // the API consumer's authorized customer snapshot.
      const publicSnapshot = { version: 1 as const, customers: snapshot.customers, products: snapshot.products };
      const revision = Number(catalog['revision']);
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new FactaError('service_unavailable', 'Catalog revision is invalid.', 503);
      }
      this.#catalogCache = { revision, snapshot: publicSnapshot, fetchedAt: new Date().toISOString() };
      return publicSnapshot;
    } finally {
      dekBytes.fill(0);
    }
  }

  /** Public revision/freshness without returning any catalog content. */
  async catalogState(): Promise<CatalogState> {
    const local = this.#catalogCache;
    try {
      const status = await this.status();
      const sync = status.sincronizacion as Record<string, unknown> | null | undefined;
      const catalog = sync?.['catalog'] as Record<string, unknown> | undefined;
      const desired = Number(catalog?.['desiredRevision']);
      const published = Number(catalog?.['publishedRevision']);
      const desiredRevision = Number.isSafeInteger(desired) ? desired : null;
      const publishedRevision = Number.isSafeInteger(published) ? published : null;
      const ready = catalog?.['status'] === 'ready'
        && desiredRevision !== null && desiredRevision === publishedRevision;
      return {
        freshness: local === null ? 'missing' : ready && publishedRevision === local.revision ? 'fresh' : 'stale',
        localRevision: local?.revision ?? null,
        fetchedAt: local?.fetchedAt ?? null,
        desiredRevision,
        publishedRevision,
        syncStatus: typeof catalog?.['status'] === 'string' ? catalog['status'] : null,
        statusError: null,
      };
    } catch (cause) {
      const code = cause instanceof FactaError ? cause.code : 'network_error';
      return {
        freshness: local === null ? 'missing' : 'stale',
        localRevision: local?.revision ?? null,
        fetchedAt: local?.fetchedAt ?? null,
        desiredRevision: null,
        publishedRevision: null,
        syncStatus: null,
        statusError: code,
      };
    }
  }

  /** List customers; stale process-local reads require explicit opt-in. */
  async listCustomers(options: CatalogReadOptions = {}): Promise<CatalogCustomer[]> {
    return [...(await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).customers];
  }

  /** Find one authorized customer by its stable Facta ID. */
  async getCustomer(customerId: string, options: CatalogReadOptions = {}): Promise<CatalogCustomer | null> {
    return (await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).customers.find((customer) => customer.id === customerId) ?? null;
  }

  /** Search customer name, document number, NRC, and email locally. */
  async searchCustomers(query: string, options: CatalogSearchOptions = {}): Promise<CatalogCustomer[]> {
    const needle = normalizeCatalogQuery(query);
    if (!needle) return [];
    const limit = catalogSearchLimit(options.limit);
    return (await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).customers
      .filter((customer) => [customer.name, customer.doc_number, customer.nrc, customer.email]
        .some((value) => typeof value === 'string' && normalizeCatalogQuery(value).includes(needle)))
      .slice(0, limit);
  }

  /** List active products in the latest locally decrypted key snapshot. */
  async listProducts(options: { includeInactive?: boolean; allowStale?: boolean } = {}): Promise<CatalogProduct[]> {
    const products = (await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).products;
    return products.filter((product) => options.includeInactive === true || product.active !== false);
  }

  /** Find one authorized product by its stable Facta ID. */
  async getProduct(productId: string, options: CatalogReadOptions = {}): Promise<CatalogProduct | null> {
    const product = (await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).products.find((row) => row.id === productId);
    return product === undefined || product.active === false ? null : product;
  }

  /** Search active product descriptions, codes, and barcodes locally. */
  async searchProducts(query: string, options: CatalogSearchOptions = {}): Promise<CatalogProduct[]> {
    const needle = normalizeCatalogQuery(query);
    if (!needle) return [];
    const limit = catalogSearchLimit(options.limit);
    return (await this.#freshCatalog(options.allowStale ?? this.#config.allowStaleCatalogReads)).products
      .filter((product) => product.active !== false
        && [product.description, product.code, product.barcode]
          .some((value) => typeof value === 'string' && normalizeCatalogQuery(value).includes(needle)))
      .slice(0, limit);
  }

  async #freshCatalog(allowStale = false): Promise<CatalogSnapshot> {
    if (this.#catalogCache === null) return this.syncCatalog();
    let status: Status;
    try {
      status = await this.status();
    } catch (cause) {
      const code = cause instanceof FactaError ? cause.code : 'network_error';
      if (allowStale && (code === 'network_error' || code === 'service_unavailable')) {
        return this.#catalogCache.snapshot;
      }
      throw cause;
    }
    const sync = status.sincronizacion as Record<string, unknown> | null | undefined;
    const remoteCatalog = sync?.['catalog'] as Record<string, unknown> | undefined;
    const desiredRevision = Number(remoteCatalog?.['desiredRevision']);
    const publishedRevision = Number(remoteCatalog?.['publishedRevision']);
    if (remoteCatalog?.['status'] === 'ready'
      && desiredRevision === publishedRevision
      && publishedRevision === this.#catalogCache.revision) {
      return this.#catalogCache.snapshot;
    }
    if (allowStale && remoteCatalog?.['status'] !== 'ready') return this.#catalogCache.snapshot;
    return this.syncCatalog();
  }

  #keyId(): string { return this.#apiKey.slice(0, this.#apiKey.indexOf('.')); }

  async #archiveIdentity(signal?: AbortSignal): Promise<ArchiveOperationIdentity> {
    throwIfAborted(signal);
    const status = await this.status(signal ? { signal } : {});
    throwIfAborted(signal);
    const environment = status.emisor?.ambiente ?? status.ambiente;
    if (status.llave.keyId !== this.#keyId() || !status.emisor?.nit || (environment !== "00" && environment !== "01")) {
      throw new FactaError("archive_integrity_error", "Could not confirm the key’s fiscal identity; the archived operation was not started.", 0);
    }
    const endpointUrl = new URL(this.#baseUrl);
    endpointUrl.hostname = endpointUrl.hostname.toLowerCase();
    const identity: ArchiveOperationIdentity = {
      version: 1,
      endpoint: endpointUrl.toString().replace(/\/$/, ""),
      keyId: status.llave.keyId,
      issuerNit: status.emisor.nit,
      environment,
    };
    if (this.#config.expectedEnvironment && identity.environment !== this.#config.expectedEnvironment) {
      throw new FactaError("archive_integrity_error", "The key does not match the expected environment; the archived operation was not started.", 0);
    }
    return identity;
  }

  #assertArchiveIdentity(saved: ArchiveOperationIdentity | undefined, current: ArchiveOperationIdentity, operationId: string): void {
    if (!saved || JSON.stringify(saved) !== JSON.stringify(current)) {
      throw new FactaError("archive_integrity_error", "Operation " + operationId + " belongs to a different API identity (endpoint, key, issuer, or environment). It was not retried; use the original client and credentials or reconcile manually.", 0, { operationId });
    }
  }

  /** Emit in one call: correlative, signature, transmission and index. */
  async issue(request: DteRequest, options: IssueOptions = {}): Promise<IssueResult> {
    throwIfAborted(options.signal);
    const { deliver, ...call } = options;
    const resolved = withDelivery(await this.#resolveCatalogRefs(request), deliver);
    throwIfAborted(options.signal);
    return this.#request<IssueResult>("POST", "/v1/dte", resolved, call);
  }

  /**
   * Check the archive before reserving a control number, then retain exact
   * JSON/PDF/JWS bytes and a regenerated ticket PDF. A fiscal success is returned
   * even if archival later fails; callers must inspect `archive.state`.
   */
  async issueAndArchive(request: DteRequest, options: FactaArchiveEmissionOptions): Promise<ArchiveEmissionResult> {
    const archive = options.archive ?? this.#runtime.archive;
    if (!archive) throw new TypeError("issueAndArchive requires archive or runtime.archive.");
    const { operationId, idempotencyKey, signal } = options;
    throwIfAborted(signal);
    const remoteDestinations = options.remoteDestinations ?? this.#runtime.remoteDestinations;
    if (options.includeTicket === false && options.ticketPaperWidthMm !== undefined) {
      throw new TypeError("ticketPaperWidthMm cannot be supplied when includeTicket is false.");
    }
    const ticketPaperWidthMm = options.includeTicket === false
      ? undefined : options.ticketPaperWidthMm ?? this.#config.ticketPaperWidthMm ?? 80;
    if (!operationId.trim() || !idempotencyKey.trim()) {
      throw new TypeError("operationId and idempotencyKey are required for issueAndArchive.");
    }
    if (ticketPaperWidthMm !== undefined && (!Number.isInteger(ticketPaperWidthMm) || ticketPaperWidthMm < 40 || ticketPaperWidthMm > 120)) {
      throw new TypeError("ticketPaperWidthMm must be an integer from 40 through 120 millimeters.");
    }
    await archive.assertReady();
    throwIfAborted(signal);
    const identity = await this.#archiveIdentity(signal);
    const resolved = await this.#resolveCatalogRefs(request);
    throwIfAborted(signal);
    const requestBytes = new TextEncoder().encode(JSON.stringify(resolved));
    const requestSha256 = await sha256Hex(requestBytes);
    const created = await archive.begin({
      id: operationId,
      identity,
      idempotencyKey,
      requestSha256,
      request: resolved,
      createdAt: new Date().toISOString(),
      state: "started",
      ...(ticketPaperWidthMm === undefined ? {} : { ticketPaperWidthMm }),
    });
    if (!created) {
      return await this.recoverOperation(operationId, {
        request: withDelivery(request, options.deliver),
        archive,
        ...(signal ? { signal } : {}),
        ...(remoteDestinations ? { remoteDestinations } : {}),
      });
    }

    const emission = await this.#request<IssueResult>("POST", "/v1/dte", resolved, { idempotencyKey, ...(signal ? { signal } : {}) });
    return await this.#archiveEmission({ id: operationId, idempotencyKey, requestSha256, createdAt: new Date().toISOString(), state: "started", ...(ticketPaperWidthMm === undefined ? {} : { ticketPaperWidthMm }) }, emission, archive, signal, remoteDestinations);
  }

  /**
   * Resume an interrupted issuance from its encrypted journal.
   *
   * @param operationId Stable local operation ID passed to `issueAndArchive`.
   * @param options Optional archive/runtime overrides, cancellation signal,
   * remote destinations, and a request for legacy journals that predate saved
   * request snapshots. New journals do not require `request`.
   * @returns Fiscal result when recovered plus local artifact and remote-copy
   * outcomes; archival failure remains visible as `archive.state`.
   * @throws FactaError for identity/integrity or API failures, `TypeError` when
   * no archive is configured, and `Error` when recovery cannot be proven safe.
   */
  async recoverOperation(
    operationId: string,
    options: {
      request?: DteRequest;
      archive?: InvoiceArchive;
      signal?: AbortSignal;
      remoteDestinations?: readonly RemoteArtifactDestination[];
    } = {},
  ): Promise<ArchiveEmissionResult> {
    const request = options.request;
    const archive = options.archive ?? this.#runtime.archive;
    const signal = options.signal;
    let remoteDestinations = options.remoteDestinations ?? this.#runtime.remoteDestinations;
    if (!archive) throw new TypeError("recoverOperation requires archive or runtime.archive.");
    await archive.assertReady();
    throwIfAborted(signal);
    const operation = await archive.find(operationId);
    if (operation === null) throw new Error("Archive operation not found: " + operationId + ".");
    const identity = await this.#archiveIdentity(signal);
    this.#assertArchiveIdentity(operation.identity, identity, operationId);
    throwIfAborted(signal);
    let managedStorage = operation.managedStorage;
    let storageErrorCode = operation.storageErrorCode;
    if (operation.codigoGeneracion && (operation.storageErrorCode || managedStorage && [managedStorage.json, managedStorage.pdf].some((artifact) =>
      artifact.state === "pending" || artifact.state === "failed"
    ))) {
      try {
        const repairedStorage = await this.retryDocumentStorage(operation.codigoGeneracion, signal ? { signal } : {});
        for (const kind of ["json", "pdf"] as const) {
          const local = await this.#getVerifiedArtifact(archive, operation.codigoGeneracion, kind);
          const copy = repairedStorage[kind];
          if (local && copy.state === "stored" && (copy.sha256 !== local.sha256 || copy.bytes !== local.bytes.byteLength)) {
            throw new FactaError("archive_integrity_error", "Managed repair receipt differs from the exact local artifact.", 0);
          }
        }
        managedStorage = repairedStorage;
        await archive.recordManagedStorage?.(operation.id, managedStorage);
        storageErrorCode = undefined;
      } catch (cause) {
        const unsupported = cause instanceof FactaError && cause.code === "storage_unsupported";
        if (!unsupported) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          await archive.markNeedsAttention(operation.id, detail.slice(0, 500)).catch(() => undefined);
          return {
            ...(managedStorage === undefined ? {} : { managedStorage }),
            ...(storageErrorCode === undefined ? {} : { storageErrorCode }),
            archive: { state: "needs_attention", operationId, artifacts: [], detail },
          };
        }
      }
    }
    if (operation.state === "complete") {
      if (!operation.codigoGeneracion) throw new Error("Completed journal has no generation code.");
      const storedArtifacts = await this.#storedArtifactDigests(operation.codigoGeneracion, archive);
      const requiredKinds = operation.ticketPaperWidthMm === undefined
        ? ["json", "pdf", "jws"]
        : ["json", "pdf", "jws", "ticket"];
      if (requiredKinds.some((kind) => !storedArtifacts.some((artifact) => artifact.kind === kind))) {
        throw new FactaError("archive_integrity_error", "Journal is marked complete but required artifacts are missing.", 0, { operationId });
      }
      const remote = remoteDestinations?.length
        ? (await this.replicateArchive(operationId, archive, remoteDestinations, signal ? { signal } : {})).outcomes
        : operation.remoteCopies;
      return {
        ...(managedStorage === undefined ? {} : { managedStorage }),
        ...(storageErrorCode === undefined ? {} : { storageErrorCode }),
        archive: {
          state: "complete",
          operationId,
          artifacts: storedArtifacts,
          ...(remote ? { remoteCopies: remote } : {}),
        },
      };
    }

    const recoveryRequest = request ?? operation.request;
    if (!recoveryRequest) {
      throw new Error("Legacy journal does not contain the original request; provide it to recover the operation.");
    }
    const resolved = await this.#resolveCatalogRefs(recoveryRequest);
    const requestSha256 = await sha256Hex(new TextEncoder().encode(JSON.stringify(resolved)));
    if (requestSha256 !== operation.requestSha256) {
      throw new Error("Request does not match the saved fingerprint; it was not retried to avoid issuing a different document.");
    }

    if (operation.state === "issued" || (operation.state === "needs_attention" && operation.codigoGeneracion)) {
      const codigoGeneracion = operation.codigoGeneracion!;
      await this.getDocumentStatus(codigoGeneracion);
      const archived = await this.#archiveArtifacts(operation.id, codigoGeneracion, archive, signal, operation.ticketPaperWidthMm, remoteDestinations);
      return { ...(managedStorage === undefined ? {} : { managedStorage }), ...(storageErrorCode === undefined ? {} : { storageErrorCode }), archive: archived };
    }

    {
      // API idempotency claims expire at 24 h. Stop one hour early to leave
      // margin for clock skew; beyond that window a human must reconcile.
      const age = Date.now() - Date.parse(operation.createdAt);
      if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000) {
        const detail = "The safe idempotency window (23 h) expired; reconcile the document before issuing again.";
        await archive.markNeedsAttention(operationId, detail);
        throw new Error(detail);
      }
      const emission = await this.#request<IssueResult>("POST", "/v1/dte", resolved, {
        idempotencyKey: operation.idempotencyKey,
        ...(signal ? { signal } : {}),
      });
      return await this.#archiveEmission(operation, emission, archive, signal, remoteDestinations);
    }
  }

  /** List operations that still need local archival or remote-copy reconciliation. */
  async listPendingOperations(archiveOption?: InvoiceArchive): Promise<PendingArchiveOperation[]> {
    const archive = archiveOption ?? this.#runtime.archive;
    if (!archive) throw new TypeError("listPendingOperations requires archive or runtime.archive.");
    await archive.assertReady();
    return (await archive.pending()).map(({ id, createdAt, state, codigoGeneracion, remoteCopies, managedStorage, storageErrorCode }) => ({
      id,
      createdAt,
      state,
      ...(codigoGeneracion === undefined ? {} : { codigoGeneracion }),
      ...(managedStorage === undefined ? {} : { managedStorage }),
      ...(storageErrorCode === undefined ? {} : { storageErrorCode }),
      ...(remoteCopies === undefined ? {} : {
        remoteCopies: remoteCopies.map(({ destinationId, kind, state: copyState, sha256, updatedAt }) => ({
          destinationId,
          kind,
          state: copyState,
          sha256,
          updatedAt,
        })),
      }),
    }));
  }

  /** Write locally archived bytes to runtime adapters and durably record every outcome. */
  async replicateArchive(
    operationId: string,
    archive: ArchiveEmissionOptions["archive"],
    destinations: readonly RemoteArtifactDestination[],
    options: { signal?: AbortSignal } = {},
  ): Promise<RemoteReplicationReport> {
    throwIfAborted(options.signal);
    await archive.assertReady();
    const operation = await archive.find(operationId);
    if (!operation?.codigoGeneracion || operation.state !== "complete") {
      throw new Error("Operation must have a complete local archive before remote copies can be replicated.");
    }
    const ids = new Set<string>();
    for (const destination of destinations) {
      if (!destination.id.trim() || !destination.kind.trim() || !destination.label.trim() || ids.has(destination.id)) {
        throw new TypeError("Each remote destination must have a unique ID, type, label, and identity.");
      }
      ids.add(destination.id);
    }

    const outcomes: RemoteCopyRecord[] = [];
    const kinds = operation.ticketPaperWidthMm === undefined
      ? ["json", "pdf", "jws"] as const
      : ["json", "pdf", "jws", "ticket"] as const;
    const artifacts = new Map<ArchiveArtifact["kind"], ArchiveArtifact>();
    for (const kind of kinds) {
      const artifact = await archive.getArtifact(operation.codigoGeneracion, kind);
      if (!artifact) throw new Error("Local artifact is missing: " + kind + "; remote replication was not started.");
      const actualHash = await sha256Hex(artifact.bytes);
      if (actualHash !== artifact.sha256) throw new Error("Local artifact failed its SHA-256 integrity check.");
      artifacts.set(kind, artifact);
    }
    for (const destination of destinations) {
      for (const kind of kinds) {
        throwIfAborted(options.signal);
        const artifact = artifacts.get(kind)!;
        const prior = (operation.remoteCopies ?? []).find((row) =>
          row.destinationId === destination.id && row.kind === kind
        );
        if (prior?.state === "stored" && prior.sha256 === artifact.sha256) {
          outcomes.push(prior);
          continue;
        }

        let state: RemoteCopyRecord["state"];
        let detail: string | undefined;
        let cancelled = false;
        try {
          if (prior?.state === "unknown" && prior.sha256 === artifact.sha256 && destination.check) {
            try {
              const checked = await destination.check(artifact, options.signal ? { signal: options.signal } : {});
              throwIfAborted(options.signal);
              if (checked === "stored") state = "stored";
              else if (checked !== "missing") {
                state = "unknown";
                detail = "Adapter could not confirm the copy; it was not retried.";
              } else state = await this.#writeRemote(destination, artifact, options.signal);
            } catch (cause) {
              if (options.signal?.aborted) throw cause;
              state = "unknown";
              detail = "Remote reconciliation failed and the outcome remains ambiguous.";
            }
          } else {
            state = await this.#writeRemote(destination, artifact, options.signal);
            if (state === "unknown") detail = "Write finished without confirmation; reconcile it or retry idempotently.";
          }
        } catch (cause) {
          if (!options.signal?.aborted) throw cause;
          state = "unknown";
          detail = "Replication was cancelled during a remote operation; reconcile before assuming its state.";
          cancelled = true;
        }
        let record: RemoteCopyRecord = {
          destinationId: destination.id,
          kind,
          label: destination.label,
          state,
          sha256: artifact.sha256,
          updatedAt: new Date().toISOString(),
          ...(detail ? { detail } : {}),
        };
        try {
          await archive.recordRemoteCopy(operationId, record);
        } catch {
          // Do not misreport a completed local archive as incomplete. The remote writer
          // contract requires idempotent same-hash writes, so reconciliation can safely
          // repeat the operation after a journal-write failure.
          record = {
            ...record,
            state: record.state === "stored" ? "unknown" : record.state,
            detail: "No se pudo persistir el resultado remoto; concilie antes de asumir que existe una copia.",
          };
        }
        outcomes.push(record);
        operation.remoteCopies = [
          ...(operation.remoteCopies ?? []).filter((row) => !(row.destinationId === record.destinationId && row.kind === record.kind)),
          record,
        ];
        if (cancelled) throw options.signal?.reason ?? new DOMException("Remote replication cancelled.", "AbortError");
      }
    }
    for (const prior of operation.remoteCopies ?? []) {
      if (prior.state === "stored" || ids.has(prior.destinationId)) continue;
      const record: RemoteCopyRecord = {
        ...prior,
        state: "unavailable",
        updatedAt: new Date().toISOString(),
        detail: "El snapshot o los adaptadores actuales no incluyen este destino remoto.",
      };
      try {
        await archive.recordRemoteCopy(operationId, record);
      } catch {
        record.state = "unknown";
        record.detail = "No se pudo guardar el estado del destino ausente.";
      }
      outcomes.push(record);
    }
    return { operationId, outcomes };
  }

  /** Check existing remote copies without writing test objects or changing the archive. */
  async diagnoseDestinations(
    operationId: string,
    archive: ArchiveEmissionOptions["archive"],
    destinations: readonly RemoteArtifactDestination[],
    options: { signal?: AbortSignal; artifacts?: readonly ArchiveArtifact["kind"][] } = {},
  ): Promise<RemoteDestinationProbeReport> {
    throwIfAborted(options.signal);
    await archive.assertReady();
    const operation = await archive.find(operationId);
    if (!operation?.codigoGeneracion || operation.state !== "complete") {
      throw new Error("Operation must have complete local artifacts before remote destinations can be checked.");
    }
    const ids = new Set<string>();
    for (const destination of destinations) {
      if (!destination.id.trim() || !destination.kind.trim() || !destination.label.trim() || ids.has(destination.id)) {
        throw new TypeError("Each remote destination must have a unique ID, type, label, and identity.");
      }
      ids.add(destination.id);
    }

    const supportedKinds = new Set<ArchiveArtifact["kind"]>([
      "json",
      "pdf",
      "jws",
      "ticket",
    ]);
    const defaultKinds: ArchiveArtifact["kind"][] = operation.ticketPaperWidthMm === undefined
      ? ["json", "pdf", "jws"]
      : ["json", "pdf", "jws", "ticket"];
    const requestedKinds = new Set<string>(options.artifacts ?? defaultKinds);
    const results: RemoteDestinationProbeReport["results"] = [];
    for (const kind of requestedKinds) {
      if (!supportedKinds.has(kind as ArchiveArtifact["kind"])) {
        throw new TypeError("Artifact kind is not valid for remote diagnostics.");
      }
      const artifactKind = kind as ArchiveArtifact["kind"];
      throwIfAborted(options.signal);
      const artifact = await archive.getArtifact(operation.codigoGeneracion, artifactKind);
      if (!artifact) {
        throw new Error("Local artifact is missing: " + artifactKind + "; remote destination could not be checked.");
      }
      if (await sha256Hex(artifact.bytes) !== artifact.sha256) {
        throw new Error("Local artifact failed its SHA-256 integrity check.");
      }
      for (const destination of destinations) {
        throwIfAborted(options.signal);
        let state: RemoteDestinationProbeReport["results"][number]["state"] = "unsupported";
        if (destination.check) {
          try {
            state = await destination.check(
              { ...artifact, bytes: new Uint8Array(artifact.bytes) },
              options.signal ? { signal: options.signal } : {},
            );
          } catch {
            if (options.signal?.aborted) throw options.signal.reason;
            state = "unknown";
          }
        }
        results.push({
          destinationId: destination.id,
          kind: destination.kind,
          label: destination.label,
          artifact: artifactKind,
          state,
          expectedSha256: artifact.sha256,
        });
      }
    }
    return { operationId, results };
  }

  async #writeRemote(destination: RemoteArtifactDestination, artifact: ArchiveArtifact, signal?: AbortSignal): Promise<RemoteCopyRecord["state"]> {
    throwIfAborted(signal);
    try {
      const state = await destination.write(
        { ...artifact, bytes: new Uint8Array(artifact.bytes) },
        signal ? { signal } : {},
      );
      return (["stored", "unknown", "failed", "unavailable"] as const).includes(state)
        ? state
        : "unknown";
    } catch {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Remote write cancelled.", "AbortError");
      // A thrown network error may happen after the remote side committed the bytes.
      return "unknown";
    }
  }

  async #storedArtifactDigests(code: string, archive: ArchiveEmissionOptions["archive"]): Promise<ArchiveEmissionResult["archive"]["artifacts"]> {
    const rows: ArchiveEmissionResult["archive"]["artifacts"] = [];
    for (const kind of ["json", "pdf", "jws", "ticket"] as const) {
      const artifact = await this.#getVerifiedArtifact(archive, code, kind);
      if (artifact) rows.push({ kind, sha256: artifact.sha256 });
    }
    return rows;
  }

  async #getVerifiedArtifact(
    archive: InvoiceArchive,
    generationCode: string,
    kind: ArchiveArtifact["kind"],
  ): Promise<ArchiveArtifact | null> {
    const artifact = await archive.getArtifact(generationCode, kind);
    if (!artifact) return null;
    if (artifact.codigoGeneracion !== generationCode || artifact.kind !== kind ||
      await sha256Hex(artifact.bytes) !== artifact.sha256) {
      throw new FactaError("archive_integrity_error", `Archived ${kind} artifact does not match its identity or digest.`, 0, {
        codigoGeneracion: generationCode,
        kind,
      });
    }
    return artifact;
  }

  async #archiveEmission(
    operation: ArchiveOperation,
    emission: IssueResult,
    archive: ArchiveEmissionOptions["archive"],
    signal?: AbortSignal,
    remoteDestinations?: readonly RemoteArtifactDestination[],
  ): Promise<ArchiveEmissionResult> {
    const artifacts: ArchiveEmissionResult["archive"]["artifacts"] = [];
    try {
      await archive.markIssued(operation.id, emission);
      const archived = await this.#archiveArtifacts(
        operation.id,
        emission.codigoGeneracion,
        archive,
        signal,
        operation.ticketPaperWidthMm,
        remoteDestinations,
        emission,
      );
      return { emission, ...(emission.storage === undefined ? {} : { managedStorage: emission.storage }), ...(emission.storageErrorCode === undefined ? {} : { storageErrorCode: emission.storageErrorCode }), archive: archived };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      try { await archive.markNeedsAttention(operation.id, detail.slice(0, 500)); } catch { /* Preserve the successful fiscal result. */ }
      return { emission, ...(emission.storage === undefined ? {} : { managedStorage: emission.storage }), ...(emission.storageErrorCode === undefined ? {} : { storageErrorCode: emission.storageErrorCode }), archive: { state: "needs_attention", operationId: operation.id, artifacts, detail } };
    }
  }

  async #archiveArtifacts(
    operationId: string,
    generationCode: string,
    archive: ArchiveEmissionOptions["archive"],
    signal?: AbortSignal,
    ticketPaperWidthMm?: number,
    remoteDestinations?: readonly RemoteArtifactDestination[],
    emission?: IssueResult,
  ): Promise<ArchiveEmissionResult["archive"]> {
    const artifacts: ArchiveEmissionResult["archive"]["artifacts"] = [];
    try {
      const kinds = emission?.estado === "contingencia" ? ["json"] as const : ["json", "pdf"] as const;
      for (const kind of kinds) {
        let artifact = await this.#getVerifiedArtifact(archive, generationCode, kind);
        if (!artifact) {
          const inlineBytes = kind === "json" && typeof emission?.archivoJson === "string"
            ? new TextEncoder().encode(emission.archivoJson)
            : kind === "pdf" && emission?.estado === "sellado" && emission.representacionGrafica
            ? base64Bytes(emission.representacionGrafica)
            : null;
          if (inlineBytes !== null) {
            if (kind === "json") {
              const signed = JSON.parse(new TextDecoder().decode(inlineBytes)) as Record<string, unknown>;
              if (
                signed["codigoGeneracion"] !== generationCode ||
                signed["ambiente"] !== emission!.ambiente ||
                signed["jws"] !== emission!.jws
              ) {
                throw new FactaError("archive_integrity_error", "The inline legal JSON does not match the issued DTE.", 0, { codigoGeneracion: generationCode });
              }
            } else if (
              inlineBytes.length < 5 ||
              new TextDecoder().decode(inlineBytes.subarray(0, 5)) !== "%PDF-"
            ) {
              throw new FactaError("archive_integrity_error", "The inline document representation is not a PDF.", 0, { codigoGeneracion: generationCode });
            }
            artifact = {
              codigoGeneracion: generationCode,
              kind,
              filename: `${generationCode}.${kind}`,
              contentType: kind === "json" ? "application/json" : "application/pdf",
              bytes: inlineBytes,
              sha256: await sha256Hex(inlineBytes),
            };
          } else {
            const downloaded = await this.downloadDocument(generationCode, kind, signal ? { signal } : {});
            artifact = {
              codigoGeneracion: generationCode,
              kind,
              filename: downloaded.filename,
              contentType: downloaded.contentType,
              bytes: downloaded.bytes,
              sha256: await sha256Hex(downloaded.bytes),
            };
          }
          await archive.saveArtifact(artifact);
        }
        artifacts.push({ kind, sha256: artifact.sha256 });
        if (kind === "json") {
          const signed = JSON.parse(new TextDecoder().decode(artifact.bytes)) as { jws?: unknown };
          if (typeof signed.jws !== "string" || signed.jws.length === 0) {
            throw new Error("The downloaded legal JSON does not contain its compact JWS.");
          }
          const bytes = new TextEncoder().encode(signed.jws);
          const expectedJws: ArchiveArtifact = {
            codigoGeneracion: generationCode,
            kind: "jws",
            filename: generationCode + ".jws",
            contentType: "application/jose",
            bytes,
            sha256: await sha256Hex(bytes),
          };
          const storedJws = await this.#getVerifiedArtifact(archive, generationCode, "jws");
          if (storedJws && storedJws.sha256 !== expectedJws.sha256) {
            throw new FactaError("archive_integrity_error", "Archived JWS does not match the stored legal JSON.", 0, { codigoGeneracion: generationCode });
          }
          if (!storedJws) await archive.saveArtifact(expectedJws);
          artifacts.push({ kind: "jws", sha256: storedJws?.sha256 ?? expectedJws.sha256 });
        }
      }
      if (ticketPaperWidthMm !== undefined && emission?.estado !== "contingencia") {
        let ticket = await this.#getVerifiedArtifact(archive, generationCode, "ticket");
        if (!ticket) {
          const downloaded = await this.downloadDocument(generationCode, "ticket", {
            ...(signal ? { signal } : {}),
            paperWidthMm: ticketPaperWidthMm,
          });
          ticket = {
            codigoGeneracion: generationCode,
            kind: "ticket",
            filename: downloaded.filename,
            contentType: downloaded.contentType,
            bytes: downloaded.bytes,
            sha256: await sha256Hex(downloaded.bytes),
          };
          await archive.saveArtifact(ticket);
        }
        artifacts.push({ kind: ticket.kind, sha256: ticket.sha256 });
      }
      await archive.finish(operationId);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      try { await archive.markNeedsAttention(operationId, detail.slice(0, 500)); } catch { /* Preserve fiscal success if journaling fails. */ }
      return { state: "needs_attention", operationId, artifacts, detail };
    }
    if (remoteDestinations?.length) {
      try {
        const remoteCopies = (await this.replicateArchive(operationId, archive, remoteDestinations, signal ? { signal } : {})).outcomes;
        return { state: "complete", operationId, artifacts, remoteCopies };
      } catch {
        return {
          state: "complete",
          operationId,
          artifacts,
          remoteCopies: remoteDestinations.flatMap((destination) => artifacts.map(({ kind, sha256 }) => ({
            destinationId: destination.id,
            kind,
            label: destination.label,
            state: "unknown" as const,
            sha256,
            updatedAt: new Date().toISOString(),
            detail: "Could not record the remote outcome; the local archive is complete.",
          }))),
        };
      }
    }
    return { state: "complete", operationId, artifacts };
  }

  /** Reserve the correlative and get the canonical document, unsigned. */
  async prepare(request: DteRequest, options: CallOptions = {}): Promise<PreparedDte> {
    throwIfAborted(options.signal);
    const resolved = await this.#resolveCatalogRefs(request);
    throwIfAborted(options.signal);
    return this.#request<PreparedDte>("POST", "/v1/dte/prepare", resolved, options);
  }

  /**
   * True when `/v1/status` advertises `llave.catalogMode: "readable"`. Cached
   * for a minute (the owner switches it rarely). Any failure answers false,
   * which keeps the previous behaviour — local resolution from the encrypted
   * snapshot — so this check can never be the reason an emission fails.
   */
  async #serverResolvesCatalog(): Promise<boolean> {
    const cached = this.#catalogModeCache;
    if (cached !== null && Date.now() - cached.at < CATALOG_MODE_TTL_MS) return cached.readable;
    let readable = false;
    try {
      readable = (await this.status()).llave?.catalogMode === "readable";
    } catch {
      return false;
    }
    this.#catalogModeCache = { readable, at: Date.now() };
    return readable;
  }

  async #resolveCatalogRefs(request: DteRequest): Promise<DteRequest> {
    const hasCustomer = request.receptor !== undefined && request.receptor !== null &&
      "customerId" in request.receptor && typeof request.receptor.customerId === "string";
    const hasProduct = request.items.some((item) => typeof item.productId === "string");
    if (!hasCustomer && !hasProduct) return request;
    // A key whose owner enabled «Catálogo legible por la API»: the server
    // resolves the ids itself, so no unlock key and no local snapshot are
    // needed, and a catalog change can never leave the SDK with a stale copy.
    if (await this.#serverResolvesCatalog()) return request;
    await this.#freshCatalog();
    const catalog = this.#catalogCache!;
    return resolveCatalogRefs(request, catalog.snapshot, catalog.revision);
  }

  /**
   * Sign and transmit what `prepare` handed back.
   *
   * Pass the document through UNCHANGED. The server checks a MAC over its
   * canonical hash, so a single altered cent is refused instead of signed.
   */
  sign(prepared: PreparedDte, options: CallOptions = {}): Promise<IssueResult> {
    return this.#request<IssueResult>("POST", "/v1/dte/sign", {
      prepareToken: prepared.prepareToken,
      documento: prepared.documento,
    }, options);
  }

  /**
   * Start the e-mail delivery of a sealed document. `token` is
   * `result.entrega.token`, valid five minutes from issuance. Answers 200 with
   * the final channel state, or 202 with `en_proceso` (read it with
   * `getDelivery`/`waitForDelivery`). A second call returns the current state
   * without a second message. A channel that cannot be delivered is a state
   * (`fallido`, …), not an error; expiry is `FactaError("entrega_vencida")`.
   */
  deliverEmail(generationCode: string, token: string, options: { signal?: AbortSignal } = {}): Promise<DeliveryChannelResult> {
    return this.#deliver("correo", generationCode, token, options);
  }

  /** WhatsApp counterpart of `deliverEmail`; billed to the company's prepaid wallet. */
  deliverWhatsApp(generationCode: string, token: string, options: { signal?: AbortSignal } = {}): Promise<DeliveryChannelResult> {
    return this.#deliver("whatsapp", generationCode, token, options);
  }

  async #deliver(
    channel: DeliveryChannel,
    generationCode: string,
    token: string,
    options: { signal?: AbortSignal },
  ): Promise<DeliveryChannelResult> {
    if (!GENERATION_CODE.test(generationCode)) throw new TypeError("generationCode must be a codigoGeneracion.");
    if (typeof token !== "string" || token === "") throw new TypeError("token is required (IssueResult.entrega.token).");
    try {
      return await this.#request<DeliveryChannelResult>(
        "POST",
        `/v1/dte/${encodeURIComponent(generationCode)}/entrega/${channel}`,
        { token },
        // The route is idempotent per channel on the server (a second call
        // returns the current state), so the default per-call key is enough.
        options.signal ? { signal: options.signal } : {},
      );
    } catch (error) {
      // The token is a bearer secret: strip it from anything the server echoed.
      if (error instanceof FactaError) {
        throw new FactaError(
          error.code,
          redactErrorValue(error.message, [token]) as string,
          error.status,
          redactErrorValue(error.details, [token]),
        );
      }
      throw error;
    }
  }

  /** Read every channel's delivery state. Works after the token expired. */
  getDelivery(generationCode: string, options: { signal?: AbortSignal } = {}): Promise<DeliveryStatus> {
    if (!GENERATION_CODE.test(generationCode)) throw new TypeError("generationCode must be a codigoGeneracion.");
    return this.#request<DeliveryStatus>(
      "GET",
      `/v1/dte/${encodeURIComponent(generationCode)}/entrega`,
      undefined,
      options.signal ? { signal: options.signal } : {},
    );
  }

  /**
   * Poll `getDelivery` until every awaited channel is final (anything except
   * `pendiente`/`en_proceso`; `esperando_sello` is not waited for). On timeout
   * it returns the last status with `settled: false` instead of throwing:
   * delivery never changes the fiscal outcome.
   */
  async waitForDelivery(generationCode: string, options: WaitForDeliveryOptions = {}): Promise<WaitedDelivery> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 2_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be a non-negative number.");
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError("intervalMs must be positive.");
    const { signal } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      throwIfAborted(signal);
      const status = await this.getDelivery(generationCode, signal ? { signal } : {});
      const wanted = (options.channels ?? Object.keys(status.canales) as DeliveryChannel[]);
      const settled = wanted.every((c) => {
        const channel = status.canales[c];
        return channel !== undefined && isFinalDeliveryState(channel.estado);
      });
      if (settled || Date.now() + intervalMs > deadline) return { ...status, settled };
      await sleep(intervalMs, signal);
    }
  }

  /** Look a document up. Answers for rejected ones too, not just sealed. */
  getDocumentStatus(generationCode: string): Promise<DocumentStatus> {
    return this.#request<DocumentStatus>(
      "GET",
      `/v1/dte/${encodeURIComponent(generationCode)}`,
    );
  }

  /** List sealed/reconciliable documents using the server cursor. */
  listDocuments(filters: ListDocumentsFilters = {}): Promise<DtePage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
    return this.#request<DtePage>("GET", `/v1/dte${query.size ? `?${query}` : ""}`);
  }

  /** Invalidate a sealed document. This sends the signing key and is irreversible. */
  invalidate(generationCode: string, request: InvalidationRequest, options: CallOptions = {}): Promise<InvalidationResult> {
    return this.#request<InvalidationResult>("POST", `/v1/dte/${encodeURIComponent(generationCode)}/invalidate`, request, options);
  }

  /** Persist an invalidation command before sending and retain the signed event response. */
  async invalidateAndArchive(
    generationCode: string,
    request: InvalidationRequest,
    options: FactaInvalidationArchiveOptions,
  ): Promise<InvalidationArchiveResult> {
    throwIfAborted(options.signal);
    const archive = options.archive ?? this.#runtime.invalidationArchive;
    if (!archive) throw new TypeError("invalidateAndArchive requires archive or runtime.invalidationArchive.");
    if (!options.operationId.trim() || !options.idempotencyKey.trim()) {
      throw new TypeError("operationId and idempotencyKey are required for invalidateAndArchive.");
    }
    await archive.assertReady();
    throwIfAborted(options.signal);
    const identity = await this.#archiveIdentity(options.signal);
    const requestBytes = new TextEncoder().encode(`${generationCode}\n${JSON.stringify(request)}`);
    const requestSha256 = await sha256Hex(requestBytes);
    const created = await archive.beginInvalidation({
      id: options.operationId,
      identity,
      targetCodigoGeneracion: generationCode,
      idempotencyKey: options.idempotencyKey,
      requestSha256,
      request,
      createdAt: new Date().toISOString(),
      state: "started",
    });
    if (!created) return await this.recoverInvalidation(options.operationId, archive, options.signal);

    const result = await this.invalidate(generationCode, request, {
      idempotencyKey: options.idempotencyKey,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return await this.#archiveInvalidationResult(
      options.operationId,
      generationCode,
      result,
      archive,
    );
  }

  /** Resume the same invalidation only within its conservative idempotency window. */
  async recoverInvalidation(
    operationId: string,
    archiveOption?: InvalidationArchive,
    signal?: AbortSignal,
  ): Promise<InvalidationArchiveResult> {
    const archive = archiveOption ?? this.#runtime.invalidationArchive;
    if (!archive) throw new TypeError("recoverInvalidation requires an archive or runtime.invalidationArchive.");
    await archive.assertReady();
    throwIfAborted(signal);
    const operation = await archive.findInvalidation(operationId);
    if (!operation) throw new Error("Invalidation operation not found: " + operationId + ".");
    const identity = await this.#archiveIdentity(signal);
    this.#assertArchiveIdentity(operation.identity, identity, operationId);
    throwIfAborted(signal);
    if (operation.state === "complete") {
      if (
        !operation.result || !("jws" in operation.result) ||
        !operation.eventJwsSha256 ||
        await sha256Hex(new TextEncoder().encode(operation.result.jws)) !==
          operation.eventJwsSha256
      ) {
        throw new FactaError(
          "archive_integrity_error",
          "Invalidation journal failed its integrity check.",
          0,
          { operationId },
        );
      }
      return {
        invalidation: operation.result,
        archive: {
          state: "complete",
          operationId,
          ...(operation.eventJwsSha256 === undefined
            ? {}
            : { eventJwsSha256: operation.eventJwsSha256 }),
        },
      };
    }
    if (operation.result && "jws" in operation.result) {
      return await this.#archiveInvalidationResult(
        operationId,
        operation.targetCodigoGeneracion,
        operation.result,
        archive,
      );
    }
    if (operation.result && !("jws" in operation.result)) {
      throw new FactaError("operation_outcome_unknown", "API confirms invalidation, but did not return the event JWS to archive.", 0, {
        operationId,
        codigoGeneracion: operation.targetCodigoGeneracion,
      });
    }
    const createdAt = Date.parse(operation.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt >= 23 * 60 * 60 * 1000) {
      const detail = "The safe recovery window expired; reconcile the document status before acting again.";
      await archive.markInvalidationNeedsAttention(operationId, detail);
      throw new FactaError("operation_outcome_unknown", detail, 0, {
        operationId,
        codigoGeneracion: operation.targetCodigoGeneracion,
      });
    }
    const result = await this.invalidate(operation.targetCodigoGeneracion, operation.request, {
      idempotencyKey: operation.idempotencyKey,
      ...(signal ? { signal } : {}),
    });
    return await this.#archiveInvalidationResult(
      operationId,
      operation.targetCodigoGeneracion,
      result,
      archive,
    );
  }

  async listPendingInvalidations(
    archiveOption?: InvalidationArchive,
  ): Promise<Array<Pick<InvalidationOperation, "id" | "targetCodigoGeneracion" | "createdAt" | "state">>> {
    const archive = archiveOption ?? this.#runtime.invalidationArchive;
    if (!archive) throw new TypeError("listPendingInvalidations requires archive or runtime.invalidationArchive.");
    await archive.assertReady();
    return (await archive.pendingInvalidations()).map(({ id, targetCodigoGeneracion, createdAt, state }) => ({
      id,
      targetCodigoGeneracion,
      createdAt,
      state,
    }));
  }

  async #archiveInvalidationResult(
    operationId: string,
    targetCodigoGeneracion: string,
    result: InvalidationResult,
    archive: InvalidationArchive,
  ): Promise<InvalidationArchiveResult> {
    if (result.codigoGeneracion !== targetCodigoGeneracion) {
      const detail = "Invalidation response identifies a different document than the requested one.";
      await archive.markInvalidationNeedsAttention(operationId, detail, result).catch(() => undefined);
      throw new FactaError(
        "internal_error",
        detail,
        502,
        { operationId },
      );
    }
    if (!("jws" in result) || result.jws.length === 0) {
      const detail = "The API already records this invalidation, but its event JWS is unavailable for archiving.";
      await archive.markInvalidationNeedsAttention(operationId, detail, result).catch(() => undefined);
      return { invalidation: result, archive: { state: "needs_attention", operationId, detail } };
    }
    const eventJwsSha256 = await sha256Hex(new TextEncoder().encode(result.jws));
    try {
      await archive.completeInvalidation(operationId, result);
      return { invalidation: result, archive: { state: "complete", operationId, eventJwsSha256 } };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      await archive.markInvalidationNeedsAttention(operationId, detail, result).catch(() => undefined);
      return { invalidation: result, archive: { state: "needs_attention", operationId, eventJwsSha256, detail } };
    }
  }

  /** Download JSON/PDF bytes or regenerate a ticket PDF without issuing again. */
  async downloadDocument(
    generationCode: string,
    kind: "json" | "pdf" | "ticket" = "json",
    options: CallOptions & DownloadOptions = {},
  ): Promise<DownloadedDocument> {
    if (options.source !== undefined && (options.source !== "managed" || kind === "ticket")) {
      throw new TypeError("source=managed is only valid for JSON/PDF downloads.");
    }
    const paperWidthMm = options.paperWidthMm ?? this.#config.ticketPaperWidthMm;
    if (options.paperWidthMm !== undefined && kind !== "ticket") {
      throw new TypeError("paperWidthMm is only valid when downloading kind=ticket.");
    }
    if (kind === "ticket" && paperWidthMm !== undefined) {
      if (!Number.isInteger(paperWidthMm) || paperWidthMm < 40 || paperWidthMm > 120) {
        throw new TypeError("paperWidthMm must be an integer from 40 through 120 millimeters.");
      }
    }
    const query = new URLSearchParams({ kind });
    if (options.source === "managed") query.set("source", "managed");
    if (kind === "ticket" && paperWidthMm !== undefined) query.set("paperWidthMm", String(paperWidthMm));
    const downloaded = await this.#request<DownloadedDocument>(
      "GET",
      `/v1/dte/${encodeURIComponent(generationCode)}/file?${query}`,
      undefined,
      options,
      true,
    );
    if (options.source === "managed" && downloaded.storageSource !== "managed") {
      throw new FactaError(downloaded.storageSource === undefined ? "storage_unsupported" : "storage_contract_invalid", "API did not return the explicitly requested managed copy.", 502);
    }
    return {
      ...downloaded,
      codigoGeneracion: generationCode,
      kind,
      ...(downloaded.storageSource === undefined ? {} : { storageSource: downloaded.storageSource }),
      ...(kind === "ticket" ? { paperWidthMm: paperWidthMm ?? 80 } : {}),
    };
  }

  /** Submit a previously downloaded PDF once to a caller-supplied printer adapter. */
  print(
    document: DownloadedDocument,
    transport: PrintTransport | undefined = this.#runtime.printTransport,
    options: { signal?: AbortSignal } = {},
  ): Promise<PrintResult> {
    if (!transport) throw new TypeError("print requires transport or runtime.printTransport.");
    return submitPrintJob(document, transport, options);
  }

  /** Inspect the holding area; this does not download document bytes. */
  listHolding(limit = 50): Promise<HoldingPage> {
    return this.#request<HoldingPage>("GET", `/v1/dte/holding?limit=${encodeURIComponent(String(limit))}`);
  }

  /** Fetch the server's published OpenAPI JSON contract. */
  getContract(): Promise<unknown> { return this.#request("GET", "/v1/openapi.json"); }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: CallOptions = {},
    binary = false,
  ): Promise<T> {
    throwIfAborted(options.signal);
    const headers: Record<string, string> = { "X-Facta-Key": this.#apiKey };
    // Sent ONLY where it is needed. A password that rides along on every
    // request is a password in every proxy log the request passes through.
    if (this.#signKey !== null && method === "POST" && (SIGNING_PATHS.has(path) || path.includes("/invalidate"))) {
      headers["X-Facta-Sign-Key"] = this.#signKey;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Minted ONCE, outside the retry loop. Regenerating it per attempt is
    // exactly the failure this header prevents.
    if (method === "POST") {
      headers["Idempotency-Key"] = options.idempotencyKey ?? newIdempotencyKey();
    }

    let lastError: FactaError | null = null;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      throwIfAborted(options.signal);
      if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 4_000), options.signal);
      throwIfAborted(options.signal);
      try {
        return await this.#attempt<T>(method, path, headers, body, binary, options.signal);
      } catch (cause) {
        if (!(cause instanceof FactaError) || !RETRYABLE.has(cause.code)) throw cause;
        lastError = cause;
      }
    }
    throw lastError;
  }

  async #attempt<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    binary: boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      controller.abort();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      throw cancelled();
    }
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (signal?.aborted) throw cancelled();
      throw new FactaError(
        "network_error",
        "Could not reach the Facta API; check connectivity and service status.",
        0,
      );
    }

    if (binary) {
      try {
        if (!response.ok) return await this.#parseError(response);
        const storageSource = response.headers.get("x-facta-storage-source");
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          filename: response.headers.get("content-disposition")?.match(/filename="?([^";]+)\"?/)?.[1] ?? null,
          ...(isStorageSource(storageSource) ? { storageSource } : {}),
        } as T;
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
      }
    }

    let text: string;
    try { text = await response.text(); } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    let payload: unknown = null;
    try {
      payload = text === "" ? null : JSON.parse(text);
    } catch {
      throw new FactaError(
        "internal_error",
        `API response was not valid JSON (HTTP ${response.status}).`,
        response.status,
      );
    }

    if (response.ok || response.status === 202) {
      if (isRecord(payload) && (payload.estado === "sellado" || payload.estado === "contingencia") && "storage" in payload &&
        (!isManagedStorageReceipt(payload.storage) || payload.storage.environment !== this.#environment() ||
          typeof payload.codigoGeneracion !== "string" || payload.storage.operationId.toUpperCase() !== payload.codigoGeneracion.toUpperCase())) {
        delete payload.storage;
        payload.storageErrorCode = "storage_contract_invalid";
      }
      if (isRecord(payload) && isManagedStorageReceipt(payload.storage)) {
        const receipt = payload.storage;
        for (const kind of ["json", "pdf"] as const) {
          const bytes = kind === "json" && typeof payload.archivoJson === "string" ? new TextEncoder().encode(payload.archivoJson)
            : kind === "pdf" && typeof payload.representacionGrafica === "string" ? (() => { try { return base64Bytes(payload.representacionGrafica as string); } catch { return null; } })() : null;
          if (bytes && receipt[kind].state === "stored" && (receipt[kind].bytes !== bytes.byteLength || receipt[kind].sha256 !== await sha256Hex(bytes))) {
            delete payload.storage;
            payload.storageErrorCode = "storage_contract_invalid";
            break;
          }
        }
      }
      return payload as T;
    }

    return await this.#parseError(response, payload);
  }

  async #parseError(response: Response, payload?: unknown): Promise<never> {
    const value = payload ?? await response.json().catch(() => null);
    const error = (value as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    const message = typeof error?.message === "string" ? error.message : `HTTP ${response.status}`;
    throw new FactaError(
      (error?.code ?? "internal_error") as FactaErrorCode,
      redactErrorValue(message, this.#secrets) as string,
      response.status,
      redactErrorValue(error?.details, this.#secrets),
    );
  }
}
