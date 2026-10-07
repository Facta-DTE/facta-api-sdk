// How the catalog pickers search. Every search is an API read against the playground key's own rate
// limit (shared by all visitors), so the pickers wait for the person to stop typing and need two
// characters; the Worker also caches each query for five minutes (server/api-cache.ts).

export const CATALOG_SEARCH = { debounceMs: 350, minChars: 2 } as const;
