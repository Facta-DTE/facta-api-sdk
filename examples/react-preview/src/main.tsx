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
} from "../../../react.ts";
import "../../../src/react/styles.css";
import { createMockFetch, type Outcome } from "./mock-handler.ts";
import { Gallery } from "./gallery.tsx";

const PRESETS: Record<string, { appearance: FactaAppearance; branding: FactaBranding }> = {
  torogoz: { appearance: {}, branding: {} },
  pos: {
    appearance: { theme: "dark", variables: { accent: "#2fbf71", accentInk: "#04210f", radius: "10px" }, density: "compact" },
    branding: { name: "Caja 2 · Café del Volcán" },
  },
  erp: {
    appearance: { variables: { accent: "#6d3df5", radius: "6px", fontFamily: "Georgia, serif" } },
    branding: { name: "Nubia ERP", logo: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='10' fill='%236d3df5'/></svg>", attribution: false },
  },
};

const OUTCOMES: Outcome[] = ["sealed", "sealed-copies-pending", "contingency", "rejected", "uncertain-then-sealed", "failed-retryable", "expired"];

function Imperative() {
  const { open } = useFactaWindow();
  const [log, setLog] = useState("");
  return (
    <p>
      <button onClick={() => open(`tok-${Math.random()}`).then((r) => setLog(`Emitida ${r.numeroControl}`), (e: Error) => setLog(`Sin documento: ${e.message}`))}>
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
  const [confirm, setConfirm] = useState(true);
  const [dialog, setDialog] = useState<"dialog" | "drawer" | null>(null);
  const [n, setN] = useState(0);
  const session = `tok-${n}`;
  const mockFetch = useMemo(() => createMockFetch({ outcome, environment }), [outcome, environment, n]);
  const p = PRESETS[preset]!;
  const appearance: FactaAppearance = { ...p.appearance, theme: preset === "torogoz" ? theme : p.appearance.theme ?? theme, density: preset === "torogoz" ? density : p.appearance.density ?? density };
  const branding: FactaBranding = { ...p.branding, attribution: p.branding.attribution ?? attribution };

  return (
    <FactaProvider endpoint="/mock" fetch={mockFetch} appearance={appearance} branding={branding}>
      <div className="pv-bar">
        <label>Resultado<select value={outcome} onChange={(e) => { setOutcome(e.target.value as Outcome); setN((x) => x + 1); }}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label>Ambiente<select value={environment} onChange={(e) => { setEnvironment(e.target.value as "00" | "01"); setN((x) => x + 1); }}><option>00</option><option>01</option></select></label>
        <label>Marca<select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="torogoz">Torogoz</option><option value="pos">POS verde oscuro</option><option value="erp">ERP morado (marca blanca)</option></select></label>
        <label>Tema<select value={theme} onChange={(e) => setTheme(e.target.value as "light")}><option>light</option><option>dark</option><option>auto</option></select></label>
        <label>Densidad<select value={density} onChange={(e) => setDensity(e.target.value as "compact")}><option>comfortable</option><option>compact</option></select></label>
        <label><span>Atribución</span><input type="checkbox" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} /></label>
        <label><span>Confirmar</span><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /></label>
        <button onClick={() => setN((x) => x + 1)}>Nueva sesión</button>
      </div>
      <main>
        <section>
          <h2>En vivo</h2>
          <p>
            <button onClick={() => { setN((x) => x + 1); setDialog("dialog"); }}>Abrir diálogo</button>{" "}
            <button onClick={() => { setN((x) => x + 1); setDialog("drawer"); }}>Abrir panel lateral</button>
          </p>
          <Imperative />
          <p><FactaIssueButton key={session} session={session} confirm={confirm ? true : false} /></p>
          <div style={{ maxWidth: 520 }}><FactaInvoiceInline key={`i-${session}`} session={session} confirm={confirm} /></div>
          <p><FactaStatusBadge estado="sellado" /> <FactaStatusBadge estado="contingencia" /> <FactaStatusBadge estado="rechazado" /></p>
        </section>
        <Gallery />
        <section>
          <h2>Recibo</h2>
          <div style={{ maxWidth: 520 }}>
            <FactaReceipt environment={environment} result={{ estado: "sellado", codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34", numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: environment, fecEmi: "2026-10-05", horEmi: "14:32:10", selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD", totales: { totalPagar: 22.25 }, storage: { managed: "pending", archive: "partial" } }} />
          </div>
        </section>
      </main>
      <FactaInvoiceDialog session={session} confirm={confirm} open={dialog === "dialog"} onOpenChange={(o) => !o && setDialog(null)} />
      <FactaInvoiceDrawer session={session} confirm={confirm} open={dialog === "drawer"} onOpenChange={(o) => !o && setDialog(null)} />
    </FactaProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
