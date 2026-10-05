// The eleven screens of the window. Each returns its body plus the footer
// actions, so the card, the drawer and the button's popover share one source.

import type { ReactNode } from "react";
import {
  fill,
  formatMoney,
  formatQuantity,
  lineAmount,
  type FlowState,
  type SessionInfo,
} from "../browser/index.ts";
import { DocIcon, Spinner } from "./icons.tsx";
import { useCfg } from "./look.tsx";
import { ContingencyContent, ExpiredIcon, FailureContent, SealedContent, Stepper, type Tone } from "./parts.tsx";

export interface ScreenAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ScreenDescriptor {
  title: string;
  tone: Tone;
  body: ReactNode;
  primary?: ScreenAction;
  secondary?: ScreenAction;
}

export interface ScreenHandlers {
  onNext: () => void;
  onRetry: () => void;
  /** Present when the host can close the window; `Listo`/`Cerrar` need it. */
  onClose?: (() => void) | undefined;
}

function LoadingBody() {
  const { cx } = useCfg();
  return (
    <div className={cx("facta-skeleton")} aria-busy="true" aria-live="polite">
      <span className="facta-sr">…</span>
      <span className="facta-sk facta-sk--ctx" />
      <span className="facta-sk facta-sk--rec" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="facta-sk-row">
          <div className="facta-sk-col">
            <span className="facta-sk facta-sk--l1" />
            <span className="facta-sk facta-sk--l2" />
          </div>
          <span className="facta-sk facta-sk--amt" />
        </div>
      ))}
      <div className="facta-sk-row">
        <span className="facta-sk facta-sk--lbl" />
        <span className="facta-sk facta-sk--total" />
      </div>
    </div>
  );
}

function ContextBlock({ info }: { info: SessionInfo }) {
  const { messages } = useCfg();
  const { draft, display } = info;
  return (
    <div className="facta-block">
      <div className="facta-meta">
        <span className="facta-doctype"><DocIcon size={20} />{messages.docTypes[draft.tipoDte]}</span>
        {display?.reference && <span className="facta-ref">{fill(messages.review.reference, { reference: display.reference })}</span>}
      </div>
      {display?.title && <div className="facta-sub">{display.title}</div>}
    </div>
  );
}

function ReviewBody({ info }: { info: SessionInfo }) {
  const { messages, sp } = useCfg();
  const m = messages.review;
  const { draft, display } = info;
  const receptor = draft.receptor;
  const hasReceptor = Boolean(receptor && (receptor.nombre || receptor.numDocumento));
  return (
    <>
      <ContextBlock info={info} />
      <div className="facta-block">
        <span className="facta-label">{m.recipientHeading}</span>
        {hasReceptor
          ? (
            <>
              <div className="facta-rname">{receptor?.nombre}</div>
              {(receptor?.numDocumento || receptor?.correo) && (
                <div className="facta-sub">{[receptor?.numDocumento, receptor?.correo].filter(Boolean).join(" · ")}</div>
              )}
            </>
          )
          : <div className="facta-rname">{m.finalConsumer}</div>}
      </div>
      <ul className="facta-lines" aria-label={m.linesHeading}>
        {draft.items.map((item, i) => {
          const amount = lineAmount(item.cantidad, item.precioUni);
          return (
            <li key={i} className="facta-line">
              <span className="facta-line-main">
                <span className="facta-line-desc">{item.descripcion ?? "—"}</span>
                <span className="facta-line-sub">{formatQuantity(item.cantidad)} × {formatMoney(item.precioUni)}</span>
              </span>
              <span className="facta-line-amount">{amount === null ? "—" : formatMoney(amount)}</span>
            </li>
          );
        })}
      </ul>
      {typeof display?.total === "number" && (
        <div className="facta-totalrow">
          <span className="facta-totalrow-label">{m.total}</span>
          <b {...sp("total", "facta-total")}>{formatMoney(display.total)}</b>
        </div>
      )}
      <p className="facta-note">{m.totalNote}</p>
    </>
  );
}

function IssuingBody({ state }: { state: FlowState }) {
  const { messages } = useCfg();
  const order = ["preparing", "signing", "sending"] as const;
  const n = state.phase ? order.indexOf(state.phase) + 1 : 1;
  const label = messages.issuing.steps[order[n - 1]!];
  return (
    <>
      {state.info && <ContextBlock info={state.info} />}
      <Stepper phase={state.phase} />
      <p className="facta-note facta-note--center">{messages.issuing.takesAFewSeconds} {messages.issuing.doNotClose}</p>
      <div className="facta-sr" role="status" aria-live="polite">{fill(messages.issuing.status, { n, label })}</div>
    </>
  );
}

function VerifyingBody({ state }: { state: FlowState }) {
  const { messages } = useCfg();
  return (
    <>
      {state.info && <ContextBlock info={state.info} />}
      <Stepper phase="sending" />
      <div className="facta-live" role="status" aria-live="polite">
        <span className="facta-live-icon"><Spinner size={20} /></span>
        <span>{messages.verifying.body}</span>
      </div>
      {state.attempt > 0 && (
        <p className="facta-note facta-note--center">
          {fill(messages.verifying.attempt, { n: state.attempt, total: state.maxAttempts })}
        </p>
      )}
    </>
  );
}

function ExpiredBody() {
  const { messages } = useCfg();
  return (
    <div className="facta-hero">
      <ExpiredIcon />
      <h3 className="facta-headline">{messages.expired.headline}</h3>
      <p className="facta-hero-text">{messages.expired.body}</p>
    </div>
  );
}

export function useScreen(state: FlowState, handlers: ScreenHandlers, showStorage: boolean): ScreenDescriptor {
  const { messages } = useCfg();
  const { onNext, onRetry, onClose } = handlers;
  const t = messages.title;
  const close = (label: string): ScreenAction | undefined => (onClose ? { label, onClick: onClose } : undefined);
  const withClose = (label: string) => {
    const a = close(label);
    return a ? { primary: a } : {};
  };

  switch (state.step) {
    case "loading":
      return { title: t.loading, tone: "neutral", body: <LoadingBody /> };
    case "review": {
      const cancel = close(messages.review.cancel);
      return {
        title: t.review,
        tone: "neutral",
        body: state.info ? <ReviewBody info={state.info} /> : <LoadingBody />,
        primary: { label: messages.review.issue, onClick: onNext },
        ...(cancel ? { secondary: cancel } : {}),
      };
    }
    case "issuing":
      return { title: t.issuing, tone: "neutral", body: <IssuingBody state={state} /> };
    case "verifying":
      return { title: t.verifying, tone: "neutral", body: <VerifyingBody state={state} /> };
    case "sealed":
      return {
        title: t.sealed,
        tone: "success",
        body: state.result ? <SealedContent result={state.result} showStorage={showStorage} /> : null,
        ...withClose(messages.sealed.done),
      };
    case "contingency":
      return {
        title: t.contingency,
        tone: "warning",
        body: state.result ? <ContingencyContent result={state.result} showStorage={showStorage} /> : null,
        ...withClose(messages.sealed.done),
      };
    case "rejected":
      return {
        title: t.rejected,
        tone: "danger",
        body: state.error ? <FailureContent error={state.error} kind="rejected" /> : null,
        ...withClose(messages.rejected.close),
      };
    case "failed": {
      const closeAction = close(messages.failed.close);
      const retry: ScreenAction | undefined = state.error?.canRetry
        ? { label: messages.failed.retry, onClick: onRetry }
        : undefined;
      return {
        title: t.failed,
        tone: state.error?.uncertain ? "warning" : "danger",
        body: state.error ? <FailureContent error={state.error} kind="failed" /> : null,
        ...(retry ? { primary: retry, ...(closeAction ? { secondary: closeAction } : {}) } : closeAction ? { primary: closeAction } : {}),
      };
    }
    case "expired":
      return { title: t.expired, tone: "neutral", body: <ExpiredBody />, ...withClose(messages.expired.close) };
  }
}
