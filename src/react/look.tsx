// Appearance plumbing shared by every component: merges the provider's look
// with a component's own props, resolves motion and theme, and exposes the
// resolved config to descendants. Nothing here touches the document globally.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  appearanceToCssVariables,
  mergeAppearance,
  mergeMessages,
  resolveMotion,
  type FactaAppearance,
  type FactaDensity,
  type FactaMessages,
  type FactaMessagesOverride,
  type FactaMotion,
  type FactaSlot,
  type FactaStyles,
  type FactaTheme,
} from "../browser/index.ts";

export interface FactaBranding {
  /** The host's name, shown in the header. */
  name?: string | undefined;
  /** A logo URL or any element. */
  logo?: ReactNode | string | undefined;
  /** `false` hides «Powered by factadte.com» completely (white-label). Default true. */
  attribution?: boolean | undefined;
}

/** Every element the host can restyle: class, inline style and `data-facta-slot`. */
export type FactaClassNameSlot = FactaSlot;

/** Inline styles per slot, applied after the stylesheet. */
export type FactaSlotStyles = FactaStyles<CSSProperties>;

export type FactaClassNames = Partial<Record<FactaClassNameSlot, string>>;

/** Everything that changes how the window looks, never what it does. */
export interface FactaLook {
  /** Shortcut for `appearance.theme`. */
  theme?: FactaTheme | undefined;
  appearance?: FactaAppearance | undefined;
  branding?: FactaBranding | undefined;
  classNames?: FactaClassNames | undefined;
  /** Inline styles per slot (`{ primaryButton: { height: 52 } }`), merged after ours. */
  styles?: FactaSlotStyles | undefined;
  /** Drop every default `facta-*` class: you bring the CSS. */
  unstyled?: boolean | undefined;
  messages?: FactaMessagesOverride | undefined;
  /** Show the «Copias» row on finished documents (default true). */
  showStorage?: boolean | undefined;
}

export type Cx = (base: string, slot?: FactaClassNameSlot, extra?: string) => string;

export interface SlotProps {
  className: string;
  style: CSSProperties | undefined;
  "data-facta-slot": FactaClassNameSlot;
}
/** `className` (ours + host's), host `style` and `data-facta-slot` for one slot. */
export type SlotFn = (slot: FactaClassNameSlot, base?: string, extra?: string) => SlotProps;

export interface ResolvedLook {
  messages: FactaMessages;
  theme: FactaTheme;
  density: FactaDensity;
  motion: FactaMotion;
  vars: Record<string, string>;
  branding: FactaBranding;
  attribution: boolean;
  classNames: FactaClassNames;
  styles: FactaSlotStyles;
  unstyled: boolean;
  showStorage: boolean;
  cx: Cx;
  sp: SlotFn;
}

function deepMerge<T>(a: T, b: unknown): T {
  if (!b || typeof b !== "object") return a;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    const prev = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object"
      ? deepMerge(prev, v)
      : v;
  }
  return out as T;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function useMediaQuery(queryText: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(queryText).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(queryText);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [queryText]);
  return matches;
}

function usePrefersDark(): boolean {
  return useMediaQuery("(prefers-color-scheme: dark)");
}

export const ProviderLookContext = createContext<FactaLook>({});

/** Merge the provider's look with a component's own, and resolve everything. */
export function useResolvedLook(local?: FactaLook): ResolvedLook {
  const base = useContext(ProviderLookContext);
  const prefersReduced = usePrefersReducedMotion();
  const prefersDark = usePrefersDark();
  return useMemo(() => {
    const appearance = mergeAppearance(
      base.theme ? { theme: base.theme } : undefined,
      base.appearance,
      local?.theme ? { theme: local.theme } : undefined,
      local?.appearance,
    );
    const branding = { ...base.branding, ...local?.branding };
    const classNames = { ...base.classNames, ...local?.classNames };
    const unstyled = local?.unstyled ?? base.unstyled ?? false;
    const messages = mergeMessages(
      deepMerge(deepMerge({}, base.messages), local?.messages) as FactaMessagesOverride,
    );
    const styles: FactaSlotStyles = {};
    for (const layer of [base.appearance?.styles, base.styles, local?.appearance?.styles, local?.styles]) {
      if (!layer) continue;
      for (const [k, v] of Object.entries(layer)) {
        styles[k as FactaClassNameSlot] = { ...styles[k as FactaClassNameSlot], ...(v as CSSProperties) };
      }
    }
    const cx: Cx = (cls, slot, extra) =>
      [unstyled ? "" : cls, slot ? classNames[slot] : "", extra].filter(Boolean).join(" ");
    const sp: SlotFn = (slot, cls = "", extra) => ({
      className: cx(cls, slot, extra),
      style: styles[slot],
      "data-facta-slot": slot,
    });
    const theme = appearance.theme ?? "auto";
    return {
      messages,
      theme,
      density: appearance.density ?? "comfortable",
      motion: resolveMotion(appearance.motion, prefersReduced),
      vars: appearanceToCssVariables(appearance.variables, { dark: theme === "dark" || (theme === "auto" && prefersDark) }),
      branding,
      attribution: branding.attribution !== false,
      classNames,
      styles,
      unstyled,
      showStorage: local?.showStorage ?? base.showStorage ?? true,
      cx,
      sp,
    };
  }, [base, local, prefersReduced, prefersDark]);
}

const ResolvedContext = createContext<ResolvedLook | null>(null);

/** The look resolved by the nearest `FactaRoot`. */
export function useCfg(): ResolvedLook {
  const cfg = useContext(ResolvedContext);
  if (!cfg) throw new Error("Facta components must render inside a FactaRoot.");
  return cfg;
}

export interface FactaRootProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  look?: FactaLook | undefined;
  resolved?: ResolvedLook | undefined;
  className?: string | undefined;
  /** Which slot this element is (`root`, or `overlay` for a modal layer). */
  slot?: "root" | "overlay";
  /** Exposed as `data-facta-state`, `-run` and `-variant` for host CSS. */
  state?: string | undefined;
  run?: string | undefined;
  variant?: string | undefined;
  children?: ReactNode;
}

/** The element that carries the tokens and switches. Always the outermost one. */
export function FactaRoot({ look, resolved, className, children, style, slot = "root", state, run, variant, ...rest }: FactaRootProps) {
  const own = useResolvedLook(look);
  const cfg = resolved ?? own;
  const merged: CSSProperties = { ...(cfg.vars as CSSProperties), ...cfg.styles.root, ...(slot === "overlay" ? cfg.styles.overlay : undefined), ...style };
  return (
    <ResolvedContext.Provider value={cfg}>
      <div
        {...rest}
        className={cfg.cx("facta-root", "root", className)}
        style={merged}
        data-facta-slot={slot}
        data-facta-state={state}
        data-facta-run={run}
        data-facta-variant={variant}
        data-facta-theme={cfg.theme}
        data-facta-density={cfg.density}
        data-facta-motion={cfg.motion}
        data-facta-unstyled={cfg.unstyled ? "" : undefined}
      >
        {children}
      </div>
    </ResolvedContext.Provider>
  );
}
