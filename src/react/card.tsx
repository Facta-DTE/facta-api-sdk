// The window's card: header (brand, title, environment chip, close), the body
// with its height morph and cross-fade, and the footer (attribution + actions).
// Presentational: it takes a FlowState, so the gallery can render any screen.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Environment, FlowState } from "../browser/index.ts";
import { CloseIcon, SealGlyph, Spinner } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { useScreen, type ScreenAction } from "./screens.tsx";

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
}

function BrandMark() {
  const { branding, cx } = useCfg();
  const { logo, name } = branding;
  if (!logo && !name) return null;
  return (
    <div className={cx("facta-brand")}>
      {typeof logo === "string" ? <img className="facta-brand-logo" src={logo} alt={name ?? ""} /> : logo}
      {name && <span className="facta-brand-name">{name}</span>}
    </div>
  );
}

function ActionButton({ action, kind, busy }: { action: ScreenAction; kind: "primary" | "secondary"; busy?: boolean }) {
  const { cx } = useCfg();
  return (
    <button
      type="button"
      className={cx(`facta-btn facta-btn--${kind}`, kind === "primary" ? "primaryButton" : "secondaryButton")}
      onClick={action.onClick}
      disabled={action.disabled || busy}
    >
      {busy && <Spinner size={16} />}
      {action.label}
    </button>
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
  const { state, variant = "dialog", titleId = "facta-title", onNext = noop, onRetry = noop, onClose } = props;
  const cfg = useCfg();
  const { cx, messages, attribution } = cfg;
  const showStorage = props.showStorage ?? cfg.showStorage;
  const busy = state.step === "issuing" || state.step === "verifying";
  const screen = useScreen(state, { onNext, onRetry, onClose }, showStorage);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || variant === "inline") {
      first.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [state.step, variant]);

  const environment = props.environment !== undefined ? props.environment : state.info?.environment;
  const subtitle = state.step === "review" ? undefined : state.info?.display?.title;
  const hasActions = Boolean(screen.primary || screen.secondary);
  return (
    <div className={cx("facta-card", "card", `facta-card--${variant}`)} data-step={state.step} data-tone={screen.tone}>
      {variant === "sheet" && <span className="facta-grab" aria-hidden />}
      <header className={cx("facta-header", "header")}>
        <div className="facta-header-main">
          <BrandMark />
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className={cx("facta-title", "title")}>{screen.title}</h2>
          {subtitle && <p className={cx("facta-subtitle")}>{subtitle}</p>}
        </div>
        <div className="facta-header-side">
          {environment === "00" && <span className={cx("facta-chip facta-chip--test", "chip")}>{messages.chipTest}</span>}
          {onClose && !busy && (
            <button type="button" className={cx("facta-close")} aria-label={messages.closeLabel} onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          )}
        </div>
      </header>
      <div className={cx("facta-scroll", "body")}>
        <Morph stepKey={state.step} enabled={variant !== "drawer"}>{screen.body}</Morph>
      </div>
      {(attribution || hasActions) && (
        <footer className={cx("facta-footer", "footer")}>
          {attribution ? (
            <span className={cx("facta-attribution")}><SealGlyph size={14} />{messages.footerBrand}</span>
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
