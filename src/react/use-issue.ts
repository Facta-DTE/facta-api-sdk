import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createIssueFlow,
  initialFlowState,
  mergeMessages,
  type FactaClient,
  type FactaMessages,
  type FlowFailure,
  type FlowState,
  type IssueFlow,
  type IssueResult,
} from "../browser/index.ts";
import { ProviderLookContext } from "./look.tsx";

export type FactaEventType =
  | "opened"
  | "issuing"
  | "sealed"
  | "contingency"
  | "rejected"
  | "failed"
  | "expired"
  | "closed";

/** What the window tells the host, for analytics. Never contains fiscal files. */
export interface FactaEvent {
  type: FactaEventType;
  session: string;
  result?: IssueResult;
  error?: FlowFailure;
}

export interface FactaContextValue {
  client: FactaClient | null;
  onEvent?: ((event: FactaEvent) => void) | undefined;
  openWindow?: ((session: string, options?: { variant?: "dialog" | "drawer"; confirm?: boolean }) => Promise<IssueResult>) | undefined;
}

export const FactaContext = createContext<FactaContextValue>({ client: null });

export function useFactaContext(): FactaContextValue {
  return useContext(FactaContext);
}

export interface UseFactaIssueOptions {
  /** Show the review step first (default true). `false` issues immediately. */
  confirm?: boolean | undefined;
  /** Start only when true (default true). Turning it off destroys the flow. */
  enabled?: boolean | undefined;
  onIssued?: ((result: IssueResult) => void) | undefined;
  onError?: ((error: FlowFailure) => void) | undefined;
  onEvent?: ((event: FactaEvent) => void) | undefined;
  /** Use this client instead of the provider's. */
  client?: FactaClient | undefined;
  messages?: FactaMessages | undefined;
  /** Test hooks. */
  flowOptions?: { verifyDelayMs?: number; phaseDelaysMs?: [number, number]; sleep?: (ms: number) => Promise<void> } | undefined;
}

export interface UseFactaIssue {
  state: FlowState;
  /** Primary action of the review step: issue. */
  next(): void;
  retry(): void;
  /** Report a custom event (the windows use it for `closed`). */
  emit(type: FactaEventType, extra?: { result?: IssueResult; error?: FlowFailure }): void;
}

/** Headless hook over the issuance state machine. */
export function useFactaIssue(session: string, options: UseFactaIssueOptions = {}): UseFactaIssue {
  const ctx = useContext(FactaContext);
  const look = useContext(ProviderLookContext);
  const client = options.client ?? ctx.client;
  const enabled = options.enabled ?? true;
  const confirm = options.confirm ?? true;
  const [state, setState] = useState<FlowState>(() => initialFlowState());
  const flowRef = useRef<IssueFlow | null>(null);
  const latest = useRef({ options, ctx, session });
  latest.current = { options, ctx, session };
  const messages = useMemo(() => options.messages ?? mergeMessages(look.messages), [options.messages, look.messages]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const emit = useCallback<UseFactaIssue["emit"]>((type, extra) => {
    const { options: o, ctx: c, session: s } = latest.current;
    const event: FactaEvent = { type, session: s, ...extra };
    c.onEvent?.(event);
    o.onEvent?.(event);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(initialFlowState());
      return;
    }
    if (!client) {
      throw new Error("useFactaIssue needs a <FactaProvider endpoint=…> (or a `client` option).");
    }
    const flow = createIssueFlow({
      client,
      session,
      messages: messagesRef.current,
      confirm,
      ...options.flowOptions,
    });
    flowRef.current = flow;
    let lastStep = flow.getState().step;
    setState(flow.getState());
    emit("opened");
    const unsubscribe = flow.subscribe((next) => {
      setState(next);
      if (next.step === lastStep) return;
      lastStep = next.step;
      const { options: o } = latest.current;
      switch (next.step) {
        case "issuing":
          emit("issuing");
          break;
        case "sealed":
        case "contingency":
          emit(next.step, { result: next.result! });
          o.onIssued?.(next.result!);
          break;
        case "rejected":
        case "failed":
        case "expired":
          emit(next.step, { error: next.error! });
          o.onError?.(next.error!);
          break;
        default:
      }
    });
    void flow.start();
    return () => {
      unsubscribe();
      flow.destroy();
      flowRef.current = null;
    };
    // `options.flowOptions` is a test hook and intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session, enabled, confirm, emit]);

  const next = useCallback(() => void flowRef.current?.next(), []);
  const retry = useCallback(() => void flowRef.current?.retry(), []);
  return { state, next, retry, emit };
}
