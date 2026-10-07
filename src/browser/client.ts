// The browser half of the wire contract (docs/react-signing-ui.md §5).
//
// Speaks only to the implementer's own handler, with an opaque session token.
// No credential ever passes through here.

import type {
  Action,
  CopyRow,
  CustomerOption,
  DocumentDetail,
  DocumentFilters,
  DocumentPage,
  DownloadedFile,
  DownloadKind,
  HoldingRow,
  InvalidationInfo,
  InvalidationOutcome,
  ProductOption,
  ServiceStatusView,
  StorageRetryResult,
  StorageView,
  DeliveryView,
  IssueSummary,
  SessionInfo,
  SpentInfo,
  StatusSummary,
  StorageSummary,
  WireError,
  WireFieldIssue,
} from "./wire.ts";

export interface FactaClientOptions {
  /** URL of the implementer's handler, e.g. `/api/facta`. */
  endpoint: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra request headers (static, or computed per call). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Per-request timeout. A timeout counts as an uncertain outcome. Default 60 s. */
  timeoutMs?: number;
}

/**
 * A failed call. `transport` is true when the browser never got a usable
 * answer (no connection, timeout, non-JSON body, 5xx without an envelope):
 * what happened on the server is then unknown, and the caller must verify
 * instead of starting over.
 */
export class FactaClientError extends Error {
  override readonly name = "FactaClientError";
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly spent: SpentInfo | boolean | undefined;
  readonly observaciones: string[];
  readonly fields: WireFieldIssue[];
  readonly statusToken: string | undefined;
  readonly transport: boolean;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
    spent?: SpentInfo | boolean | undefined;
    observaciones?: string[] | undefined;
    fields?: WireFieldIssue[] | undefined;
    statusToken?: string | undefined;
    transport: boolean;
  }) {
    super(init.message);
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.spent = init.spent;
    this.observaciones = init.observaciones ?? [];
    this.fields = init.fields ?? [];
    this.statusToken = init.statusToken;
    this.transport = init.transport;
  }

  /** True when a control number was burned by this failure. */
  get wasSpent(): boolean {
    return Boolean(this.spent);
  }
}

export interface FactaClient {
  describe(session: string): Promise<SessionInfo>;
  issue(session: string): Promise<IssueSummary>;
  status(session: string, codigoGeneracion: string, statusToken: string): Promise<StatusSummary>;
  /**
   * Read the delivery state with the `deliveryHandle` of an issue result.
   * Optional so a hand-written client keeps compiling; `createFactaClient` always has it.
   */
  deliveryStatus?(session: string, deliveryHandle: string): Promise<DeliveryView>;
}

/** Reads and simple actions (docs/react-signing-ui.md §11). Each needs the matching handler capability. */
export interface FactaDataClient {
  listDocuments(filters?: DocumentFilters & { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<DocumentPage>;
  getDocument(codigoGeneracion: string): Promise<DocumentDetail>;
  downloadDocument(codigoGeneracion: string, kind: DownloadKind, options?: { paperWidthMm?: number; raw?: boolean }): Promise<DownloadedFile>;
  getDocumentCopies(codigoGeneracion: string): Promise<CopyRow[]>;
  retryDocumentStorage(codigoGeneracion: string): Promise<StorageRetryResult>;
  listHolding(): Promise<HoldingRow[]>;
  searchCustomers(query: string, options?: { limit?: number }, signal?: AbortSignal): Promise<CustomerOption[]>;
  getCustomer(id: string): Promise<CustomerOption>;
  searchProducts(query: string, options?: { limit?: number }, signal?: AbortSignal): Promise<ProductOption[]>;
  getProduct(id: string): Promise<ProductOption>;
  getServiceStatus(): Promise<ServiceStatusView>;
  getStorageStatus(): Promise<StorageView>;
  describeInvalidation(session: string): Promise<InvalidationInfo>;
  invalidate(session: string): Promise<InvalidationOutcome>;
}

/** What `createFactaClient` returns. */
export type FactaFullClient = FactaClient & FactaDataClient;

/** Drop undefined entries so they never reach the wire. */
function clean<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function transportError(message: string, status = 0): FactaClientError {
  return new FactaClientError({ code: "network_error", message, status, retryable: true, transport: true });
}

export function createFactaClient(options: FactaClientOptions): FactaFullClient {
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function call<T>(action: Action, session: string | undefined, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const extraHeaders = typeof options.headers === "function" ? await options.headers() : options.headers;
    const headers = new Headers(extraHeaders);
    headers.set("content-type", "application/json");
    headers.set("x-facta-ui", "1");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    let response: Response;
    try {
      response = await doFetch(options.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, session, ...extra }),
        signal: controller.signal,
        credentials: "same-origin",
      });
    } catch (error) {
      clearTimeout(timer);
      throw transportError(error instanceof Error ? error.message : "network error");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      clearTimeout(timer);
      throw transportError("unreadable response", response.status);
    }
    clearTimeout(timer);

    const envelope = body && typeof body === "object" ? (body as { error?: WireError }).error : undefined;
    if (envelope && typeof envelope === "object" && typeof envelope.code === "string") {
      throw new FactaClientError({
        code: envelope.code,
        message: typeof envelope.message === "string" ? envelope.message : envelope.code,
        status: response.status,
        retryable: envelope.retryable === true,
        spent: envelope.spent,
        observaciones: Array.isArray(envelope.observaciones) ? envelope.observaciones.map(String) : [],
        statusToken: typeof envelope.statusToken === "string" ? envelope.statusToken : undefined,
        fields: Array.isArray(envelope.fields)
          ? envelope.fields
            .filter((f) => f && typeof f.path === "string")
            .map((f) => ({ path: f.path, message: String(f.message ?? "") }))
          : [],
        transport: false,
      });
    }
    if (!response.ok || !body || typeof body !== "object") {
      throw transportError(`unexpected response (${response.status})`, response.status);
    }
    return body as T;
  }

  return {
    describe: (session) => call<SessionInfo>("session.describe", session),
    issue: async (session) => {
      const r = await call<{
        result: IssueSummary;
        storage?: StorageSummary;
        emergency?: { saved: boolean; reason: string; critical?: boolean };
        statusToken?: string;
        deliveryHandle?: string;
        delivery?: DeliveryView;
      }>("issue", session);
      return {
        ...r.result,
        ...(r.storage ? { storage: r.storage } : {}),
        ...(r.emergency && typeof r.emergency.saved === "boolean" ? { emergency: { saved: r.emergency.saved, reason: String(r.emergency.reason), ...(r.emergency.critical === true ? { critical: true } : {}) } } : {}),
        ...(typeof r.statusToken === "string" ? { statusToken: r.statusToken } : {}),
        ...(typeof r.deliveryHandle === "string" && r.delivery && typeof r.delivery === "object"
          ? { deliveryHandle: r.deliveryHandle, delivery: r.delivery }
          : {}),
      };
    },
    status: async (session, codigoGeneracion, statusToken) =>
      (await call<{ status: StatusSummary }>("status", session, { codigoGeneracion, statusToken })).status,
    deliveryStatus: async (session, deliveryHandle) =>
      (await call<{ delivery: DeliveryView }>("delivery.status", session, { deliveryHandle })).delivery,
    listDocuments: async (filters = {}, signal) => {
      const { buscar: _local, ...server } = filters;
      return await call<DocumentPage>("documents.list", undefined, clean(server), signal);
    },
    getDocument: async (codigoGeneracion) =>
      (await call<{ document: DocumentDetail }>("documents.get", undefined, { codigoGeneracion })).document,
    downloadDocument: async (codigoGeneracion, kind, opts = {}) =>
      (await call<{ file: DownloadedFile }>("documents.download", undefined, { codigoGeneracion, kind, ...clean(opts) })).file,
    getDocumentCopies: async (codigoGeneracion) =>
      (await call<{ copies: CopyRow[] }>("documents.copies", undefined, { codigoGeneracion })).copies,
    retryDocumentStorage: async (codigoGeneracion) =>
      (await call<{ storage: StorageRetryResult }>("documents.retryStorage", undefined, { codigoGeneracion })).storage,
    listHolding: async () => (await call<{ documentos: HoldingRow[] }>("documents.holding", undefined)).documentos,
    searchCustomers: async (query, opts = {}, signal) =>
      (await call<{ items: CustomerOption[] }>("catalog.customers.search", undefined, { query, ...clean(opts) }, signal)).items,
    getCustomer: async (id) => (await call<{ item: CustomerOption }>("catalog.customers.get", undefined, { id })).item,
    searchProducts: async (query, opts = {}, signal) =>
      (await call<{ items: ProductOption[] }>("catalog.products.search", undefined, { query, ...clean(opts) }, signal)).items,
    getProduct: async (id) => (await call<{ item: ProductOption }>("catalog.products.get", undefined, { id })).item,
    getServiceStatus: () => call<ServiceStatusView>("service.status", undefined),
    getStorageStatus: async () => (await call<{ storage: StorageView }>("storage.status", undefined)).storage,
    describeInvalidation: (session) => call<InvalidationInfo>("invalidate.describe", session),
    invalidate: async (session) => (await call<{ result: InvalidationOutcome }>("invalidate", session)).result,
  };
}
