// The compact point-of-sale button: it morphs from label to spinner (with the
// current phase) to a check, or to an error state. A small popover carries the
// result, the downloads and, for failures, the structured explanation.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FlowState, IssueResult } from "../browser/index.ts";
import { AlertIcon, ChevronIcon, CheckIcon, ClockIcon, CloseIcon, Spinner } from "./icons.tsx";
import { FactaRoot, useCfg, useResolvedLook, type FactaLook } from "./look.tsx";
import { ContingencyContent, FailureContent, SealedContent } from "./parts.tsx";
import { useFactaIssue, type FactaEvent } from "./use-issue.ts";
import { FactaInvoiceDialog, type FactaWindowProps } from "./windows.tsx";
import type { FlowFailure } from "../browser/index.ts";

export interface FactaIssueButtonProps extends FactaWindowProps {
  /** Button text before issuing. Default «Emitir factura». */
  label?: string | undefined;
  disabled?: boolean | undefined;
  /** Show the result popover (default true). */
  popover?: boolean | undefined;
  className?: string | undefined;
}

export interface IssueButtonViewProps {
  state: FlowState;
  /** False until the person pressed the button. */
  started: boolean;
  label?: string | undefined;
  disabled?: boolean | undefined;
  popover?: boolean | undefined;
  /** Force the popover open (gallery). */
  detailsOpen: boolean;
  onPress: () => void;
  onToggleDetails: () => void;
  onRetry: () => void;
  look?: FactaLook | undefined;
  className?: string | undefined;
}

type Kind = "idle" | "working" | "done" | "contingency" | "failed";

function kindOf(state: FlowState, started: boolean): Kind {
  if (!started) return "idle";
  switch (state.step) {
    case "sealed":
      return "done";
    case "contingency":
      return "contingency";
    case "rejected":
    case "failed":
    case "expired":
      return "failed";
    default:
      return "working";
  }
}

function ButtonInner({ view }: { view: IssueButtonViewProps }) {
  const { cx, messages, motion } = useCfg();
  const { state, started, popover = true, detailsOpen } = view;
  const kind = kindOf(state, started);
  const popoverId = useId();
  const contentRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const animate = motion === "full";

  useLayoutEffect(() => {
    const content = contentRef.current;
    const button = buttonRef.current;
    if (!content || !button || !animate || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const cs = getComputedStyle(button);
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      setWidth(Math.ceil(content.getBoundingClientRect().width + pad));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [animate, kind, state.phase, state.step]);

  const order = ["preparing", "signing", "sending"] as const;
  let text = view.label ?? messages.button.label;
  let icon = null as React.ReactNode;
  if (kind === "working") {
    icon = <Spinner size={18} />;
    text = state.step === "verifying"
      ? messages.title.verifying
      : state.step === "issuing" && state.phase
      ? messages.issuing.steps[order[order.indexOf(state.phase)]!]
      : messages.button.working;
  } else if (kind === "done") {
    icon = <CheckIcon size={18} strokeWidth={2.6} />;
    text = messages.button.done;
  } else if (kind === "contingency") {
    icon = <ClockIcon size={18} />;
    text = messages.button.contingency;
  } else if (kind === "failed") {
    icon = <AlertIcon size={18} />;
    text = messages.button.failed;
  }

  const toggle = view.onToggleDetails;
  const open = view.detailsOpen;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      toggle();
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, toggle]);

  const inspectable = popover && (kind === "done" || kind === "contingency" || kind === "failed");
  const onClick = inspectable ? view.onToggleDetails : kind === "idle" ? view.onPress : undefined;
  const lock = kind === "working" || (!inspectable && kind !== "idle") || (kind === "idle" && view.disabled);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={cx("facta-btn facta-btn--primary facta-issue-btn", "primaryButton")}
        data-kind={kind}
        style={animate && width !== null ? { width } : undefined}
        aria-disabled={lock || undefined}
        aria-busy={kind === "working" || undefined}
        aria-expanded={inspectable ? detailsOpen : undefined}
        aria-controls={inspectable && detailsOpen ? popoverId : undefined}
        onClick={lock ? undefined : onClick}
      >
        <span ref={contentRef} className="facta-issue-btn-content" key={kind}>
          {icon && <span className="facta-issue-btn-icon">{icon}</span>}
          <span className="facta-issue-btn-text" aria-live="polite">{text}</span>
          {inspectable && <ChevronIcon size={16} className="facta-issue-btn-chevron" />}
        </span>
      </button>
      {inspectable && detailsOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={text}
          className={cx("facta-popover")}
        >
          <button type="button" className={cx("facta-close facta-popover-close")} aria-label={messages.button.close} onClick={view.onToggleDetails}>
            <CloseIcon size={18} />
          </button>
          <PopoverBody state={state} onRetry={view.onRetry} />
        </div>
      )}
    </>
  );
}

function PopoverBody({ state, onRetry }: { state: FlowState; onRetry: () => void }) {
  const { cx, messages, showStorage } = useCfg();
  if (state.step === "sealed" && state.result) return <SealedContent result={state.result} showStorage={showStorage} showHeadline />;
  if (state.step === "contingency" && state.result) return <ContingencyContent result={state.result} showStorage={showStorage} />;
  if (state.error) {
    return (
      <>
        <FailureContent error={state.error} kind={state.step === "rejected" ? "rejected" : "failed"} />
        {state.error.canRetry && (
          <div className="facta-popover-actions">
            <button type="button" className={cx("facta-btn facta-btn--primary facta-btn--sm", "primaryButton")} onClick={onRetry}>
              {messages.failed.retry}
            </button>
          </div>
        )}
      </>
    );
  }
  return null;
}

/** Presentational half (used by the gallery with synthetic states). */
export function IssueButtonView(view: IssueButtonViewProps) {
  return (
    <FactaRoot look={view.look} className={view.className} style={{ display: "inline-block" }}>
      <div className="facta-button-wrap">
        <ButtonInner view={view} />
      </div>
    </FactaRoot>
  );
}

/** One-tap issuing for a point of sale. `confirm` defaults to false here. */
export function FactaIssueButton(props: FactaIssueButtonProps) {
  const resolved = useResolvedLook(props);
  const confirm = props.confirm ?? false;
  const { session } = props;
  const [started, setStarted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [doneResult, setDoneResult] = useState<IssueResult | null>(null);

  useEffect(() => {
    setStarted(false);
    setDialogOpen(false);
    setDetailsOpen(false);
    setDoneResult(null);
  }, [session]);

  const { onError } = props;
  const handleError = useCallback((error: FlowFailure) => {
    setDetailsOpen(true);
    onError?.(error);
  }, [onError]);

  const issue = useFactaIssue(session, {
    enabled: started && !confirm,
    confirm: false,
    onIssued: props.onIssued,
    onError: handleError,
    onDelivery: props.onDelivery,
    onEvent: props.onEvent as ((e: FactaEvent) => void) | undefined,
    messages: resolved.messages,
    flowOptions: props.flowOptions,
  });

  const onPress = useCallback(() => {
    if (confirm) setDialogOpen(true);
    else setStarted(true);
  }, [confirm]);

  // With `confirm`, the dialog owns the flow; the button only mirrors its end.
  const state: FlowState = confirm
    ? {
      ...issue.state,
      step: doneResult ? (doneResult.estado === "sellado" ? "sealed" : "contingency") : "loading",
      result: doneResult,
    }
    : issue.state;

  return (
    <>
      <IssueButtonView
        state={state}
        started={confirm ? doneResult !== null : started}
        label={props.label}
        disabled={props.disabled}
        popover={props.popover}
        detailsOpen={detailsOpen}
        onPress={onPress}
        onToggleDetails={() => setDetailsOpen((o) => !o)}
        onRetry={issue.retry}
        look={props}
        className={props.className}
      />
      {confirm && (
        <FactaInvoiceDialog
          {...props}
          confirm
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onIssued={(r) => {
            setDoneResult(r);
            props.onIssued?.(r);
          }}
          onDelivery={(delivery) => {
            setDoneResult((r) => (r ? { ...r, delivery } : r));
            props.onDelivery?.(delivery);
          }}
        />
      )}
    </>
  );
}
