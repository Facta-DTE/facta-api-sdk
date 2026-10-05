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
  | "deliveryRow"
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
 * not a hex or rgb() colour (oklch, hsl, var(), names): use `resolveAccentInk`
 * in a browser, which asks the computed colour first.
 */
export function pickAccentInk(accent: string): InkChoice | null {
  const rgb = parseColor(accent);
  return rgb ? inkFor(rgb) : null;
}

type Rgb = [number, number, number];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function encodeSrgb(linear: number): number {
  const c = clamp01(linear);
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

function oklabToSrgb(L: number, a: number, b: number): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hslToSrgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

function channel(token: string | undefined, percentScale: number): number {
  if (token === undefined || token === "none") return 0;
  return token.endsWith("%") ? (parseFloat(token) / 100) * percentScale : parseFloat(token);
}

function hue(token: string | undefined): number {
  if (token === undefined || token === "none") return 0;
  const n = parseFloat(token);
  if (token.endsWith("turn")) return n * 360;
  if (token.endsWith("rad")) return (n * 180) / Math.PI;
  if (token.endsWith("grad")) return n * 0.9;
  return n;
}

/**
 * Converts a computed colour string to sRGB 0-255: rgb(), hex, color(srgb),
 * hsl(), oklab() and oklch() (browsers keep oklch as written when computing).
 * `null` for anything else (lab(), color(display-p3)…): the caller can still
 * ask a canvas.
 */
export function colorToSrgb(value: string): Rgb | null {
  const plain = parseColor(value);
  if (plain) return plain;
  const v = value.trim().toLowerCase();
  const fn = /^([a-z-]+)\(\s*(.*?)\s*\)$/.exec(v);
  if (!fn) return null;
  const args = fn[2]!.split("/")[0]!.trim().split(/[\s,]+/).filter(Boolean);
  switch (fn[1]) {
    case "rgb":
    case "rgba":
      return [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, channel(args[i], 255))))) as Rgb;
    case "color":
      if (args[0] !== "srgb") return null;
      return [1, 2, 3].map((i) => Math.round(clamp01(channel(args[i], 1)) * 255)) as Rgb;
    case "hsl":
    case "hsla":
      return hslToSrgb(((hue(args[0]) % 360) + 360) % 360, clamp01(channel(args[1], 1) / (args[1]?.endsWith("%") ? 1 : 100)), clamp01(channel(args[2], 1) / (args[2]?.endsWith("%") ? 1 : 100))).map(Math.round) as Rgb;
    case "oklab": {
      const rgb = oklabToSrgb(channel(args[0], 1), channel(args[1], 0.4), channel(args[2], 0.4));
      return rgb.map(Math.round) as Rgb;
    }
    case "oklch": {
      const C = channel(args[1], 0.4);
      const h = (hue(args[2]) * Math.PI) / 180;
      return oklabToSrgb(channel(args[0], 1), C * Math.cos(h), C * Math.sin(h)).map(Math.round) as Rgb;
    }
    default:
      return null;
  }
}

function inkFor(rgb: Rgb): InkChoice {
  const white = contrast(rgb, [255, 255, 255]);
  const dark = contrast(rgb, parseColor(INK_DARK)!);
  const ink = white >= 4.5 ? "#ffffff" : dark > white ? INK_DARK : "#ffffff";
  const ratio = Math.max(white, dark);
  return { ink, ratio: ink === "#ffffff" ? white : dark, ok: ratio >= 4.5 };
}

/**
 * Ink for an accent the pure function cannot read (oklch(), hsl(), a named
 * colour, `var(--brand)`): asks the browser what the colour is where the
 * widget lives. A probe element inside `root` resolves `var()` and inheritance;
 * its computed colour is converted to sRGB (or painted on a 1x1 canvas for
 * spaces we do not convert) and then the usual WCAG pick applies.
 * `null` outside a browser or when the value is not a valid colour.
 */
export function resolveAccentInk(accent: string, root: Element): InkChoice | null {
  const doc = root.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return null;
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  const supports = (view as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS?.supports;
  if (typeof supports === "function" && !supports.call((view as { CSS?: object }).CSS, "color", accent)) return null;
  probe.style.color = accent;
  root.appendChild(probe);
  try {
    const computed = view.getComputedStyle(probe).color;
    let rgb = colorToSrgb(computed);
    if (!rgb) {
      const ctx = doc.createElement("canvas").getContext?.("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = computed;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        rgb = [d[0]!, d[1]!, d[2]!];
      }
    }
    if (!rgb) return null;
    const choice = inkFor(rgb);
    if (!choice.ok) warnLowContrast(accent, choice);
    return choice;
  } catch {
    return null;
  } finally {
    probe.remove();
  }
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
