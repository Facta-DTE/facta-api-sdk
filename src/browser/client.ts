// The browser half of the wire contract (docs/react-signing-ui.md §5).
//
// Speaks only to the implementer's own handler, with an opaque session token.
// No credential ever passes through here.

import type {
  Action,
  IssueSummary,
  SessionInfo,
  SpentInfo,
  StatusSummary,
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
  readonly transport: boolean;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
    spent?: SpentInfo | boolean | undefined;
    observaciones?: string[] | undefined;
    fields?: WireFieldIssue[] | undefined;
    transport: boolean;
  }) {
    super(init.message);
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.spent = init.spent;
    this.observaciones = init.observaciones ?? [];
    this.fields = init.fields ?? [];
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
  status(session: string, codigoGeneracion: string): Promise<StatusSummary>;
}

function transportError(message: string, status = 0): FactaClientError {
  return new FactaClientError({ code: "network_error", message, status, retryable: true, transport: true });
}

export function createFactaClient(options: FactaClientOptions): FactaClient {
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function call<T>(action: Action, session: string, extra: Record<string, unknown> = {}): Promise<T> {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const extraHeaders = typeof options.headers === "function" ? await options.headers() : options.headers;
    const headers = new Headers(extraHeaders);
    headers.set("content-type", "application/json");
    headers.set("x-facta-ui", "1");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    issue: async (session) => (await call<{ result: IssueSummary }>("issue", session)).result,
    status: async (session, codigoGeneracion) =>
      (await call<{ status: StatusSummary }>("status", session, { codigoGeneracion })).status,
  };
}
