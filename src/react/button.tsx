// The compact point-of-sale button: it morphs from label to spinner (with the
// current phase) to a check, or to an error state. A small popover carries the
// result, the downloads and, for failures, the structured explanation.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { formatMoney, truncateMiddle, type FlowState, type RunMode } from "../browser/index.ts";
import { AlertIcon, CheckIcon, ChevronIcon, ClockIcon, CloseIcon, DocIcon, SealGlyph, Spinner } from "./icons.tsx";
import { FactaRoot, useCfg, useResolvedLook, type FactaLook } from "./look.tsx";
import { DeliveryRows } from "./delivery.tsx";
import { ContingencyContent, CopyButton, DownloadTile, FailureContent } from "./parts.tsx";
import { useFactaIssue, type FactaEvent } from "./use-issue.ts";
import type { FactaWindowProps } from "./windows.tsx";
import type { FlowFailure } from "../browser/index.ts";

export interface FactaIssueButtonProps extends FactaWindowProps {
  /** Button text before issuing. Default «Emitir factura». */
  label?: string | undefined;
  disabled?: boolean | undefined;
  /** Show the result popover (default true). With `run="auto-close"` it is never shown after success. */
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
  run?: RunMode | undefined;
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
  const { cx, sp, messages, motion } = useCfg();
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
  let icon: React.ReactNode = kind === "idle" ? <DocIcon size={18} /> : null;
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

  const inspectable = popover && (kind === "failed" || ((kind === "done" || kind === "contingency") && view.run !== "auto-close"));
  const onClick = inspectable ? view.onToggleDetails : kind === "idle" ? view.onPress : undefined;
  const lock = kind === "working" || (!inspectable && kind !== "idle") || (kind === "idle" && view.disabled);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        {...sp("primaryButton", "facta-btn facta-btn--primary facta-issue-btn")}
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
  const { cx, messages, showStorage, sp, attribution } = useCfg();
  if (state.step === "sealed" && state.result) {
    const r = state.result;
    const total = r.totales?.totalPagar;
    const pdf = r.estado === "sellado" && r.representacionGrafica;
    return (
      <div className="facta-popover-body">
        <div className="facta-popover-head">
          <span className="facta-stamp facta-stamp--xs facta-tone-success" aria-hidden><SealGlyph size={18} /></span>
          {messages.sealed.headline}
        </div>
        {typeof total === "number" && (
          <div>
            <span className="facta-sub">{messages.sealed.total}</span>
            <div {...sp("total", "facta-total")}>{formatMoney(total)}</div>
          </div>
        )}
        <div className="facta-id facta-mono facta-popover-id">
          <span title={r.codigoGeneracion}>{truncateMiddle(r.codigoGeneracion, 12, 12)}</span>
          <CopyButton value={r.codigoGeneracion} label={messages.sealed.generationCode} />
        </div>
        {r.delivery && <dl {...sp("identifiers", "facta-block facta-details")}><DeliveryRows result={r} /></dl>}
        {pdf && (
          <div className="facta-downloads facta-downloads--one">
            <DownloadTile kind="pdf" result={r} />
          </div>
        )}
        {attribution && (
          <div className="facta-popover-foot">
            <span {...sp("attribution", "facta-attribution")}><SealGlyph size={12} />{messages.button.attribution}</span>
          </div>
        )}
      </div>
    );
  }
  if (state.step === "contingency" && state.result) {
    return <div className="facta-popover-body"><ContingencyContent result={state.result} showStorage={showStorage} /></div>;
  }
  if (state.error) {
    return (
      <div className="facta-popover-body">
        <FailureContent error={state.error} kind={state.step === "rejected" ? "rejected" : "failed"} />
        {state.error.canRetry && (
          <div className="facta-popover-actions">
            <button type="button" className={cx("facta-btn facta-btn--primary facta-btn--sm", "primaryButton")} onClick={onRetry}>
              {messages.failed.retry}
            </button>
          </div>
        )}
      </div>
    );
  }
  return null;
}

/** Presentational half (used by the gallery with synthetic states). */
export function IssueButtonView(view: IssueButtonViewProps) {
  return (
    <FactaRoot
      look={view.look}
      className={view.className}
      state={kindOf(view.state, view.started)}
      run={view.run ?? "manual"}
      variant="button"
      style={{ display: "inline-block" }}
    >
      <div className="facta-button-wrap">
        <ButtonInner view={view} />
      </div>
    </FactaRoot>
  );
}

/**
 * One-tap issuing for a point of sale. `run="manual"` (default): the person
 * presses it. `"auto"`: issues as soon as it mounts. `"auto-close"`: same, and
 * the success popover is not shown (the host reads `onIssued`); a rejection
 * still opens its explanation unless `autoCloseOn="any"`.
 */
export function FactaIssueButton(props: FactaIssueButtonProps) {
  const resolved = useResolvedLook(props);
  const run = props.run ?? "manual";
  const autoCloseOn = props.autoCloseOn ?? "success";
  const { session } = props;
  const [started, setStarted] = useState(run !== "manual");
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setStarted(run !== "manual");
    setDetailsOpen(false);
  }, [session, run]);

  const { onError } = props;
  const handleError = useCallback((error: FlowFailure) => {
    if (!(run === "auto-close" && autoCloseOn === "any")) setDetailsOpen(true);
    onError?.(error);
  }, [onError, run, autoCloseOn]);

  const issue = useFactaIssue(session, {
    enabled: started,
    run: "auto",
    onIssued: props.onIssued,
    onError: handleError,
    onDelivery: props.onDelivery,
    onEvent: props.onEvent as ((e: FactaEvent) => void) | undefined,
    messages: resolved.messages,
    flowOptions: props.flowOptions,
  });

  const onPress = useCallback(() => setStarted(true), []);
  const popover = props.popover !== false && run !== "auto-close";
  const failurePopover = props.popover !== false && run === "auto-close" && autoCloseOn === "success";

  return (
    <IssueButtonView
      state={issue.state}
      started={started}
      label={props.label}
      disabled={props.disabled}
      popover={popover || failurePopover}
      run={run}
      detailsOpen={detailsOpen}
      onPress={onPress}
      onToggleDetails={() => setDetailsOpen((o) => !o)}
      onRetry={issue.retry}
      look={props}
      className={props.className}
    />
  );
}
