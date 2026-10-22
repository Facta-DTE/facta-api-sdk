// A `Facta` client for the browser handler that spends as few API requests as possible
// (see api-cache.ts for why). It wraps the real client and only changes READS:
//
//   getDocumentStatus   cached; a final state is never asked again, a pending one once per 60 s
//   searchCustomers / searchProducts / getCustomer / getProduct   cached 5 minutes per query
//   status              cached 60 s for every visitor (the API's status route has a window of its own)
//   diagnose            removed: the handler then answers the service status from `status` alone,
//                       instead of one diagnosis per poll
//   listDocuments       the handler's «is there a contingency queue?» probe is answered without a call
//   invalidate*         evict the document, so the next read sees the new state
//
// Issuing, downloads and everything else pass through untouched. When the API answers
// `rate_limited`, reads are refused locally for a minute instead of hammering it.

import { FactaError } from "../../src/errors.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { apiCacheOf, CATALOG_TTL_MS, FINAL_TTL_MS, isFinalState, PENDING_TTL_MS, RATE_LIMIT_PAUSE_MS, STATUS_TTL_MS, type ApiCache } from "./api-cache.ts";

export const RATE_LIMIT_MESSAGE = "El playground alcanzó el límite de pruebas por hora; intente en unos minutos.";
const PAUSE_KEY = "meta:rate-limited";

export const documentKey = (code: string) => `doc:${code.toUpperCase()}`;

type AnyFn = (...args: never[]) => unknown;

export interface BudgetOptions {
  cache?: ApiCache;
  now?: () => number;
}

export function withApiBudget(inner: FactaLike, options: BudgetOptions & { namespace?: Parameters<typeof apiCacheOf>[0] } = {}): FactaLike {
  const cache = options.cache ?? apiCacheOf(options.namespace);
  const now = options.now ?? Date.now;

  /** Runs a real API read: refused while the API is rate limiting us, and it starts the pause when it does. */
  async function guarded<T>(fn: () => Promise<T>, { respectPause = true } = {}): Promise<T> {
    if (respectPause) {
      const paused = await cache.get<number>(PAUSE_KEY);
      if (paused !== null) throw new FactaError("rate_limited", RATE_LIMIT_MESSAGE, 429, { local: true });
    }
    try {
      return await fn();
    } catch (error) {
      if (error instanceof FactaError && error.code === "rate_limited") await cache.put(PAUSE_KEY, now(), RATE_LIMIT_PAUSE_MS);
      throw error;
    }
  }

  async function cached<T>(key: string, ttlOf: (value: T) => number, load: () => Promise<T>, respectPause = true): Promise<T> {
    const hit = await cache.get<T>(key);
    if (hit !== null) return hit.value;
    const value = await guarded(load, { respectPause });
    await cache.put(key, value, ttlOf(value));
    return value;
  }

  const overrides: Record<string, AnyFn> = {
    getDocumentStatus: ((code: string) =>
      cached(documentKey(code), (status: { estado?: unknown }) => (isFinalState(status?.estado) ? FINAL_TTL_MS : PENDING_TTL_MS), () => inner.getDocumentStatus(code))) as unknown as AnyFn,
    searchCustomers: ((query: string, searchOptions?: { limit?: number }) =>
      cached(`cust:${searchOptions?.limit ?? ""}:${query.trim().toLowerCase()}`, () => CATALOG_TTL_MS, () => inner.searchCustomers!(query, searchOptions as never))) as unknown as AnyFn,
    searchProducts: ((query: string, searchOptions?: { limit?: number }) =>
      cached(`prod:${searchOptions?.limit ?? ""}:${query.trim().toLowerCase()}`, () => CATALOG_TTL_MS, () => inner.searchProducts!(query, searchOptions as never))) as unknown as AnyFn,
    getCustomer: ((id: string) => cached(`cust-id:${id}`, () => CATALOG_TTL_MS, () => inner.getCustomer!(id))) as unknown as AnyFn,
    getProduct: ((id: string) => cached(`prod-id:${id}`, () => CATALOG_TTL_MS, () => inner.getProduct!(id))) as unknown as AnyFn,
    // `/v1/status` has its own, larger window at the API, so it ignores the local pause.
    status: (() => cached("meta:status", () => STATUS_TTL_MS, async () => {
      const full = await inner.status!();
      return { ok: full.ok } as typeof full;
    }, false)) as unknown as AnyFn,
    listDocuments: ((filters?: Record<string, unknown>) => {
      const keys = Object.keys(filters ?? {}).sort().join(",");
      // The handler's service status asks «is anything in contingency?» on every poll: not worth an API call.
      if (filters?.estado === "contingencia" && filters.limit === 1 && keys === "estado,limit") return Promise.resolve({ documentos: [] });
      return guarded(() => inner.listDocuments!(filters as never));
    }) as unknown as AnyFn,
  };
  for (const name of ["invalidate", "invalidateAndArchive"] as const) {
    const real = inner[name] as ((...args: unknown[]) => Promise<unknown>) | undefined;
    if (typeof real !== "function") continue;
    overrides[name] = (async (...args: unknown[]) => {
      const result = await real.apply(inner, args);
      const code = typeof args[0] === "string" ? args[0] : null;
      if (code !== null) await cache.del(documentKey(code));
      return result;
    }) as unknown as AnyFn;
  }

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "diagnose") return undefined;
      if (typeof prop === "string" && Object.hasOwn(overrides, prop) && typeof (target as Record<string, unknown>)[prop] === "function") return overrides[prop];
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as AnyFn).bind(target) : value;
    },
  });
}
