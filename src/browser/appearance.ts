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
  fontFamily?: string;
  fontSizeBase?: string;
  shadow?: string;
}

export interface FactaAppearance {
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
  fontFamily: "--facta-font",
  fontSizeBase: "--facta-font-size",
  shadow: "--facta-shadow",
};

/** CSS custom properties for the given variables (unknown keys are ignored). */
export function appearanceToCssVariables(variables: FactaVariables | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!variables) return out;
  for (const [key, cssName] of Object.entries(VARIABLE_MAP) as Array<[keyof FactaVariables, string]>) {
    const value = variables[key];
    if (typeof value === "string" && value.trim() !== "") out[cssName] = value;
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
  }
  return out;
}

/** `full` becomes `reduced` when the person asked the OS for less motion. */
export function resolveMotion(motion: FactaMotion | undefined, prefersReduced: boolean): FactaMotion {
  const wanted = motion ?? "full";
  return wanted === "full" && prefersReduced ? "reduced" : wanted;
}
