// A small stale-while-revalidate cache for the data hooks. Per key it keeps the
// last value, dedupes requests in flight and tells subscribers when something
// changed. No external query library, no timers: callers decide when to refetch.

export interface CacheEntry<T = unknown> {
  data: T | undefined;
  error: unknown;
  /** Epoch ms of the last successful fetch. */
  updatedAt: number;
  fetching: boolean;
}

type Listener = () => void;

export interface FactaCache {
  /** The current entry, or undefined when the key was never fetched. */
  get<T>(key: string): CacheEntry<T> | undefined;
  /**
   * Fetch and store. A second call for the same key while one is in flight
   * shares its promise. Rejects with the fetcher's error (also stored in the entry).
   */
  fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  /** Fetch only when the entry is missing or older than `staleMs`; resolves with whatever is there. */
  revalidate<T>(key: string, fetcher: () => Promise<T>, staleMs: number): Promise<T | undefined>;
  subscribe(key: string, listener: Listener): () => void;
  /** Drop every key that starts with `prefix` (keys that are subscribed refetch on their next read). */
  invalidate(prefix?: string): void;
  /** Overwrite a value (e.g. after an action returned a fresher one). */
  set<T>(key: string, data: T): void;
}

export function createFactaCache(now: () => number = Date.now): FactaCache {
  const entries = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<Listener>>();

  function notify(key: string) {
    for (const listener of [...(listeners.get(key) ?? [])]) listener();
  }
  function patch(key: string, change: Partial<CacheEntry>) {
    const prev = entries.get(key) ?? { data: undefined, error: undefined, updatedAt: 0, fetching: false };
    entries.set(key, { ...prev, ...change });
    notify(key);
  }

  const cache: FactaCache = {
    get: <T>(key: string) => entries.get(key) as CacheEntry<T> | undefined,
    fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const running = inflight.get(key);
      if (running) return running as Promise<T>;
      patch(key, { fetching: true });
      const promise = (async () => {
        try {
          const data = await fetcher();
          patch(key, { data, error: undefined, updatedAt: now(), fetching: false });
          return data;
        } catch (error) {
          patch(key, { error, fetching: false });
          throw error;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    },
    async revalidate<T>(key: string, fetcher: () => Promise<T>, staleMs: number) {
      const entry = entries.get(key) as CacheEntry<T> | undefined;
      if (entry && entry.data !== undefined && now() - entry.updatedAt < staleMs) return entry.data;
      try {
        return await cache.fetch(key, fetcher);
      } catch {
        return entry?.data;
      }
    },
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
      };
    },
    invalidate(prefix = "") {
      for (const key of [...entries.keys()]) {
        if (!key.startsWith(prefix)) continue;
        const entry = entries.get(key)!;
        // Keep the data for display but make it stale, so the next read revalidates.
        entries.set(key, { ...entry, updatedAt: 0 });
        notify(key);
      }
    },
    set(key, data) {
      patch(key, { data, error: undefined, updatedAt: now() });
    },
  };
  return cache;
}
