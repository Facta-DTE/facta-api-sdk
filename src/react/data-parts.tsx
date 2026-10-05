// Shared pieces of the data components: icons, the accessible action menu, the
// estado badge, the document-type labels and the layer (drawer / sheet / dialog)
// that the detail and the invalidation dialog sit in.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import type { DteType } from "../types.ts";
import { fill } from "../browser/index.ts";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, CopyIcon, SealGlyph } from "./icons.tsx";
import { FactaRoot, useCfg, useMediaQuery, useResolvedLook, type FactaLook } from "./look.tsx";
import { useSheetDrag } from "./sheet-drag.ts";
import { Layer, usePresence } from "./windows.tsx";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

export const CopyGlyph = CopyIcon;
export const EyeGlyph = (p: IconProps) => <svg {...icon(p)}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>;
export const SearchIcon = (p: IconProps) => <svg {...icon(p)}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>;
export const RefreshIcon = (p: IconProps) => <svg {...icon(p)}><path d="M20 11a8 8 0 0 0-14.3-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.3 4.5M20 20v-3.5h-3.5" /></svg>;
export const FilterIcon = (p: IconProps) => <svg {...icon(p)}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
export const EyeOffIcon = (p: IconProps) => <svg {...icon(p)}><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c4.5 0 8 3.6 9 6a10 10 0 0 1-2.4 3.3M6.5 7.6A10.4 10.4 0 0 0 3 12c1 2.4 4.5 6 9 6 1.4 0 2.6-.3 3.7-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
export const BanIcon = (p: IconProps) => <svg {...icon(p)}><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>;
export const DotsIcon = (p: IconProps) => <svg {...icon(p)}><circle cx="12" cy="5.5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="18.5" r="1.2" fill="currentColor" /></svg>;
export const LockIcon = (p: IconProps) => <svg {...icon(p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const CloudIcon = (p: IconProps) => <svg {...icon(p)}><path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z" /></svg>;
export const JsonIcon = (p: IconProps) => <svg {...icon(p)}><path d="M9 4C7 4 7 6 7 8s0 3-2 4c2 1 2 2 2 4s0 4 2 4M15 4c2 0 2 2 2 4s0 3 2 4c-2 1-2 2-2 4s0 4-2 4" /></svg>;
export const TicketIcon = (p: IconProps) => <svg {...icon(p)}><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21zM9 8h6M9 12h6" /></svg>;
export const PdfIcon = (p: IconProps) => <svg {...icon(p)}><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V4a.5.5 0 0 1 .5-.5zM14 3.5V8h4M9 14h6M9 17h4" /></svg>;
export const CalendarIcon = (p: IconProps) => <svg {...icon(p)}><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></svg>;
export const WifiOffIcon = (p: IconProps) => <svg {...icon(p)}><path d="M3 3l18 18M5 10a10 10 0 0 1 4-2.2M19 10a10 10 0 0 0-5.5-2.8M8.5 13.5a5 5 0 0 1 2-1.1M15.5 13.5a5 5 0 0 0-1.5-1M12 18v.01" /></svg>;
export const ChevronUpDown = (p: IconProps) => <svg {...icon(p)}><path d="M7 10l5 5 5-5" /></svg>;

/** `DTE-01-M001P001-000000000000042` → `DTE-01-M001P…000042`. */
export function midTruncate(value: string, head = 15, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function docTypeLabel(tipoDte: DteType | string, messages: { docTypes: Record<string, string> }): string {
  return messages.docTypes[tipoDte] ?? tipoDte;
}

/** `2026-10-05` → `5 oct`. Falls back to the raw text. */
export function shortDate(fecEmi: string | undefined | null): string {
  const m = fecEmi ? /^(\d{4})-(\d{2})-(\d{2})/.exec(fecEmi) : null;
  if (!m) return fecEmi ?? "—";
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]}`;
}

export function shortTime(horEmi: string | undefined | null): string {
  const m = horEmi ? /^(\d{2}):(\d{2})/.exec(horEmi) : null;
  return m ? `${m[1]}:${m[2]}` : "";
}

const ESTADO_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sellado: "success",
  contingencia: "warning",
  rechazado: "danger",
  invalidado: "neutral",
  firmado: "neutral",
};

export function EstadoBadge({ estado }: { estado: string }) {
  const { cx, messages } = useCfg();
  const tone = ESTADO_TONE[estado] ?? "neutral";
  const Glyph = estado === "sellado" ? CheckIcon : estado === "contingencia" ? ClockIcon : estado === "rechazado" ? CloseIcon : estado === "invalidado" ? BanIcon : null;
  return (
    <span className={cx("facta-badge facta-badge--icon", undefined, `facta-badge--${tone}`)} data-estado={estado}>
      {Glyph ? <Glyph size={13} /> : <span className="facta-dot" aria-hidden />}
      {messages.status[estado] ?? estado}
    </span>
  );
}

export function Attribution() {
  const { sp, messages, attribution } = useCfg();
  if (!attribution) return null;
  return <span {...sp("attribution", "facta-attribution")}><SealGlyph size={14} />{messages.footerBrand}</span>;
}

/** `{n} en el período`-style template helper re-exported for the components. */
export { fill };

// --- Action menu ----------------------------------------------------------------

export interface MenuEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect(): void;
}

/** A `role="menu"` popover: ↑↓ Home End move, Enter/Space choose, Esc and Tab close. */
export function MenuList({
  entries,
  label,
  onClose,
  align = "end",
}: {
  entries: MenuEntry[];
  label: string;
  onClose(restoreFocus: boolean): void;
  align?: "start" | "end";
}) {
  const { sp } = useCfg();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [onClose]);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown": return go(at + 1);
      case "ArrowUp": return go(at < 0 ? -1 : at - 1);
      case "Home": return go(0);
      case "End": return go(-1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return onClose(true);
      case "Tab":
        return onClose(false);
    }
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown} {...sp("menu", "facta-menu", `facta-menu--${align}`)}>
      {entries.map((entry) => (
        <div key={entry.id} role="none">
          {entry.separatorBefore && <hr className="facta-menu-sep" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`facta-menu-item${entry.danger ? " facta-menu-item--danger" : ""}`}
            onClick={() => {
              onClose(true);
              entry.onSelect();
            }}
          >
            {entry.icon && <span className="facta-menu-icon" aria-hidden>{entry.icon}</span>}
            <span className="facta-menu-label">{entry.label}</span>
            {entry.hint && <span className="facta-menu-hint">{entry.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Layer: drawer / sheet / dialog ---------------------------------------------

export interface DataLayerProps {
  look?: FactaLook | undefined;
  open: boolean;
  /** Desktop presentation; phones always get a bottom sheet. */
  desktop: "drawer" | "dialog";
  title: ReactNode;
  subtitle?: ReactNode;
  /** An icon in a tinted disc before the title (dialog). */
  glyph?: ReactNode;
  glyphTone?: "danger" | "success" | "neutral";
  canClose?: boolean;
  onRequestClose(): void;
  closeLabel: string;
  ariaLabel?: string;
  step: string;
  body: ReactNode;
  actions?: ReactNode;
  /** The «Powered by» line in the footer. Default true (still hidden by `branding.attribution: false`). */
  footerAttribution?: boolean;
}

/** Portal + focus trap + Esc + backdrop around the standard card. */
export function DataLayer(props: DataLayerProps) {
  const resolved = useResolvedLook(props.look);
  const phone = useMediaQuery("(max-width: 640px)");
  const exitMs = resolved.motion === "full" ? 240 : 0;
  const { mounted, state } = usePresence(props.open, exitMs);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const canClose = props.canClose ?? true;
  const kind: "drawer" | "sheet" | "dialog" = phone ? "sheet" : props.desktop;
  const drag = useSheetDrag({
    target: cardRef,
    enabled: kind === "sheet" && canClose,
    follow: resolved.motion === "full",
    onDismiss: props.onRequestClose,
  });
  if (!mounted) return null;
  const { sp, cx } = resolved;
  const hasActions = Boolean(props.actions);
  const attribution = resolved.attribution && props.footerAttribution !== false;
  return (
    <Layer
      kind={kind}
      state={state}
      step={props.step}
      run="manual"
      resolved={resolved}
      titleId={titleId}
      canClose={canClose}
      onRequestClose={props.onRequestClose}
    >
      <div ref={cardRef} {...sp("card", `facta-card facta-card--${kind}`)} aria-label={props.ariaLabel} data-step={props.step}>
        {kind === "sheet" && <span className="facta-grab" data-draggable={canClose ? "" : undefined} aria-hidden {...drag} />}
        <header {...sp("header", "facta-header facta-header--data")}>
          {props.glyph && <span className={cx("facta-disc", undefined, `facta-disc--${props.glyphTone ?? "neutral"}`)} aria-hidden>{props.glyph}</span>}
          <div className="facta-header-main">
            <h2 id={titleId} {...sp("title", "facta-title")}>{props.title}</h2>
            {props.subtitle && <div className="facta-header-sub">{props.subtitle}</div>}
          </div>
          {canClose && (
            <button type="button" className={cx("facta-close")} aria-label={props.closeLabel} onClick={props.onRequestClose}>
              <CloseIcon size={20} />
            </button>
          )}
        </header>
        <div {...sp("body", "facta-scroll facta-scroll--data")}>{props.body}</div>
        {(attribution || hasActions) && (
          <footer {...sp("footer", "facta-footer")}>
            {attribution ? <Attribution /> : <span />}
            {hasActions && <div className="facta-actions">{props.actions}</div>}
          </footer>
        )}
      </div>
    </Layer>
  );
}

/** The root wrapper of the inline data components. */
export function DataRoot({ look, className, variant, state, children }: { look?: FactaLook | undefined; className?: string | undefined; variant: string; state?: string | undefined; children: ReactNode }) {
  return (
    <FactaRoot look={look} variant={variant} state={state} className={`facta-data ${className ?? ""}`.trim()}>
      {children}
    </FactaRoot>
  );
}

export function ErrorCallout({ title, body, code, onRetry, retryLabel }: { title: string; body: string; code?: string | undefined; onRetry?: (() => void) | undefined; retryLabel?: string | undefined }) {
  const { cx } = useCfg();
  return (
    <div className={cx("facta-callout facta-callout--danger facta-callout--row")} role="alert">
      <AlertIcon size={20} />
      <div className="facta-callout-text">
        <b>{title}</b>
        <span>{body}{code ? <> <span className="facta-mono facta-code">{code}</span></> : null}</span>
      </div>
      {onRetry && <button type="button" className={cx("facta-btn facta-btn--sm")} onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

const LOOK_KEYS = ["theme", "appearance", "branding", "classNames", "styles", "unstyled", "messages", "showStorage"] as const;

/** Separate the shared look props from a component's own props. */
export function splitLook<T extends FactaLook>(props: T): [FactaLook, Omit<T, keyof FactaLook>] {
  const look: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if ((LOOK_KEYS as readonly string[]).includes(k)) look[k] = v;
    else rest[k] = v;
  }
  return [look as FactaLook, rest as Omit<T, keyof FactaLook>];
}
