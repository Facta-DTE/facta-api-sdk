// The window's card: header (brand, title, environment chip, close), the body
// with its height morph and cross-fade, and the footer (attribution + actions).
// Presentational: it takes a FlowState, so the gallery can render any screen.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fill, type Environment, type FlowState } from "../browser/index.ts";
import { CloseIcon, SealGlyph, Spinner } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { useScreen, type ScreenAction } from "./screens.tsx";
import type { AutoCloseState } from "./use-issue.ts";

export type CardVariant = "dialog" | "sheet" | "drawer" | "inline";

export interface FactaWindowViewProps {
  state: FlowState;
  variant?: CardVariant;
  titleId?: string;
  onNext?: () => void;
  onRetry?: () => void;
  /** Without it the card has no close button and no «Listo»/«Cerrar». */
  onClose?: (() => void) | undefined;
  /** Hide the card chrome and keep only the screens (used by popovers). */
  showStorage?: boolean | undefined;
  /** Overrides `state.info.environment` (used by the receipt). */
  environment?: Environment | null | undefined;
  look?: FactaLook | undefined;
  /** The `auto-close` countdown; the bar shows while `active`, any interaction cancels it. */
  autoClose?: AutoCloseState | undefined;
}

function BrandMark() {
  const { branding, cx } = useCfg();
  const { logo } = branding;
  if (!logo) return null;
  return typeof logo === "string"
    ? <img className={cx("facta-brand-logo")} src={logo} alt="" />
    : <span className={cx("facta-brand-box")} aria-hidden>{logo}</span>;
}

function ActionButton({ action, kind, busy }: { action: ScreenAction; kind: "primary" | "secondary"; busy?: boolean }) {
  const { sp } = useCfg();
  return (
    <button
      type="button"
      {...sp(kind === "primary" ? "primaryButton" : "secondaryButton", `facta-btn facta-btn--${kind}`)}
      onClick={action.onClick}
      disabled={action.disabled || busy}
    >
      {busy && <Spinner size={16} />}
      {action.label}
    </button>
  );
}

/** Countdown bar (full motion) or plain text (reduced/none) for `auto-close`. */
function Countdown({ delay }: { delay: number }) {
  const { sp, motion, messages } = useCfg();
  const [left, setLeft] = useState(delay);
  useEffect(() => {
    const end = Date.now() + delay;
    setLeft(delay);
    const id = setInterval(() => setLeft(Math.max(0, end - Date.now())), 200);
    return () => clearInterval(id);
  }, [delay]);
  const seconds = Math.max(1, Math.ceil(left / 1000));
  const text = fill(messages.autoClose.closingIn, { n: seconds });
  const full = motion === "full";
  return (
    <div {...sp("countdown", "facta-countdown")} style={{ ...sp("countdown").style, ["--facta-countdown-ms" as string]: `${delay}ms` }}>
      {full && (
        <span className="facta-countdown-track" aria-hidden>
          <span className="facta-countdown-bar" />
        </span>
      )}
      <p className={full ? "facta-sr" : "facta-countdown-text"} role="status" aria-live="polite">{text}</p>
    </div>
  );
}

/** Animates the body's height between steps (FLIP via ResizeObserver). */
function Morph({ children, stepKey, enabled }: { children: ReactNode; stepKey: string; enabled: boolean }) {
  const { cx, motion } = useCfg();
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const animate = enabled && motion === "full";
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el || !animate || typeof ResizeObserver === "undefined") return;
    setHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [animate]);
  return (
    <div className={cx("facta-morph")} style={animate && height !== null ? { height } : undefined} data-morph={animate ? "" : undefined}>
      <div ref={innerRef} className="facta-morph-inner">
        <div key={stepKey} className={cx("facta-screen")}>{children}</div>
      </div>
    </div>
  );
}

export function FactaWindowView(props: FactaWindowViewProps) {
  const { state, variant = "dialog", titleId = "facta-title", onNext = noop, onRetry = noop, onClose, autoClose } = props;
  const cfg = useCfg();
  const { cx, sp, messages, attribution, branding } = cfg;
  const showStorage = props.showStorage ?? cfg.showStorage;
  const busy = state.step === "issuing" || state.step === "verifying";
  const screen = useScreen(state, { onNext, onRetry, onClose }, showStorage);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const programmatic = useRef(false);
  useEffect(() => {
    if (first.current || variant === "inline") {
      first.current = false;
      return;
    }
    programmatic.current = true;
    headingRef.current?.focus({ preventScroll: true });
    programmatic.current = false;
  }, [state.step, variant]);

  const counting = Boolean(autoClose?.active);
  const cancel = autoClose?.cancel;
  const interact = counting && cancel ? () => cancel() : undefined;

  const environment = props.environment !== undefined ? props.environment : state.info?.environment;
  const hasActions = Boolean(screen.primary || screen.secondary);
  return (
    <div
      {...sp("card", `facta-card facta-card--${variant}`)}
      data-step={state.step}
      data-tone={screen.tone}
      onPointerDownCapture={interact}
      onKeyDownCapture={interact}
      onFocusCapture={interact ? () => { if (!programmatic.current) cancel?.(); } : undefined}
    >
      {variant === "sheet" && <span className="facta-grab" aria-hidden />}
      <header {...sp("header", "facta-header")}>
        <BrandMark />
        <div className="facta-header-main">
          {branding.name && <span className="facta-eyebrow">{branding.name}</span>}
          <h2 id={titleId} ref={headingRef} tabIndex={-1} {...sp("title", "facta-title")}>{screen.title}</h2>
        </div>
        <div className="facta-header-side">
          {environment === "00" && <span {...sp("chip", "facta-chip")}>{messages.chipTest}</span>}
          {onClose && !busy && (
            <button type="button" className={cx("facta-close")} aria-label={messages.closeLabel} onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          )}
        </div>
      </header>
      {counting && autoClose && <Countdown delay={autoClose.delay} />}
      <div {...sp("body", "facta-scroll")}>
        <Morph stepKey={state.step} enabled={variant !== "drawer"}>{screen.body}</Morph>
      </div>
      {(attribution || hasActions) && (
        <footer {...sp("footer", "facta-footer")}>
          {attribution ? (
            <span {...sp("attribution", "facta-attribution")}><SealGlyph size={14} />{messages.footerBrand}</span>
          ) : <span />}
          {hasActions && (
            <div className="facta-actions">
              {screen.secondary && <ActionButton action={screen.secondary} kind="secondary" />}
              {screen.primary && <ActionButton action={screen.primary} kind="primary" />}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function noop() {}
