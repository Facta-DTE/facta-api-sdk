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
import { Spinner } from "./icons.tsx";
import { useCfg } from "./look.tsx";
import { ContingencyContent, FailureContent, SealedContent, StampSeal, Stepper, type Tone } from "./parts.tsx";

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
      <div className="facta-sk facta-sk--chip" />
      <div className="facta-sk facta-sk--line facta-sk--w60" />
      <div className="facta-sk facta-sk--line facta-sk--w40" />
      <div className="facta-sk facta-sk--block" />
      <div className="facta-sk facta-sk--line" />
      <div className="facta-sk facta-sk--line facta-sk--w80" />
      <div className="facta-sk facta-sk--total" />
    </div>
  );
}

function ReviewBody({ info }: { info: SessionInfo }) {
  const { cx, messages } = useCfg();
  const m = messages.review;
  const { draft, display } = info;
  const receptor = draft.receptor;
  const hasReceptor = Boolean(receptor && (receptor.nombre || receptor.numDocumento));
  return (
    <div className={cx("facta-review")}>
      <div className={cx("facta-doc-head")}>
        <span className={cx("facta-doctype")}>{messages.docTypes[draft.tipoDte]}</span>
        {display?.reference && <span className={cx("facta-ref")}>{fill(m.reference, { reference: display.reference })}</span>}
      </div>
      {display?.title && <p className={cx("facta-text facta-text--small")}>{display.title}</p>}
      <section className={cx("facta-block")}>
        <h3 className={cx("facta-label")}>{m.recipientHeading}</h3>
        {hasReceptor
          ? (
            <p className={cx("facta-receptor")}>
              <strong>{receptor?.nombre}</strong>
              {(receptor?.numDocumento || receptor?.correo) && (
                <span>{[receptor?.numDocumento, receptor?.correo].filter(Boolean).join(" · ")}</span>
              )}
            </p>
          )
          : <p className={cx("facta-receptor")}><strong>{m.finalConsumer}</strong></p>}
      </section>
      <section className={cx("facta-block")}>
        <h3 className={cx("facta-label")}>{m.linesHeading}</h3>
        <ul className={cx("facta-lines")}>
          {draft.items.map((item, i) => {
            const amount = lineAmount(item.cantidad, item.precioUni);
            return (
              <li key={i}>
                <span className="facta-line-main">
                  <span className="facta-line-desc">{item.descripcion ?? "—"}</span>
                  <span className="facta-line-sub">
                    {formatQuantity(item.cantidad)} × {formatMoney(item.precioUni)}
                  </span>
                </span>
                <span className="facta-amount">{amount === null ? "—" : formatMoney(amount)}</span>
              </li>
            );
          })}
        </ul>
      </section>
      {typeof display?.total === "number" && (
        <div className={cx("facta-total")}>
          <span>{m.total}</span>
          <strong className="facta-amount facta-amount--lg">{formatMoney(display.total)}</strong>
        </div>
      )}
      <p className={cx("facta-text facta-text--small facta-note")}>{m.totalNote}</p>
    </div>
  );
}

function IssuingBody({ state }: { state: FlowState }) {
  const { cx, messages } = useCfg();
  const order = ["preparing", "signing", "sending"] as const;
  const n = state.phase ? order.indexOf(state.phase) + 1 : 1;
  const label = messages.issuing.steps[order[n - 1]!];
  return (
    <div className={cx("facta-progress")}>
      <Stepper phase={state.phase} />
      <p className={cx("facta-text facta-text--small facta-note")}>{messages.issuing.doNotClose}</p>
      <div className="facta-sr" role="status" aria-live="polite">{fill(messages.issuing.status, { n, label })}</div>
    </div>
  );
}

function VerifyingBody({ state }: { state: FlowState }) {
  const { cx, messages } = useCfg();
  return (
    <div className={cx("facta-progress facta-progress--verifying")}>
      <div className={cx("facta-verify-spin")}><Spinner size={34} /></div>
      <p className={cx("facta-text facta-text--center")} role="status" aria-live="polite">{messages.verifying.body}</p>
      {state.attempt > 0 && (
        <p className={cx("facta-text facta-text--small facta-text--center")}>
          {fill(messages.verifying.attempt, { n: state.attempt, total: state.maxAttempts })}
        </p>
      )}
    </div>
  );
}

function ExpiredBody() {
  const { cx, messages } = useCfg();
  return (
    <div className={cx("facta-result")}>
      <div className={cx("facta-hero")}>
        <StampSeal tone="neutral" />
        <h3 className={cx("facta-headline")}>{messages.expired.headline}</h3>
        <p className={cx("facta-text")}>{messages.expired.body}</p>
      </div>
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
        body: state.error ? <FailureContent error={state.error} kind="rejected" showHeadline={false} /> : null,
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
