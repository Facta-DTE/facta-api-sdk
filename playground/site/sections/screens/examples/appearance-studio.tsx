import { useMemo, useState } from "react";
import {
  FactaInvoiceDialog,
  FactaInvoiceInline,
  FactaProvider,
  FactaReceipt,
  FactaStatusBadge,
  type IssueResult,
} from "../../../../../react.ts";
import { mockFetch } from "../../../api.ts";
import { CodeBlock } from "../../../code-block.tsx";
import {
  appearanceCode,
  applyPreset,
  FONT_CHOICES,
  PRESETS,
  studioProps,
  type StudioDensity,
  type StudioMotion,
  type StudioState,
  type StudioTheme,
} from "../appearance-code.ts";

function SampleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

// A sealed result to style without issuing anything (the receipt reads it, no network).
const SAMPLE: IssueResult = {
  estado: "sellado",
  codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34",
  numeroControl: "DTE-01-M001P001-000000000000042",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-06",
  horEmi: "14:32:10",
  selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD",
  totales: { totalPagar: 22.25 },
};

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void;
}) {
  return (
    <label className="pg-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

// Every control changes the props of a real window and the code printed below it.
// `session` is the prepared sale; without one the receipt and badges still show the look.
export function AppearanceStudio({ session, canPrepare, onPrepare }: { session: string | null; canPrepare: boolean; onPrepare: () => void }) {
  const [state, setState] = useState<StudioState>(() => applyPreset("torogoz"));
  const [preset, setPreset] = useState("torogoz");
  const [dialog, setDialog] = useState(false);
  const set = <K extends keyof StudioState>(key: K, value: StudioState[K]) => setState((s) => ({ ...s, [key]: value }));

  const look = useMemo(() => {
    const props = studioProps(state);
    return {
      appearance: props.appearance,
      ...(props.branding === null ? {} : { branding: { name: props.branding.name, attribution: props.branding.attribution, ...(props.branding.logo ? { logo: <SampleLogo /> } : {}) } }),
      ...(props.classNames === null ? {} : { classNames: props.classNames }),
      ...(props.messages === null ? {} : { messages: props.messages }),
    };
  }, [state]);

  return (
    <div className="pg-studio">
      <div className="pg-studio-controls">
        <Choice
          label="Punto de partida"
          value={preset}
          options={Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))}
          onChange={(value) => { setPreset(value); setState(applyPreset(value)); }}
        />
        <fieldset>
          <legend>Tokens</legend>
          <div className="pg-form-grid pg-form-grid--3">
            <Choice<StudioTheme> label="Tema" value={state.theme} options={[{ value: "auto", label: "Automático" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }]} onChange={(v) => set("theme", v)} />
            <Choice<StudioDensity> label="Densidad" value={state.density} options={[{ value: "comfortable", label: "Cómoda" }, { value: "compact", label: "Compacta" }]} onChange={(v) => set("density", v)} />
            <Choice<StudioMotion> label="Movimiento" value={state.motion} options={[{ value: "full", label: "Completo" }, { value: "reduced", label: "Reducido" }, { value: "none", label: "Ninguno" }]} onChange={(v) => set("motion", v)} />
          </div>
          <div className="pg-form-grid">
            <label className="pg-field">
              <span>Color de acento {state.accent === "" ? "(por defecto)" : state.accent}</span>
              <input type="color" value={state.accent || "#007faa"} onChange={(event) => set("accent", event.target.value)} />
            </label>
            <label className="pg-field">
              <span>Radio de esquinas: {state.radius === null ? "por defecto" : `${state.radius}px`}</span>
              <input type="range" min={0} max={24} value={state.radius ?? 12} onChange={(event) => set("radius", Number(event.target.value))} />
            </label>
            <Choice label="Tipografía" value={state.fontFamily} options={FONT_CHOICES} onChange={(v) => set("fontFamily", v)} />
            <Choice label="Tipografía de títulos" value={state.headingFontFamily} options={FONT_CHOICES} onChange={(v) => set("headingFontFamily", v)} />
          </div>
          <button type="button" className="pg-secondary" onClick={() => { set("accent", ""); set("radius", null); }}>Restablecer acento y radio</button>
        </fieldset>
        <fieldset>
          <legend>Marca</legend>
          <label className="pg-field">
            <span>Nombre del negocio</span>
            <input type="text" maxLength={40} value={state.brandName} onChange={(event) => set("brandName", event.target.value)} placeholder="Ferretería San Miguel" />
          </label>
          <label className="pg-check"><input type="checkbox" checked={state.logo} onChange={(event) => set("logo", event.target.checked)} />Mostrar un logo de ejemplo</label>
          <label className="pg-check"><input type="checkbox" checked={state.attribution} onChange={(event) => set("attribution", event.target.checked)} />Mostrar «Powered by factadte.com»</label>
        </fieldset>
        <fieldset>
          <legend>Clases y textos</legend>
          <label className="pg-check"><input type="checkbox" checked={state.classNames} onChange={(event) => set("classNames", event.target.checked)} />Aplicar clases propias a <code>primaryButton</code>, <code>card</code> y <code>total</code></label>
          <div className="pg-form-grid pg-form-grid--3">
            <label className="pg-field"><span>Botón «Emitir»</span><input type="text" maxLength={24} value={state.issueLabel} onChange={(event) => set("issueLabel", event.target.value)} placeholder="Emitir factura" /></label>
            <label className="pg-field"><span>Botón «Cancelar»</span><input type="text" maxLength={24} value={state.cancelLabel} onChange={(event) => set("cancelLabel", event.target.value)} placeholder="Cancelar" /></label>
            <label className="pg-field"><span>Etiqueta de pruebas</span><input type="text" maxLength={24} value={state.testChip} onChange={(event) => set("testChip", event.target.value)} placeholder="Pruebas" /></label>
          </div>
        </fieldset>
      </div>

      <div className="pg-studio-preview">
        <FactaProvider endpoint="/api/facta" fetch={mockFetch()} {...look}>
          <div className="pg-studio-sample" aria-label="Ventana de emisión en vivo">
            {session !== null ? (
              <FactaInvoiceInline key={`${session}-${state.density}`} session={session} run="manual" />
            ) : (
              <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
                <p className="pg-note" style={{ margin: 0 }}>La ventana real necesita una venta preparada.</p>
                <button type="button" className="pg-primary" disabled={!canPrepare} onClick={onPrepare}>Preparar una venta de ejemplo</button>
              </div>
            )}
          </div>
          <div className="pg-studio-sample">
            <FactaReceipt result={SAMPLE} environment="00" reference="Playground" />
            <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <FactaStatusBadge estado="sellado" /> <FactaStatusBadge estado="contingencia" /> <FactaStatusBadge estado="rechazado" />
            </p>
          </div>
          {session !== null && (
            <>
              <button type="button" className="pg-secondary" onClick={() => setDialog(true)}>Ver como diálogo</button>
              <FactaInvoiceDialog session={session} run="manual" open={dialog} onOpenChange={setDialog} />
            </>
          )}
        </FactaProvider>
        <CodeBlock title="Su código · props resultantes" code={appearanceCode(state)} />
      </div>
    </div>
  );
}
