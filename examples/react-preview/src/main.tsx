import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FactaInvoiceDialog,
  FactaInvoiceDrawer,
  FactaInvoiceInline,
  FactaIssueButton,
  FactaProvider,
  FactaReceipt,
  FactaStatusBadge,
  useFactaWindow,
  type FactaAppearance,
  type FactaBranding,
  type AutoCloseOn,
  type RunMode,
} from "../../../react.ts";
import "../../../src/react/styles.css";
import { createMockFetch, type Outcome } from "./mock-handler.ts";
import { Gallery } from "./gallery.tsx";

function AltamiraMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

// The three presets of docs/design/react-ui/appearance.html.
const PRESETS: Record<string, { appearance: FactaAppearance; branding: FactaBranding; theme?: "light" | "dark" | "auto" }> = {
  torogoz: { appearance: { theme: "auto" }, branding: {} },
  pos: {
    appearance: { theme: "dark", variables: { accent: "#1f7a4d", radius: "8px" }, density: "compact" },
    branding: { name: "Ferretería San Miguel" },
  },
  erp: {
    appearance: {
      theme: "auto",
      variables: { accent: "#6d4bd8", radius: "4px", headingFontFamily: "'Source Serif 4', Georgia, serif" },
      motion: "reduced",
    },
    branding: { name: "Grupo Altamira", logo: <AltamiraMark />, attribution: false },
  },
};

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "sealed-delivered", "sealed-delivering", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

function Imperative({ run, delay, on }: { run: RunMode; delay: number; on: AutoCloseOn }) {
  const { open } = useFactaWindow();
  const [log, setLog] = useState("");
  return (
    <p>
      <button onClick={() => open(`tok-${Math.random()}`, { run, autoCloseDelay: delay, autoCloseOn: on }).then((r) => setLog(`Emitida ${r.numeroControl}`), (e: Error) => setLog(`Sin documento: ${e.message}`))}>
        useFactaWindow().open()
      </button>{" "}
      <small>{log}</small>
    </p>
  );
}

function App() {
  const [outcome, setOutcome] = useState<Outcome>("sealed");
  const [environment, setEnvironment] = useState<"00" | "01">("00");
  const [preset, setPreset] = useState("torogoz");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("light");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [attribution, setAttribution] = useState(true);
  const [run, setRun] = useState<RunMode>("manual");
  const [delay, setDelay] = useState(1200);
  const [on, setOn] = useState<AutoCloseOn>("success");
  const [dialog, setDialog] = useState<"dialog" | "drawer" | null>(null);
  const [n, setN] = useState(0);
  const session = `tok-${n}`;
  const mockFetch = useMemo(() => createMockFetch({ outcome, environment }), [outcome, environment, n]);
  const p = PRESETS[preset]!;
  const custom = preset === "torogoz";
  const appearance: FactaAppearance = { ...p.appearance, theme: custom ? theme : p.appearance.theme ?? theme, density: custom ? density : p.appearance.density ?? density };
  const branding: FactaBranding = { ...p.branding, attribution: p.branding.attribution ?? attribution };

  return (
    <FactaProvider endpoint="/mock" fetch={mockFetch} appearance={appearance} branding={branding}>
      <div className="pv-bar">
        <label>Resultado<select value={outcome} onChange={(e) => { setOutcome(e.target.value as Outcome); setN((x) => x + 1); }}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label>Ambiente<select value={environment} onChange={(e) => { setEnvironment(e.target.value as "00" | "01"); setN((x) => x + 1); }}><option>00</option><option>01</option></select></label>
        <label>Marca<select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="torogoz">Torogoz</option><option value="pos">Punto de venta</option><option value="erp">ERP en marca blanca</option></select></label>
        <label>Tema<select value={theme} onChange={(e) => setTheme(e.target.value as "light")}><option>light</option><option>dark</option><option>auto</option></select></label>
        <label>Densidad<select value={density} onChange={(e) => setDensity(e.target.value as "compact")}><option>comfortable</option><option>compact</option></select></label>
        <label><span>Atribución</span><input type="checkbox" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} /></label>
        <label>Modo de ejecución<select value={run} onChange={(e) => { setRun(e.target.value as RunMode); setN((x) => x + 1); }}><option value="manual">manual</option><option value="auto">auto</option><option value="auto-close">auto-close</option></select></label>
        <label>Cierre (ms)<input type="number" min={0} step={100} value={delay} onChange={(e) => setDelay(Number(e.target.value))} style={{ width: 80 }} /></label>
        <label>Cerrar en<select value={on} onChange={(e) => setOn(e.target.value as AutoCloseOn)}><option value="success">success</option><option value="any">any</option></select></label>
        <button onClick={() => setN((x) => x + 1)}>Nueva sesión</button>
      </div>
      <main>
        <section>
          <h2>En vivo</h2>
          <p>
            <button onClick={() => { setN((x) => x + 1); setDialog("dialog"); }}>Abrir diálogo</button>{" "}
            <button onClick={() => { setN((x) => x + 1); setDialog("drawer"); }}>Abrir panel lateral</button>
          </p>
          <Imperative run={run} delay={delay} on={on} />
          <p><FactaIssueButton key={`${session}-${run}`} session={session} run={run} autoCloseOn={on} /></p>
          <div style={{ maxWidth: 520 }}><FactaInvoiceInline key={`i-${session}-${run}`} session={session} run={run} autoCloseDelay={delay} autoCloseOn={on} /></div>
          <p><FactaStatusBadge estado="sellado" /> <FactaStatusBadge estado="contingencia" /> <FactaStatusBadge estado="rechazado" /></p>
        </section>
        <Gallery />
        <section>
          <h2>Recibo</h2>
          <div style={{ maxWidth: 520 }}>
            <FactaReceipt reference="#1042" environment={environment} result={{ estado: "sellado", codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34", numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: environment, fecEmi: "2026-10-05", horEmi: "14:32:10", selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD", totales: { totalPagar: 22.25 }, storage: { managed: "pending", archive: "partial" }, delivery: { canales: { correo: { estado: "enviado", destino: "m•••@ejemplo.com" }, whatsapp: { estado: "sin_credito", destino: "+503 •••• 0000", motivo: "wallet_empty" } } } }} />
          </div>
        </section>
      </main>
      <FactaInvoiceDialog session={session} run={run} autoCloseDelay={delay} autoCloseOn={on} open={dialog === "dialog"} onOpenChange={(o) => !o && setDialog(null)} />
      <FactaInvoiceDrawer session={session} run={run} autoCloseDelay={delay} autoCloseOn={on} open={dialog === "drawer"} onOpenChange={(o) => !o && setDialog(null)} />
    </FactaProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
