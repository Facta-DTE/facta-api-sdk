// The presentations of the window: dialog (sheet on phones), drawer, inline,
// plus `FactaInvoiceWindow`, which picks one. All share `useFactaIssue` and
// the same card.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DeliveryView, FlowFailure, IssueResult, RunMode } from "../browser/index.ts";
import { FactaWindowView } from "./card.tsx";
import { FactaRoot, useMediaQuery, useResolvedLook, type FactaLook, type ResolvedLook } from "./look.tsx";
import { useFactaIssue, type AutoCloseOn, type FactaEvent, type UseFactaIssueOptions } from "./use-issue.ts";

export interface FactaWindowProps extends FactaLook {
  /** The opaque token your server created with `createFactaSession`. */
  session: string;
  /**
   * `"manual"` (default): review, then «Emitir factura». `"auto"`: issues as soon
   * as it opens and the result stays until the person closes it. `"auto-close"`:
   * issues, shows the result for `autoCloseDelay` ms and closes itself.
   */
  run?: RunMode | undefined;
  /** Milliseconds the result stays visible before `auto-close` closes (default 1200). */
  autoCloseDelay?: number | undefined;
  /** `"success"` (default): only sealed/contingency close. `"any"`: every final state closes. */
  autoCloseOn?: AutoCloseOn | undefined;
  onIssued?: ((result: IssueResult) => void) | undefined;
  onError?: ((error: FlowFailure) => void) | undefined;
  /** Delivery state updates (e-mail / WhatsApp); never blocks «Listo» or closing. */
  onDelivery?: ((delivery: DeliveryView) => void) | undefined;
  onEvent?: ((event: FactaEvent) => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Test hook. */
  flowOptions?: UseFactaIssueOptions["flowOptions"];
}

export interface FactaLayerProps extends FactaWindowProps {
  open: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (exitMs <= 0) {
      setMounted(false);
      return;
    }
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs, mounted]);
  return { mounted: mounted || open, state: open ? "open" : "closed" } as const;
}

interface LayerProps {
  kind: "dialog" | "sheet" | "drawer";
  state: "open" | "closed";
  step: string;
  run: RunMode;
  resolved: ResolvedLook;
  titleId: string;
  canClose: boolean;
  onRequestClose: () => void;
  children: ReactNode;
}

/** Portal + backdrop + focus trap + scroll lock + Esc. */
function Layer({ kind, state, step, run, resolved, titleId, canClose, onRequestClose, children }: LayerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef({ canClose, onRequestClose });
  closeRef.current = { canClose, onRequestClose };
  const open = state === "open";

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closeRef.current.canClose) {
          event.stopPropagation();
          closeRef.current.onRequestClose();
        }
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === head || active === panelRef.current)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && active === tail) {
        event.preventDefault();
        head.focus();
      } else if (!panelRef.current.contains(active)) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open]);

  const { cx } = resolved;
  return createPortal(
    <FactaRoot
      resolved={resolved}
      slot="overlay"
      state={step}
      run={run}
      variant={kind}
      className={cx(`facta-layer facta-layer--${kind}`, "overlay")}
      data-state={state}
    >
      <div className={cx("facta-backdrop")} aria-hidden onClick={() => canClose && onRequestClose()} />
      <div
        ref={panelRef}
        className={cx("facta-panel")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state={state}
      >
        {children}
      </div>
    </FactaRoot>,
    document.body,
  );
}

function useLayerWindow(props: FactaLayerProps, kind: "dialog" | "drawer", presentation?: "auto" | "dialog" | "sheet") {
  const resolved = useResolvedLook(props);
  const phone = useMediaQuery("(max-width: 640px)");
  const exitMs = resolved.motion === "full" ? 240 : 0;
  const { mounted, state } = usePresence(props.open, exitMs);
  const issue = useFactaIssue(props.session, {
    enabled: mounted,
    run: props.run,
    autoCloseDelay: props.autoCloseDelay,
    autoCloseOn: props.autoCloseOn,
    onAutoClose: () => closeRef.current(),
    onIssued: props.onIssued,
    onError: props.onError,
    onDelivery: props.onDelivery,
    onEvent: props.onEvent,
    messages: resolved.messages,
    flowOptions: props.flowOptions,
  });
  const closeRef = useRef<() => void>(() => {});
  const busy = issue.state.step === "issuing" || issue.state.step === "verifying";
  const { onOpenChange, onClose } = props;
  const { emit } = issue;
  const close = useCallback(() => {
    if (busy) return;
    emit("closed");
    onOpenChange?.(false);
    onClose?.();
  }, [busy, emit, onOpenChange, onClose]);
  closeRef.current = close;
  const titleId = useId();
  const layerKind: "dialog" | "sheet" | "drawer" = kind === "drawer"
    ? "drawer"
    : presentation === "sheet" || (presentation !== "dialog" && phone)
    ? "sheet"
    : "dialog";
  return { resolved, mounted, state, issue, busy, close, titleId, layerKind };
}

/** Centered modal; a bottom sheet on phones (≤640 px). */
export function FactaInvoiceDialog(props: FactaLayerProps & { presentation?: "auto" | "dialog" | "sheet" | undefined }) {
  const w = useLayerWindow(props, "dialog", props.presentation);
  if (!w.mounted) return null;
  return (
    <Layer kind={w.layerKind} state={w.state} step={w.issue.state.step} run={props.run ?? "manual"} resolved={w.resolved} titleId={w.titleId} canClose={!w.busy} onRequestClose={w.close}>
      <FactaWindowView
        state={w.issue.state}
        variant={w.layerKind === "sheet" ? "sheet" : "dialog"}
        titleId={w.titleId}
        onNext={w.issue.next}
        onRetry={w.issue.retry}
        onClose={w.close}
        autoClose={w.issue.autoClose}
      />
    </Layer>
  );
}

/** Right-side panel for back-office tools: full height, slides in. */
export function FactaInvoiceDrawer(props: FactaLayerProps) {
  const w = useLayerWindow(props, "drawer");
  if (!w.mounted) return null;
  return (
    <Layer kind="drawer" state={w.state} step={w.issue.state.step} run={props.run ?? "manual"} resolved={w.resolved} titleId={w.titleId} canClose={!w.busy} onRequestClose={w.close}>
      <FactaWindowView
        state={w.issue.state}
        variant="drawer"
        titleId={w.titleId}
        onNext={w.issue.next}
        onRetry={w.issue.retry}
        onClose={w.close}
        autoClose={w.issue.autoClose}
      />
    </Layer>
  );
}

export interface FactaInlineProps extends FactaWindowProps {
  className?: string | undefined;
}

/** A card embedded in a page (checkout, thank-you page). No overlay, no focus trap. */
export function FactaInvoiceInline(props: FactaInlineProps) {
  const resolved = useResolvedLook(props);
  const titleId = useId();
  const issue = useFactaIssue(props.session, {
    run: props.run,
    autoCloseDelay: props.autoCloseDelay,
    autoCloseOn: props.autoCloseOn,
    onAutoClose: () => closeRef.current(),
    onIssued: props.onIssued,
    onError: props.onError,
    onDelivery: props.onDelivery,
    onEvent: props.onEvent,
    messages: resolved.messages,
    flowOptions: props.flowOptions,
  });
  const busy = issue.state.step === "issuing" || issue.state.step === "verifying";
  const { onClose } = props;
  const { emit } = issue;
  const close = useCallback(() => {
    if (busy) return;
    emit("closed");
    onClose?.();
  }, [busy, emit, onClose]);
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = close;
  return (
    <FactaRoot resolved={resolved} state={issue.state.step} run={props.run ?? "manual"} variant="inline" className={resolved.cx("facta-inline", undefined, props.className)}>
      <section aria-labelledby={titleId}>
        <FactaWindowView
          state={issue.state}
          variant="inline"
          titleId={titleId}
          onNext={issue.next}
          onRetry={issue.retry}
          onClose={onClose ? close : undefined}
          autoClose={onClose ? issue.autoClose : undefined}
        />
      </section>
    </FactaRoot>
  );
}

export interface FactaInvoiceWindowProps extends FactaLayerProps {
  presentation?: "auto" | "dialog" | "sheet" | "drawer" | "inline" | undefined;
  className?: string | undefined;
}

/** One entry point that picks a presentation. `auto` is dialog on desktop, sheet on phones. */
export function FactaInvoiceWindow({ presentation = "auto", ...props }: FactaInvoiceWindowProps) {
  if (presentation === "drawer") return <FactaInvoiceDrawer {...props} />;
  if (presentation === "inline") return props.open ? <FactaInvoiceInline {...props} /> : null;
  return <FactaInvoiceDialog {...props} presentation={presentation} />;
}
