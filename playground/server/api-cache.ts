// The playground key has its own rate limit at the API (60 requests/hour and 300/day for every call
// except `/v1/status`), shared by all visitors. Reads must therefore be rare: this file is the cache
// that keeps them rare. It lives in a Durable Object, so every Worker isolate and every visitor sees
// the same answers.
//
//   documents  a document in a final state (sellado, invalidado, rechazado) is never fetched again;
//              a pending one at most once per 60 s
//   catalog    a search or a lookup, per query, for 5 minutes
//   status     `/v1/status` (it has a larger window of its own), at most once per 60 s for everyone
//
// The cache holds API answers only (states, catalog labels): no keys, no files, no tokens.

import type { DurableObjectNamespaceLike } from "./env.ts";

export const FINAL_STATES = ["sellado", "invalidado", "rechazado"] as const;
export const FINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_TTL_MS = 60_000;
export const CATALOG_TTL_MS = 5 * 60_000;
export const STATUS_TTL_MS = 60_000;
/** After the API answered `rate_limited`, reads are refused locally for this long (unless it said how long). */
export const RATE_LIMIT_PAUSE_MS = 60_000;

const STORAGE_KEY = "apicache";
const MAX_ENTRIES = 300;

export const isFinalState = (estado: unknown): boolean => typeof estado === "string" && (FINAL_STATES as readonly string[]).includes(estado);

interface Entry { v: unknown; exp: number; at: number }
type Table = Record<string, Entry>;

/** The slice of Durable Object storage used here. */
export interface CacheStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/**
 * Serves `/cache/*` inside a Durable Object:
 *   POST /cache/get {key}               -> {hit: true, value, at} | {hit: false}
 *   POST /cache/put {key, value, ttlMs}
 *   POST /cache/del {key}
 *   POST /cache/many {keys}             -> {hits: {key: {value, at}}}   (one read for a whole page)
 */
export async function handleCacheRequest(storage: CacheStorage, request: Request, now: number): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  const body = (await request.json().catch(() => null)) as { key?: unknown; keys?: unknown; value?: unknown; ttlMs?: unknown } | null;
  const table = (await storage.get<Table>(STORAGE_KEY)) ?? {};
  if (url.pathname === "/cache/many") {
    const keys = Array.isArray(body?.keys) ? body!.keys.filter((k): k is string => typeof k === "string").slice(0, 60) : null;
    if (keys === null) return Response.json({ error: "bad_keys" }, { status: 400 });
    const hits: Record<string, { value: unknown; at: number }> = {};
    for (const key of keys) {
      const entry = table[key];
      if (entry !== undefined && entry.exp > now) hits[key] = { value: entry.v, at: entry.at };
    }
    return Response.json({ hits });
  }
  if (body === null || typeof body.key !== "string" || body.key === "" || body.key.length > 200) return Response.json({ error: "bad_key" }, { status: 400 });
  if (url.pathname === "/cache/get") {
    const entry = table[body.key];
    return Response.json(entry !== undefined && entry.exp > now ? { hit: true, value: entry.v, at: entry.at } : { hit: false });
  }
  if (url.pathname === "/cache/put") {
    const ttl = typeof body.ttlMs === "number" && body.ttlMs > 0 ? Math.min(body.ttlMs, FINAL_TTL_MS) : PENDING_TTL_MS;
    const next: Table = {};
    for (const [key, entry] of Object.entries(table)) if (entry.exp > now) next[key] = entry;
    next[body.key] = { v: body.value, exp: now + ttl, at: now };
    // Keep the freshest entries when the table grows too large.
    const keys = Object.keys(next);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.sort((a, b) => next[a]!.at - next[b]!.at).slice(0, keys.length - MAX_ENTRIES)) delete next[key];
    }
    await storage.put(STORAGE_KEY, next);
    return Response.json({ ok: true });
  }
  if (url.pathname === "/cache/del") {
    if (body.key in table) {
      delete table[body.key];
      await storage.put(STORAGE_KEY, table);
    }
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

// --- Worker side ------------------------------------------------------------------

export interface ApiCache {
  get<T>(key: string): Promise<{ value: T; at: number } | null>;
  /** Several keys of the same kind in ONE Durable Object call (a Worker has a small subrequest budget). */
  getMany<T>(keys: string[]): Promise<Map<string, { value: T; at: number }>>;
  put(key: string, value: unknown, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** A cache that remembers nothing (no Durable Object binding). */
export const NO_CACHE: ApiCache = { get: async () => null, getMany: async () => new Map(), put: async () => undefined, del: async () => undefined };

/**
 * The shared cache. One Durable Object per kind (`doc`, `catalog`, `meta`) so documents, catalog
 * answers and the status never queue behind each other.
 */
export function apiCacheOf(namespace: DurableObjectNamespaceLike | undefined): ApiCache {
  if (namespace === undefined) return NO_CACHE;
  const stubOf = (key: string) => {
    const kind = key.startsWith("doc:") ? "doc" : key.startsWith("cust") || key.startsWith("prod") ? "catalog" : "meta";
    return namespace.get(namespace.idFromName(`api-cache:${kind}`));
  };
  const call = async (key: string, path: string, payload: Record<string, unknown>) => {
    try {
      const response = await stubOf(key).fetch(new Request(`https://quota${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, ...payload }) }));
      return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
    } catch {
      // A broken cache must never break a read: the caller goes to the API.
      return null;
    }
  };
  return {
    async get<T>(key: string) {
      const answer = await call(key, "/cache/get", {});
      return answer !== null && answer.hit === true ? { value: answer.value as T, at: Number(answer.at) } : null;
    },
    async getMany<T>(keys: string[]) {
      const out = new Map<string, { value: T; at: number }>();
      if (keys.length === 0) return out;
      try {
        const response = await stubOf(keys[0]!).fetch(new Request("https://quota/cache/many", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys }) }));
        if (!response.ok) return out;
        const { hits } = (await response.json()) as { hits: Record<string, { value: T; at: number }> };
        for (const [key, hit] of Object.entries(hits)) out.set(key, hit);
      } catch {
        // Same rule as `get`: no cache, no problem.
      }
      return out;
    },
    async put(key, value, ttlMs) {
      await call(key, "/cache/put", { value, ttlMs });
    },
    async del(key) {
      await call(key, "/cache/del", {});
    },
  };
}
