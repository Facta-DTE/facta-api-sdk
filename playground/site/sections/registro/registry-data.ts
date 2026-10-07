import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, enrichRegistry, loadRegistry, loadRegistryDetails, type RegistryDetail, type RegistryDocument } from "../../api.ts";
import { usePlayground } from "../../state.tsx";

// Shared by Inicio («Sus últimas facturas»), Registro and the receipt example: the visitor's own documents
// and what the API says about each one. Nothing here is invented: a value the server did not send reads «—».
// The pure helpers are in registry-rows.ts.

export * from "./registry-rows.ts";

export type Registry = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; documents: RegistryDocument[] };

/** Minimum time between two reads of the same document from this page (the server also caches). */
const ASK_AGAIN_MS = 60_000;

/**
 * Loads the registry once the visitor is signed in (the ledger only: no API call). `reload` re-reads it;
 * `enrich` asks the server about a few rows — the ones on screen — and merges what it learns.
 */
export function useRegistry(): { registry: Registry; reload(): Promise<void>; enrich(codes: string[], options?: { force?: boolean }): Promise<void>; signedIn: boolean } {
  const { view } = usePlayground();
  const signedIn = view.status === "ready" && view.state.visitor !== null;
  const [registry, setRegistry] = useState<Registry>({ status: "loading" });
  const asked = useRef(new Map<string, number>());
  const reload = useCallback(async () => {
    try {
      setRegistry({ status: "ready", documents: await loadRegistry() });
    } catch (error) {
      setRegistry({ status: "error", message: error instanceof ApiError ? error.message : "No se pudo leer su registro." });
    }
  }, []);
  const enrich = useCallback(async (codes: string[], options: { force?: boolean } = {}) => {
    const now = Date.now();
    const wanted = [...new Set(codes)].filter((code) => options.force === true || now - (asked.current.get(code) ?? 0) > ASK_AGAIN_MS).slice(0, 10);
    if (wanted.length === 0) return;
    for (const code of wanted) asked.current.set(code, now);
    try {
      const fresh = await enrichRegistry(wanted);
      setRegistry((current) => current.status !== "ready" ? current : {
        status: "ready",
        documents: current.documents.map((d) => fresh.find((f) => f.codigoGeneracion === d.codigoGeneracion) ?? d),
      });
    } catch {
      // A rate limit already raised the page banner (api.ts); anything else leaves the row as the ledger has it.
    }
  }, []);
  useEffect(() => { if (signedIn) void reload(); }, [signedIn, reload]);
  return { registry, reload, enrich, signedIn };
}

/**
 * The detail (receiver, concept, Archivo DTE) of the documents on screen, asked ten at a time and only once
 * per document. When the API does not support `include`, `supported` turns false and nothing else changes.
 */
export function useRegistryDetails(): { details: Map<string, RegistryDetail>; supported: boolean; load(codes: string[]): Promise<void> } {
  const [details, setDetails] = useState<Map<string, RegistryDetail>>(new Map());
  const [supported, setSupported] = useState(true);
  const asked = useRef(new Set<string>());
  const load = useCallback(async (codes: string[]) => {
    const wanted = [...new Set(codes)].filter((code) => !asked.current.has(code)).slice(0, 10);
    if (wanted.length === 0) return;
    for (const code of wanted) asked.current.add(code);
    try {
      const result = await loadRegistryDetails(wanted);
      if (!result.supported) {
        setSupported(false);
        return;
      }
      setDetails((current) => new Map([...current, ...result.documents.map((d) => [d.codigoGeneracion, d] as const)]));
    } catch {
      // A rate limit already raised the page banner (api.ts); the rows keep what the ledger has. Ask again next time.
      for (const code of wanted) asked.current.delete(code);
    }
  }, []);
  return { details, supported, load };
}

/**
 * Calls `onVisible` with the codes of the rows that scroll into view, a few at a time. Rows register with
 * `observe(code)(element)`. Without IntersectionObserver every registered row counts as visible.
 */
export function useVisibleRows(onVisible: (codes: string[]) => void): (code: string) => (element: HTMLElement | null) => void {
  const handler = useRef(onVisible);
  handler.current = onVisible;
  const state = useRef<{ observer: IntersectionObserver | null; codes: Map<Element, string>; batch: Set<string>; timer: ReturnType<typeof setTimeout> | undefined }>({ observer: null, codes: new Map(), batch: new Set(), timer: undefined });
  useEffect(() => {
    const current = state.current;
    return () => {
      current.observer?.disconnect();
      clearTimeout(current.timer);
    };
  }, []);
  return useCallback((code: string) => (element: HTMLElement | null) => {
    const current = state.current;
    if (element === null) return;
    const flush = () => {
      current.timer = undefined;
      const codes = [...current.batch];
      current.batch.clear();
      if (codes.length > 0) handler.current(codes);
    };
    const see = (seen: string) => {
      current.batch.add(seen);
      if (current.timer === undefined) current.timer = setTimeout(flush, 200);
    };
    if (typeof IntersectionObserver === "undefined") {
      see(code);
      return;
    }
    current.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const seen = current.codes.get(entry.target);
        if (entry.isIntersecting && seen !== undefined) see(seen);
      }
    }, { rootMargin: "120px" });
    if (!current.codes.has(element)) {
      current.codes.set(element, code);
      current.observer.observe(element);
    }
  }, []);
}
