// Data hooks (docs/react-signing-ui.md §11): reads through the handler's
// `capabilities`, with a stale-while-revalidate cache shared by the provider.

import { useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import {
  base64ToBytes,
  FactaClientError,
  saveBlob,
  type CopyRow,
  type CustomerOption,
  type DocumentDetail,
  type DocumentFilters,
  type DocumentRow,
  type DownloadedFile,
  type DownloadKind,
  type FactaCache,
  type FactaDataClient,
  type InvalidationOutcome,
  type ProductOption,
  type ServiceState,
  type StorageRetryResult,
  type StorageView,
} from "../browser/index.ts";
import { FactaContext } from "./use-issue.ts";

export interface DataContext {
  client: FactaDataClient;
  cache: FactaCache;
  openInvalidation: ((session: string) => Promise<InvalidationOutcome>) | undefined;
}

/** The provider's data client and cache. Throws outside a provider with an `endpoint` or a data client. */
export function useDataContext(): DataContext {
  const ctx = useContext(FactaContext);
  const client = ctx.client as Partial<FactaDataClient> | null;
  if (!client || typeof client.listDocuments !== "function" || !ctx.cache) {
    throw new Error("Facta data hooks need a <FactaProvider endpoint=…> (or a client with the data methods).");
  }
  return { client: client as FactaDataClient, cache: ctx.cache, openInvalidation: ctx.openInvalidation };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export interface QueryState<T> {
  data: T | undefined;
  error: FactaClientError | Error | undefined;
  /** First load: nothing to show yet. */
  loading: boolean;
  /** A request is in flight (also while stale data is on screen). */
  refreshing: boolean;
  updatedAt: number;
  refresh(): Promise<void>;
}

interface QueryOptions {
  enabled?: boolean;
  staleMs?: number;
  /** Poll interval in ms, or null/undefined for none. Paused while the tab is hidden. */
  pollMs?: number | null | undefined;
}

/** Cached query: shows the last value at once and revalidates when it is older than `staleMs`. */
export function useCachedQuery<T>(key: string | null, fetcher: () => Promise<T>, options: QueryOptions = {}): QueryState<T> {
  const { cache } = useDataContext();
  const enabled = (options.enabled ?? true) && key !== null;
  const staleMs = options.staleMs ?? 15_000;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const visible = usePageVisible();

  useEffect(() => {
    if (!key) return;
    return cache.subscribe(key, rerender);
  }, [cache, key]);

  // `cache.invalidate` zeroes `updatedAt`; a mounted query then refetches on its own.
  const invalidated = key !== null && cache.get(key)?.updatedAt === 0 && cache.get(key)?.data !== undefined;
  useEffect(() => {
    if (!enabled || !key) return;
    void cache.revalidate(key, () => fetcherRef.current(), staleMs);
  }, [cache, key, enabled, staleMs, visible, invalidated]);

  const pollMs = options.pollMs ?? null;
  useEffect(() => {
    if (!enabled || !key || pollMs === null || !visible) return;
    const timer = setInterval(() => {
      void cache.fetch(key, () => fetcherRef.current()).catch(() => undefined);
    }, pollMs);
    return () => clearInterval(timer);
  }, [cache, key, enabled, pollMs, visible]);

  const entry = key ? cache.get<T>(key) : undefined;
  const refresh = useCallback(async () => {
    if (!key) return;
    await cache.fetch(key, () => fetcherRef.current()).then(() => undefined, () => undefined);
  }, [cache, key]);
  const data = entry?.data;
  const error = entry?.error as FactaClientError | Error | undefined;
  return {
    data,
    error,
    loading: enabled && data === undefined && error === undefined,
    refreshing: entry?.fetching === true || (enabled && entry === undefined),
    updatedAt: entry?.updatedAt ?? 0,
    refresh,
  };
}

// --- Documents ------------------------------------------------------------------

export interface UseFactaDocumentsOptions {
  /** Rows per request (1–100). Default 25. */
  pageSize?: number;
  /** How long a cached first page is shown without revalidating. Default 15 s. */
  staleMs?: number;
  enabled?: boolean;
}

export interface UseFactaDocuments {
  items: DocumentRow[];
  /** Rows loaded so far, before the local `buscar` filter. */
  loaded: number;
  loadMore(): Promise<void>;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: Error | undefined;
  refresh(): Promise<void>;
}

function serverFilters(filters: DocumentFilters): Omit<DocumentFilters, "buscar"> {
  const out: Record<string, unknown> = {};
  for (const key of ["desde", "hasta", "estado", "tipoDte"] as const) {
    if (filters[key]) out[key] = filters[key];
  }
  return out;
}

export function useFactaDocuments(filters: DocumentFilters = {}, options: UseFactaDocumentsOptions = {}): UseFactaDocuments {
  const { client } = useDataContext();
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const server = serverFilters(filters);
  const key = `docs:${JSON.stringify(server)}:${pageSize}`;
  const first = useCachedQuery(key, () => client.listDocuments({ ...server, limit: pageSize }), {
    staleMs: options.staleMs ?? 15_000,
    enabled: options.enabled ?? true,
  });
  const [more, setMore] = useState<{ key: string; stamp: number; rows: DocumentRow[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<Error | undefined>(undefined);
  const busy = useRef(false);

  const valid = more !== null && more.key === key && more.stamp === first.updatedAt;
  const cursor = valid ? more.cursor : first.data?.siguiente ?? null;
  const rows = [...(first.data?.documentos ?? []), ...(valid ? more.rows : [])];
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.codigoGeneracion) ? false : (seen.add(r.codigoGeneracion), true)));

  const loadMore = useCallback(async () => {
    if (busy.current || cursor === null) return;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(undefined);
    const stamp = first.updatedAt;
    const prev = valid ? more!.rows : [];
    try {
      const page = await client.listDocuments({ ...server, limit: pageSize, cursor });
      setMore({ key, stamp, rows: [...prev, ...page.documentos], cursor: page.siguiente });
    } catch (error) {
      setMoreError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, cursor, first.updatedAt, valid, more, pageSize]);

  const needle = filters.buscar?.trim().toLowerCase() ?? "";
  const items = needle === ""
    ? unique
    : unique.filter((r) => r.numeroControl.toLowerCase().includes(needle) || r.codigoGeneracion.toLowerCase().includes(needle));

  return {
    items,
    loaded: unique.length,
    loadMore,
    hasMore: cursor !== null,
    loading: first.loading,
    loadingMore,
    refreshing: first.refreshing,
    error: first.data === undefined ? first.error : moreError,
    refresh: first.refresh,
  };
}

export interface UseFactaDocumentOptions {
  /** Poll interval while the document is in contingency. Default 8 000 ms. */
  pollMs?: number;
  enabled?: boolean;
}

export function useFactaDocument(codigoGeneracion: string | null, options: UseFactaDocumentOptions = {}): QueryState<DocumentDetail> {
  const { client, cache } = useDataContext();
  const key = codigoGeneracion ? `doc:${codigoGeneracion}` : null;
  const peek = key ? cache.get<DocumentDetail>(key)?.data : undefined;
  const q = useCachedQuery(key, () => client.getDocument(codigoGeneracion!), {
    enabled: options.enabled ?? true,
    staleMs: 5_000,
    pollMs: peek?.estado === "contingencia" ? options.pollMs ?? 8_000 : null,
  });
  // When contingency resolves, lists showing the old state must refetch.
  const estado = q.data?.estado;
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (last.current === "contingencia" && estado !== undefined && estado !== "contingencia") cache.invalidate("docs:");
    last.current = estado;
  }, [estado, cache]);
  return q;
}

export function useFactaDocumentCopies(codigoGeneracion: string | null, options: { enabled?: boolean } = {}): QueryState<CopyRow[]> & { unavailable: boolean } {
  const { client } = useDataContext();
  const q = useCachedQuery(codigoGeneracion ? `copies:${codigoGeneracion}` : null, () => client.getDocumentCopies(codigoGeneracion!), {
    enabled: options.enabled ?? true,
    staleMs: 10_000,
  });
  const unavailable = q.error instanceof FactaClientError && (q.error.code === "action_not_allowed" || q.error.code === "storage_unsupported");
  return { ...q, unavailable };
}

// --- Catalog --------------------------------------------------------------------

export interface UseCatalogSearchOptions {
  /** Default 2. */
  minChars?: number;
  /** Default 250 ms. */
  debounceMs?: number;
  limit?: number;
  enabled?: boolean;
}

export interface CatalogSearch<T> {
  items: T[];
  /** A search is pending or running. */
  loading: boolean;
  error: Error | undefined;
  /** The debounced text actually searched. */
  query: string;
  /** The text is long enough to search. */
  ready: boolean;
  minChars: number;
}

function useCatalogSearch<T>(
  kind: "cust" | "prod",
  text: string,
  search: (client: FactaDataClient, query: string, limit: number) => Promise<T[]>,
  options: UseCatalogSearchOptions,
): CatalogSearch<T> {
  const { client } = useDataContext();
  const minChars = options.minChars ?? 2;
  const debounceMs = options.debounceMs ?? 250;
  const limit = options.limit ?? 10;
  const trimmed = text.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    if (trimmed === debounced) return;
    if (trimmed.length < minChars) {
      setDebounced(trimmed);
      return;
    }
    const timer = setTimeout(() => setDebounced(trimmed), debounceMs);
    return () => clearTimeout(timer);
  }, [trimmed, debounced, minChars, debounceMs]);
  const ready = debounced.length >= minChars;
  const q = useCachedQuery(ready ? `${kind}:${limit}:${debounced.toLowerCase()}` : null, () => search(client, debounced, limit), {
    enabled: (options.enabled ?? true) && ready,
    staleMs: 60_000,
  });
  const pending = trimmed.length >= minChars && trimmed !== debounced;
  return {
    items: ready ? q.data ?? [] : [],
    loading: pending || (ready && q.loading),
    error: ready ? q.error : undefined,
    query: debounced,
    ready,
    minChars,
  };
}

export function useFactaCustomers(query: string, options: UseCatalogSearchOptions = {}): CatalogSearch<CustomerOption> {
  return useCatalogSearch("cust", query, (c, q, limit) => c.searchCustomers(q, { limit }), options);
}

export function useFactaProducts(query: string, options: UseCatalogSearchOptions = {}): CatalogSearch<ProductOption> {
  return useCatalogSearch("prod", query, (c, q, limit) => c.searchProducts(q, { limit }), options);
}

// --- Status and storage ---------------------------------------------------------

export interface UseFactaServiceStatus {
  /** `null` until the first answer. */
  state: ServiceState | null;
  checkedAt: string | null;
  loading: boolean;
  error: Error | undefined;
  refresh(): Promise<void>;
}

/** Hacienda / Facta status, polled gently (default 60 s) and paused while the tab is hidden. */
export function useFactaServiceStatus(options: { pollMs?: number; enabled?: boolean } = {}): UseFactaServiceStatus {
  const { client } = useDataContext();
  const q = useCachedQuery("service", () => client.getServiceStatus(), {
    enabled: options.enabled ?? true,
    staleMs: 10_000,
    pollMs: options.pollMs ?? 60_000,
  });
  return {
    state: q.data?.state ?? (q.error ? "offline" : null),
    checkedAt: q.data?.checkedAt ?? null,
    loading: q.loading,
    error: q.error,
    refresh: q.refresh,
  };
}

export interface UseFactaStorage {
  storage: StorageView | undefined;
  loading: boolean;
  error: Error | undefined;
  refresh(): Promise<void>;
}

export function useFactaStorage(options: { staleMs?: number; enabled?: boolean } = {}): UseFactaStorage {
  const { client } = useDataContext();
  const q = useCachedQuery("storage", () => client.getStorageStatus(), {
    enabled: options.enabled ?? true,
    staleMs: options.staleMs ?? 30_000,
  });
  return { storage: q.data, loading: q.loading, error: q.error, refresh: q.refresh };
}

// --- Actions --------------------------------------------------------------------

/** Copy text with the async clipboard, falling back to a hidden textarea. */
export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch { /* the person can still select the text by hand */ }
    area.remove();
  }
}

export interface UseFactaActions {
  /** Fetch the file and hand it to the browser as a download. */
  download(codigoGeneracion: string, kind: DownloadKind, options?: { paperWidthMm?: number }): Promise<DownloadedFile>;
  /** Retry the managed copies of a document; refreshes the copies the detail shows. */
  retryStorage(codigoGeneracion: string): Promise<StorageRetryResult>;
  /** Open the invalidation dialog for a session made by your server. Rejects with `FactaWindowError` when closed without invalidating. */
  invalidate(sessionToken: string): Promise<InvalidationOutcome>;
  copyCode(value: string): Promise<void>;
}

export function useFactaActions(): UseFactaActions {
  const { client, cache, openInvalidation } = useDataContext();
  const download = useCallback<UseFactaActions["download"]>(async (code, kind, options) => {
    const file = await client.downloadDocument(code, kind, options);
    saveBlob(new Blob([base64ToBytes(file.base64)], { type: file.contentType }), file.filename);
    return file;
  }, [client]);
  const retryStorage = useCallback<UseFactaActions["retryStorage"]>(async (code) => {
    try {
      return await client.retryDocumentStorage(code);
    } finally {
      cache.invalidate(`copies:${code}`);
    }
  }, [client, cache]);
  const invalidate = useCallback<UseFactaActions["invalidate"]>((session) => {
    if (!openInvalidation) throw new Error("useFactaActions().invalidate needs a <FactaProvider>.");
    return openInvalidation(session);
  }, [openInvalidation]);
  return { download, retryStorage, invalidate, copyCode: copyText };
}
