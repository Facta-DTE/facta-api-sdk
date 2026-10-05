// The issuance state machine (docs/react-signing-ui.md §4, simplified).
//
// Framework-free: React's `useFactaIssue`, a Vue composable or plain DOM code
// all drive this same object. The window never edits the document: the data
// comes from the integrator's system through a session. States:
//
//   loading -> review -> issuing -> (verifying) -> sealed | contingency |
//   rejected | failed | expired
//
// With `run: "auto"` or `"auto-close"` the review step is skipped and issuing
// starts as soon as the session loads (point-of-sale use). Closing after the
// result is the window's job, not the machine's.
//
// Fiscal-safety rules the machine owns:
//  * an uncertain outcome (no usable answer after something was sent) never
//    leads to «try again» with a fresh request. The SAME session is re-sent up
//    to `maxResends` times (the idempotency key rides inside it, so the API
//    answers with the same document), then `status` is asked;
//  * «try again» is offered only for a definitive failure that says nothing
//    was spent;
//  * contingency is a success, not an error;
//  * storage trouble never changes a fiscal result.

import { FactaClientError, type FactaClient } from "./client.ts";
import { describeFields, type FieldIssue } from "./fields.ts";
import { explainError, esMessages, type FactaMessages } from "./messages.es.ts";
import type { IssueSummary, SessionInfo, SpentInfo, StatusSummary } from "./wire.ts";

export type FlowStep =
  | "loading"
  | "review"
  | "issuing"
  | "verifying"
  | "sealed"
  | "contingency"
  | "rejected"
  | "failed"
  | "expired";

/** `manual`: review then click. `auto`: issue on open. `auto-close`: issue on open, close after. */
export type RunMode = "manual" | "auto" | "auto-close";

export type IssuePhase = "preparing" | "signing" | "sending";

export interface FlowFailure {
  /** Server or local error code. */
  code: string;
  /** Spanish explanation keyed by `code`. */
  explanation: string;
  /** The server's own message, for the small technical line. */
  message: string;
  retryable: boolean;
  spent: SpentInfo | null;
  /** Hacienda's words, verbatim. */
  observaciones: string[];
  /** Fields the error points at, with readable labels. */
  fields: FieldIssue[];
  /** The outcome could not be confirmed: never offer a fresh retry. */
  uncertain: boolean;
  /** «Intentar de nuevo» is allowed: retryable, nothing spent, outcome known. */
  canRetry: boolean;
}

export interface FlowState {
  step: FlowStep;
  info: SessionInfo | null;
  phase: IssuePhase | null;
  /** Which resend of the verification loop is running (0 = none yet). */
  attempt: number;
  maxAttempts: number;
  result: IssueSummary | null;
  error: FlowFailure | null;
}

export interface IssueFlowOptions {
  client: FactaClient;
  session: string;
  messages?: FactaMessages;
  /** Default `"manual"`. Any other value issues as soon as the session loads. */
  run?: RunMode;
  /** Resends of the same session before falling back to `status`. Default 2. */
  maxResends?: number;
  /** Wait before each resend/status. Default 1500 ms. */
  verifyDelayMs?: number;
  /** When «signing» and «sending» are highlighted while one call is pending. */
  phaseDelaysMs?: [number, number];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface IssueFlow {
  getState(): FlowState;
  subscribe(listener: (state: FlowState) => void): () => void;
  /** Loads the session. Calling it again retries a failed load. */
  start(): Promise<void>;
  /** The primary action of the review step: issue. */
  next(): Promise<void>;
  /** «Intentar de nuevo»: only when `state.error.canRetry`. */
  retry(): Promise<void>;
  destroy(): void;
}

const UNCERTAIN_CODES = new Set(["network_error", "idempotency_in_flight", "operation_outcome_unknown"]);
const EXPIRED_CODES = new Set(["session_expired", "session_invalid"]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function initialFlowState(maxAttempts = 2): FlowState {
  return { step: "loading", info: null, phase: null, attempt: 0, maxAttempts, result: null, error: null };
}

export function createIssueFlow(options: IssueFlowOptions): IssueFlow {
  const messages = options.messages ?? esMessages;
  const maxResends = options.maxResends ?? 2;
  const verifyDelay = options.verifyDelayMs ?? 1500;
  const [signingAfter, sendingAfter] = options.phaseDelaysMs ?? [900, 1900];
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const { client, session } = options;

  let state = initialFlowState(maxResends);
  const listeners = new Set<(s: FlowState) => void>();
  let destroyed = false;
  let lastAction: "describe" | "issue" = "describe";
  let timers: ReturnType<typeof setTimeout>[] = [];
  let busy = false;

  function set(patch: Partial<FlowState>) {
    if (destroyed) return;
    state = { ...state, ...patch };
    for (const l of [...listeners]) l(state);
  }

  function stopPhases() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function startPhases() {
    stopPhases();
    set({ step: "issuing", phase: "preparing" });
    timers.push(setTimeout(() => set({ phase: "signing" }), signingAfter));
    timers.push(setTimeout(() => set({ phase: "sending" }), sendingAfter));
  }

  type Failure = FlowFailure & { expired: boolean; rejected: boolean; statusToken?: string };

  function toFailure(error: unknown): Failure {
    const e = error instanceof FactaClientError
      ? error
      : new FactaClientError({
        code: "network_error",
        message: error instanceof Error ? error.message : "unknown error",
        status: 0,
        retryable: true,
        transport: true,
      });
    const spent: SpentInfo | null = typeof e.spent === "object" && e.spent !== null
      ? e.spent
      : e.spent === true
      ? {}
      : null;
    const uncertain = e.transport || UNCERTAIN_CODES.has(e.code) ||
      (e.status >= 500 && e.spent !== false && e.code !== "mh_rejected");
    return {
      code: e.code,
      explanation: explainError(e.code, messages),
      message: e.message,
      retryable: e.retryable,
      spent,
      observaciones: e.observaciones,
      fields: describeFields(e.fields, messages),
      uncertain,
      canRetry: !uncertain && e.retryable && !e.wasSpent,
      ...(e.statusToken ? { statusToken: e.statusToken } : {}),
      expired: EXPIRED_CODES.has(e.code),
      rejected: e.code === "mh_rejected",
    };
  }

  function applyFailure(failure: Failure) {
    stopPhases();
    const { expired, rejected, statusToken: _t, ...error } = failure;
    set({ step: expired ? "expired" : rejected ? "rejected" : "failed", phase: null, error });
  }

  function applyResult(result: IssueSummary) {
    stopPhases();
    if ("statusToken" in result) {
      const { statusToken: _t, ...rest } = result;
      result = rest;
    }
    if (result.estado === "sellado") return set({ step: "sealed", phase: null, result, error: null });
    if (result.estado === "contingencia") return set({ step: "contingency", phase: null, result, error: null });
    applyFailure(toFailure(new FactaClientError({
      code: "internal_error", message: "unexpected result", status: 200, retryable: false, transport: false,
    })));
  }

  /** Returns false when the status says the outcome is still unknown. */
  function applyStatus(s: StatusSummary): boolean {
    const base: IssueSummary = {
      estado: s.estado === "contingencia" ? "contingencia" : "sellado",
      codigoGeneracion: s.codigoGeneracion,
      numeroControl: s.numeroControl,
      tipoDte: s.tipoDte,
      ambiente: s.ambiente,
      fecEmi: s.fecEmi,
      ...(s.horEmi ? { horEmi: s.horEmi } : {}),
      ...(s.selloRecibido ? { selloRecibido: s.selloRecibido } : {}),
      ...(s.observaciones ? { observaciones: s.observaciones } : {}),
      ...(s.totales ? { totales: s.totales } : {}),
    };
    if (s.estado === "sellado" || s.estado === "contingencia") {
      applyResult(base);
      return true;
    }
    if (s.estado === "rechazado") {
      applyFailure(toFailure(new FactaClientError({
        code: "mh_rejected", message: "rejected", status: 422, retryable: false, transport: false,
        spent: { codigoGeneracion: s.codigoGeneracion, numeroControl: s.numeroControl },
        observaciones: s.observaciones,
      })));
      return true;
    }
    return false;
  }

  /** Uncertain outcome: same session again, then `status`. Never a fresh retry. */
  async function verify(first: Failure) {
    stopPhases();
    set({ step: "verifying", phase: null, attempt: 0, error: null });
    let last = first;
    for (let i = 1; i <= maxResends; i++) {
      await sleep(verifyDelay);
      if (destroyed) return;
      set({ attempt: i });
      try {
        applyResult(await client.issue(session));
        return;
      } catch (error) {
        last = toFailure(error);
        if (!last.uncertain) return applyFailure(last);
      }
    }
    // `status` needs both the document and the token the handler minted for it.
    const withToken = [last, first].find((x) => x.spent?.codigoGeneracion && x.statusToken);
    const cg = withToken?.spent?.codigoGeneracion;
    const token = withToken?.statusToken;
    if (cg && token) {
      await sleep(verifyDelay);
      if (destroyed) return;
      try {
        if (applyStatus(await client.status(session, cg, token))) return;
      } catch (error) {
        const f = toFailure(error);
        if (!f.uncertain) return applyFailure(f);
      }
    }
    // Still unknown: say so, and do not offer to start over.
    const { expired: _e, rejected: _r, statusToken: _t, ...error } = last;
    set({ step: "failed", phase: null, error: { ...error, uncertain: true, canRetry: false } });
  }

  async function issue() {
    if (busy || destroyed) return;
    busy = true;
    lastAction = "issue";
    set({ error: null, attempt: 0 });
    startPhases();
    try {
      applyResult(await client.issue(session));
    } catch (error) {
      const failure = toFailure(error);
      if (failure.uncertain) await verify(failure);
      else applyFailure(failure);
    } finally {
      stopPhases();
      busy = false;
    }
  }

  async function start() {
    if (destroyed || busy) return;
    busy = true;
    lastAction = "describe";
    set({ step: "loading", error: null });
    let proceed = false;
    try {
      const info = await client.describe(session);
      set({ info });
      if (Date.parse(info.expiresAt) <= now()) {
        applyFailure(toFailure(new FactaClientError({
          code: "session_expired", message: "expired", status: 401, retryable: false, transport: false,
        })));
      } else {
        set({ step: "review" });
        proceed = (options.run ?? "manual") !== "manual";
      }
    } catch (error) {
      applyFailure(toFailure(error));
    } finally {
      busy = false;
    }
    if (proceed) await issue();
  }

  const flow: IssueFlow = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    async next() {
      if (state.step === "review") await issue();
    },
    async retry() {
      if (!state.error?.canRetry) return;
      if (lastAction === "describe") return start();
      return issue();
    },
    destroy() {
      destroyed = true;
      stopPhases();
      listeners.clear();
    },
  };
  return flow;
}
