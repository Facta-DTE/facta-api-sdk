import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createFactaClient, type FactaClient, type FlowFailure, type IssueResult } from "../browser/index.ts";
import { ProviderLookContext, type FactaLook } from "./look.tsx";
import {
  FactaContext,
  useFactaContext,
  type FactaContextValue,
  type FactaEvent,
  type OpenWindowOptions,
} from "./use-issue.ts";
import { FactaInvoiceDialog, FactaInvoiceDrawer } from "./windows.tsx";

export interface FactaProviderProps extends FactaLook {
  /** URL of your handler (`createFactaHandler`), e.g. `/api/facta`. */
  endpoint?: string | undefined;
  fetch?: typeof fetch | undefined;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>) | undefined;
  /** Bring your own client instead of `endpoint`. */
  client?: FactaClient | undefined;
  /** Every window reports here too (analytics). */
  onEvent?: ((event: FactaEvent) => void) | undefined;
  children?: ReactNode;
}

/** `open()` settled without an issued document. */
export class FactaWindowError extends Error {
  override readonly name = "FactaWindowError";
  /** `closed`, `superseded` or the failure's error code. */
  readonly code: string;
  readonly failure: FlowFailure | undefined;
  constructor(code: string, failure?: FlowFailure) {
    super(failure?.explanation ?? code);
    this.code = code;
    this.failure = failure;
  }
}

interface WindowRequest extends OpenWindowOptions {
  session: string;
  variant: "dialog" | "drawer";
  open: boolean;
}

interface Pending {
  resolve(result: IssueResult): void;
  reject(error: FactaWindowError): void;
  settled: boolean;
  /** `auto-close` resolves when the window closes, so the host can then show the result. */
  deferred: boolean;
  result: IssueResult | undefined;
  lastError: FlowFailure | undefined;
}

export function FactaProvider(props: FactaProviderProps) {
  const { endpoint, fetch: fetchImpl, headers, client: given, onEvent, children, ...look } = props;
  const client = useMemo(() => {
    if (given) return given;
    if (!endpoint) return null;
    return createFactaClient({
      endpoint,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      ...(headers ? { headers } : {}),
    });
  }, [given, endpoint, fetchImpl, headers]);

  const [request, setRequest] = useState<WindowRequest | null>(null);
  const pending = useRef<Pending | null>(null);

  const openWindow = useCallback<NonNullable<FactaContextValue["openWindow"]>>((session, options) =>
    new Promise<IssueResult>((resolve, reject) => {
      pending.current?.reject(new FactaWindowError("superseded"));
      pending.current = {
        resolve,
        reject,
        settled: false,
        deferred: options?.run === "auto-close",
        result: undefined,
        lastError: undefined,
      };
      setRequest({ ...options, session, variant: options?.variant ?? "dialog", open: true });
    }), []);

  const value = useMemo<FactaContextValue>(() => ({ client, onEvent, openWindow }), [client, onEvent, openWindow]);

  const onIssued = useCallback((result: IssueResult) => {
    const p = pending.current;
    if (!p || p.settled) return;
    p.result = result;
    if (!p.deferred) {
      p.settled = true;
      p.resolve(result);
    }
  }, []);
  const onError = useCallback((error: FlowFailure) => {
    if (pending.current) pending.current.lastError = error;
  }, []);
  const onOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setRequest((r) => (r ? { ...r, open: false } : r));
    const p = pending.current;
    pending.current = null;
    if (!p || p.settled) return;
    p.settled = true;
    if (p.result) p.resolve(p.result);
    else p.reject(new FactaWindowError(p.lastError?.code ?? "closed", p.lastError));
  }, []);

  const Layer = request?.variant === "drawer" ? FactaInvoiceDrawer : FactaInvoiceDialog;
  return (
    <FactaContext.Provider value={value}>
      <ProviderLookContext.Provider value={look}>
        {children}
        {request && (
          <Layer
            session={request.session}
            run={request.run}
            autoCloseDelay={request.autoCloseDelay}
            autoCloseOn={request.autoCloseOn}
            open={request.open}
            onOpenChange={onOpenChange}
            onIssued={onIssued}
            onError={onError}
          />
        )}
      </ProviderLookContext.Provider>
    </FactaContext.Provider>
  );
}

/**
 * Imperative opening from anywhere under the provider:
 * `const { open } = useFactaWindow(); const result = await open(session)`.
 * With `run: "manual"` or `"auto"` it resolves when the document is sealed or in
 * contingency (the window stays open for the person to read it); with
 * `"auto-close"` it resolves with the same result once the window has closed.
 * It rejects with `FactaWindowError` if the window
 * closes without a document.
 */
export function useFactaWindow(): {
  open: (session: string, options?: OpenWindowOptions) => Promise<IssueResult>;
} {
  const ctx = useFactaContext();
  if (!ctx.openWindow) throw new Error("useFactaWindow must be used under a <FactaProvider>.");
  return { open: ctx.openWindow };
}
