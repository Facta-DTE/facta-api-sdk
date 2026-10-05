// Appearance / white-label contract: maps a plain object to the `--facta-*`
// CSS variables and `data-*` switches the stylesheet reads. Framework-free so
// every framework wrapper behaves the same.

export type FactaTheme = "light" | "dark" | "auto";
export type FactaDensity = "comfortable" | "compact";
export type FactaMotion = "full" | "reduced" | "none";

export interface FactaVariables {
  accent?: string;
  accentInk?: string;
  accentSoft?: string;
  background?: string;
  surface?: string;
  text?: string;
  muted?: string;
  border?: string;
  success?: string;
  warning?: string;
  danger?: string;
  /** Any CSS length, e.g. `"16px"`. */
  radius?: string;
  /** Derived as round(radius × .64), min 2px, when `radius` is in px and this is absent. */
  radiusSm?: string;
  fontFamily?: string;
  /** Font family for the title and the total only. Falls back to `fontFamily`. */
  headingFontFamily?: string;
  /** Base text size (15px). */
  fontSizeBase?: string;
  /** Title size (18px). */
  titleSize?: string;
  /** Total amount size (32px). */
  totalSize?: string;
  /** Buttons (44px comfortable, 38px compact; 44px on touch). */
  buttonHeight?: string;
  /** Download tiles (56px comfortable, 48px compact). */
  downloadHeight?: string;
  /** Body/header/footer padding (20px comfortable, 16px compact). */
  space?: string;
  /** Vertical gap between blocks (12px comfortable, 8px compact). */
  gap?: string;
  /** Dialog width (480px). */
  windowWidth?: string;
  /** Drawer width (440px). */
  drawerWidth?: string;
  shadow?: string;
}

/** Per-slot inline styles, merged after the stylesheet (see `FactaClassNameSlot`). */
export type FactaStyles<T extends object = Record<string, string | number | undefined>> = Partial<Record<FactaSlot, T>>;

export type FactaSlot =
  | "root"
  | "overlay"
  | "card"
  | "header"
  | "title"
  | "chip"
  | "body"
  | "footer"
  | "primaryButton"
  | "secondaryButton"
  | "downloadButton"
  | "statusIcon"
  | "total"
  | "identifiers"
  | "storageRow"
  | "attribution"
  | "countdown"
  | "stepper"
  | "fieldList"
  | "quote";

export interface FactaAppearance {
  /** Same as the `styles` prop; appearance-level entries are the base. */
  styles?: FactaStyles<object>;
  theme?: FactaTheme;
  variables?: FactaVariables;
  density?: FactaDensity;
  motion?: FactaMotion;
}

const VARIABLE_MAP: Record<keyof FactaVariables, string> = {
  accent: "--facta-accent",
  accentInk: "--facta-accent-ink",
  accentSoft: "--facta-accent-soft",
  background: "--facta-bg",
  surface: "--facta-surface",
  text: "--facta-text",
  muted: "--facta-muted",
  border: "--facta-border",
  success: "--facta-success",
  warning: "--facta-warning",
  danger: "--facta-danger",
  radius: "--facta-radius",
  radiusSm: "--facta-radius-sm",
  fontFamily: "--facta-font",
  headingFontFamily: "--facta-font-heading",
  fontSizeBase: "--facta-font-size",
  titleSize: "--facta-title-size",
  totalSize: "--facta-total-size",
  buttonHeight: "--facta-button-height",
  downloadHeight: "--facta-download-height",
  space: "--facta-space",
  gap: "--facta-gap",
  windowWidth: "--facta-window-width",
  drawerWidth: "--facta-drawer-width",
  shadow: "--facta-shadow",
};

const INK_DARK = "#0b1419";

function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const A = luminance(a);
  const B = luminance(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

export interface InkChoice {
  ink: string;
  /** Contrast of the chosen ink on the accent. */
  ratio: number;
  /** The best of the two inks reaches WCAG AA (4.5:1). */
  ok: boolean;
}

/**
 * Picks the text colour for an accent fill: white when it reaches 4.5:1, else
 * the darker of white / #0b1419 that contrasts more. `null` when the accent is
 * not a hex or rgb() colour (oklch, var(), names): the stylesheet default stays.
 */
export function pickAccentInk(accent: string): InkChoice | null {
  const rgb = parseColor(accent);
  if (!rgb) return null;
  const white = contrast(rgb, [255, 255, 255]);
  const dark = contrast(rgb, parseColor(INK_DARK)!);
  const ink = white >= 4.5 ? "#ffffff" : dark > white ? INK_DARK : "#ffffff";
  const ratio = Math.max(white, dark);
  return { ink, ratio: ink === "#ffffff" ? white : dark, ok: ratio >= 4.5 };
}

const warned = new Set<string>();
let warnedOnce = false;

/** Test hook: forget the one-time console warning. */
export function resetAppearanceWarnings(): void {
  warned.clear();
  warnedOnce = false;
}

function warnLowContrast(accent: string, choice: InkChoice) {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.NODE_ENV === "production" || warnedOnce || warned.has(accent)) return;
  warnedOnce = true;
  warned.add(accent);
  console.warn(
    `[facta-ui] accent ${accent} reaches only ${choice.ratio.toFixed(1)}:1 with the best ink (${choice.ink}); ` +
      "WCAG AA needs 4.5:1. Pick a darker or lighter accent, or set variables.accentInk yourself.",
  );
}

/** CSS custom properties for the given variables (unknown keys are ignored). */
export function appearanceToCssVariables(
  variables: FactaVariables | undefined,
  options: { dark?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!variables) return out;
  for (const [key, cssName] of Object.entries(VARIABLE_MAP) as Array<[keyof FactaVariables, string]>) {
    const value = variables[key];
    if (typeof value === "string" && value.trim() !== "") out[cssName] = value;
  }
  const has = (k: keyof FactaVariables) => typeof variables[k] === "string" && variables[k]!.trim() !== "";
  // Derived tokens: what the host did not set follows from what it did.
  if (has("accent")) {
    const accent = variables.accent!;
    if (!has("accentInk")) {
      const choice = pickAccentInk(accent);
      if (choice) {
        out["--facta-accent-ink"] = choice.ink;
        if (!choice.ok) warnLowContrast(accent, choice);
      }
    }
    if (!has("accentSoft")) {
      out["--facta-accent-soft"] = `color-mix(in srgb, ${accent} ${options.dark ? 24 : 12}%, var(--facta-i-bg))`;
    }
  }
  if (has("background")) {
    const text = has("text") ? variables.text! : "var(--facta-i-text)";
    if (!has("surface")) out["--facta-surface"] = `color-mix(in srgb, ${variables.background} 95%, ${text})`;
    if (!has("border")) out["--facta-border"] = `color-mix(in srgb, ${variables.background} 86%, ${text})`;
  }
  if (has("text") && !has("muted")) {
    const bg = has("background") ? variables.background! : "var(--facta-i-bg)";
    out["--facta-muted"] = `color-mix(in srgb, ${variables.text} 62%, ${bg})`;
  }
  if (has("radius") && !has("radiusSm")) {
    const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(variables.radius!);
    if (m) out["--facta-radius-sm"] = `${Math.max(2, Math.round(Number(m[1]) * 0.64))}px`;
  }
  return out;
}

/** Later appearances win; `variables` merge key by key. */
export function mergeAppearance(...layers: Array<FactaAppearance | undefined>): FactaAppearance {
  const out: FactaAppearance = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.theme) out.theme = layer.theme;
    if (layer.density) out.density = layer.density;
    if (layer.motion) out.motion = layer.motion;
    if (layer.variables) out.variables = { ...out.variables, ...layer.variables };
    if (layer.styles) out.styles = { ...out.styles, ...layer.styles };
  }
  return out;
}

/** `full` becomes `reduced` when the person asked the OS for less motion. */
export function resolveMotion(motion: FactaMotion | undefined, prefersReduced: boolean): FactaMotion {
  const wanted = motion ?? "full";
  return wanted === "full" && prefersReduced ? "reduced" : wanted;
}
