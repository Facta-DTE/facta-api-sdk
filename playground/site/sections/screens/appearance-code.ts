// The appearance studio's state and the JSX it prints. Pure (no React, no DOM), so a test
// can pin the output: what the visitor copies must be what the preview used.

export type StudioTheme = "light" | "dark" | "auto";
export type StudioDensity = "comfortable" | "compact";
export type StudioMotion = "full" | "reduced" | "none";

export interface StudioState {
  theme: StudioTheme;
  density: StudioDensity;
  motion: StudioMotion;
  /** `#rrggbb`, or "" to keep the SDK default. */
  accent: string;
  /** Pixels, or null to keep the default. */
  radius: number | null;
  fontFamily: string;
  headingFontFamily: string;
  brandName: string;
  /** Show a sample logo element next to the name. */
  logo: boolean;
  /** `false` hides «Powered by factadte.com». */
  attribution: boolean;
  /** Apply the playground's own classes to three slots. */
  classNames: boolean;
  /** Message overrides; empty strings keep the SDK text. */
  issueLabel: string;
  cancelLabel: string;
  testChip: string;
}

export const DEFAULT_STUDIO: StudioState = {
  theme: "auto", density: "comfortable", motion: "full", accent: "", radius: null,
  fontFamily: "", headingFontFamily: "", brandName: "", logo: false, attribution: true,
  classNames: false, issueLabel: "", cancelLabel: "", testChip: "",
};

/** Only system stacks: the playground's CSP allows no remote fonts, and neither do many hosts. */
export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: "Predeterminada", value: "" },
  { label: "Sistema (sans-serif)", value: "system-ui, sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', system-ui, sans-serif" },
  { label: "Monoespaciada", value: "ui-monospace, Menlo, Consolas, monospace" },
];

/** The three presets of docs/design/react-ui/appearance.html, as in the SDK preview. */
export const PRESETS: Record<string, { label: string; state: Partial<StudioState> }> = {
  torogoz: { label: "Torogoz (por defecto)", state: {} },
  pos: {
    label: "Punto de venta",
    state: { theme: "dark", density: "compact", accent: "#1f7a4d", radius: 8, brandName: "Ferretería San Miguel" },
  },
  erp: {
    label: "ERP en marca blanca",
    state: {
      theme: "auto", motion: "reduced", accent: "#6d4bd8", radius: 4,
      headingFontFamily: "Georgia, 'Times New Roman', serif", brandName: "Grupo Altamira", logo: true, attribution: false,
    },
  },
};

export function applyPreset(name: string): StudioState {
  return { ...DEFAULT_STUDIO, ...(PRESETS[name]?.state ?? {}) };
}

/** Class names the demo styles in `screens.css`; a real host would bring its own. */
export const DEMO_CLASS_NAMES = { primaryButton: "my-primary", card: "my-card", total: "my-total" } as const;

const q = (value: string) => JSON.stringify(value);

/** The props the studio applied, in the exact shape `FactaProvider` takes. */
export function studioProps(state: StudioState) {
  const variables: Record<string, string> = {};
  if (state.accent !== "") variables.accent = state.accent;
  if (state.radius !== null) variables.radius = `${state.radius}px`;
  if (state.fontFamily !== "") variables.fontFamily = state.fontFamily;
  if (state.headingFontFamily !== "") variables.headingFontFamily = state.headingFontFamily;
  const appearance: { theme: StudioTheme; density?: StudioDensity; motion?: StudioMotion; variables?: Record<string, string> } = { theme: state.theme };
  if (state.density !== "comfortable") appearance.density = state.density;
  if (state.motion !== "full") appearance.motion = state.motion;
  if (Object.keys(variables).length > 0) appearance.variables = variables;

  const brandingActive = state.brandName.trim() !== "" || state.logo || !state.attribution;
  const messages: { review?: { issue?: string; cancel?: string }; chipTest?: string } = {};
  if (state.issueLabel.trim() !== "" || state.cancelLabel.trim() !== "") {
    messages.review = {
      ...(state.issueLabel.trim() === "" ? {} : { issue: state.issueLabel.trim() }),
      ...(state.cancelLabel.trim() === "" ? {} : { cancel: state.cancelLabel.trim() }),
    };
  }
  if (state.testChip.trim() !== "") messages.chipTest = state.testChip.trim();
  return {
    appearance,
    branding: brandingActive ? { name: state.brandName.trim(), logo: state.logo, attribution: state.attribution } : null,
    classNames: state.classNames ? { ...DEMO_CLASS_NAMES } : null,
    messages: Object.keys(messages).length > 0 ? messages : null,
  };
}

/** The JSX a developer pastes: a provider with only the props that differ from the defaults. */
export function appearanceCode(state: StudioState): string {
  const props = studioProps(state);
  const lines: string[] = ['<FactaProvider', '  endpoint="/api/facta"'];

  const a = props.appearance;
  const parts = [`theme: ${q(a.theme)}`];
  if (a.density) parts.push(`density: ${q(a.density)}`);
  if (a.motion) parts.push(`motion: ${q(a.motion)}`);
  if (a.variables) {
    parts.push(`variables: { ${Object.entries(a.variables).map(([k, v]) => `${k}: ${q(v)}`).join(", ")} }`);
  }
  lines.push(`  appearance={{ ${parts.join(", ")} }}`);

  if (props.branding !== null) {
    const b: string[] = [];
    if (props.branding.name !== "") b.push(`name: ${q(props.branding.name)}`);
    if (props.branding.logo) b.push("logo: <MyLogo />");
    if (!props.branding.attribution) b.push("attribution: false");
    lines.push(`  branding={{ ${b.join(", ")} }}`);
  }
  if (props.classNames !== null) {
    lines.push(`  classNames={{ ${Object.entries(props.classNames).map(([k, v]) => `${k}: ${q(v)}`).join(", ")} }}`);
  }
  if (props.messages !== null) {
    const m: string[] = [];
    if (props.messages.review) {
      m.push(`review: { ${Object.entries(props.messages.review).map(([k, v]) => `${k}: ${q(v)}`).join(", ")} }`);
    }
    if (props.messages.chipTest) m.push(`chipTest: ${q(props.messages.chipTest)}`);
    lines.push(`  messages={{ ${m.join(", ")} }}`);
  }
  lines.push('>', '  {/* your screens */}', '</FactaProvider>');
  return lines.join("\n");
}
