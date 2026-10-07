import { useMemo, useState, type ReactNode } from "react";
import { CodeBlock } from "../../code-block.tsx";
import { SOURCES, type SourcePath } from "../../shown-files.ts";
import { usePlayground } from "../../state.tsx";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
import { CheckoutForm } from "./checkout-form.tsx";
import { CreditSwitch } from "./credit-switch.tsx";
import { PosKeypad } from "./pos-keypad.tsx";
import { DocumentForms } from "../../components/document-forms.tsx";
import type { IssuedDocument } from "./outcome.tsx";
import { PageGuideCard } from "../guides/page-guide.tsx";
import "./headless.css";

// Section «Mi propia implementación» (docs/playground.md §5.3): the issuing flow
// without the SDK's visual components. Each example runs for real against the
// handler, wears its own identity (the point is that an integrator uses its brand),
// and shows the file that runs.
const lines = (source: string) => source.trimEnd().split("\n").length;

interface Example { id: string; title: string; text: string; path: SourcePath; file: string; stage: ReactNode; tone: string }
interface Shown extends IssuedDocument { by: string }

export function Headless() {
  const { view } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const exhausted = state?.quota != null && !state.quota.allowed;
  const ready = useTurnstileReady();
  const disabled = state === null || state.visitor === null || exhausted || !ready;
  const [open, setOpen] = useState<string | null>(null);
  // The last document an example issued. Its three forms render below the grid, never inside a themed card.
  const [issued, setIssued] = useState<Shown | null>(null);
  // Stable per example: Outcome reports from an effect, so a new function on every render would loop.
  const reporters = useMemo(() => {
    const make = (by: string) => (document: IssuedDocument | null) =>
      setIssued((current) => (document !== null ? { ...document, by } : current?.by === by ? null : current));
    return { checkout: make("checkout"), pos: make("pos"), ccf: make("ccf") };
  }, []);

  const examples: Example[] = [
    { id: "checkout", tone: "cafe", title: "Checkout de una tienda", text: "createFactaClient y createIssueFlow, sin React.", path: "playground/site/sections/headless/checkout-form.tsx", file: "sections/headless/checkout-form.tsx", stage: <CheckoutForm disabled={disabled} onDocument={reporters.checkout} /> },
    { id: "pos", tone: "pos", title: "Punto de venta", text: "useFactaIssue con su propio teclado y sus propios estados.", path: "playground/site/sections/headless/pos-keypad.tsx", file: "sections/headless/pos-keypad.tsx", stage: <PosKeypad disabled={disabled} onDocument={reporters.pos} /> },
    { id: "ccf", tone: "ccf", title: "Factura o crédito fiscal", text: "El servidor arma una Factura o un CCF según la respuesta.", path: "playground/site/sections/headless/credit-switch.tsx", file: "sections/headless/credit-switch.tsx", stage: <CreditSwitch disabled={disabled} onDocument={reporters.ccf} /> },
  ];
  const shown = examples.find((e) => e.id === open) ?? null;

  return (
    <div className="pg-wrap hl">
      <header className="hl-head">
        <p className="pg-eyebrow">@facta-dte/api/browser · useFactaIssue</p>
        <h1>Su diseño, el flujo de Facta DTE</h1>
        <p className="hl-lead">
          Tres interfaces que no usan ningún componente visual del SDK. Cada una emite de verdad contra staging y cabe en menos de 60 líneas.
        </p>
        {state !== null && state.visitor === null && <p className="pg-note">Inicie sesión para emitir facturas de prueba.</p>}
        <TurnstileBox />
        {exhausted && <p className="pg-note">Límite alcanzado. Intente de nuevo más tarde.</p>}
      </header>

      <PageGuideCard id="headless" />

      <div className="hl-grid">
        {examples.map((e) => (
          <article key={e.id} className="hl-card" aria-labelledby={`hl-${e.id}`}>
            <div className={`hl-stage hl-stage--${e.tone}`}>{e.stage}</div>
            <div className="hl-foot">
              <div className="hl-foot-row">
                <h2 id={`hl-${e.id}`}>{e.title}</h2>
                <span className="mono">{lines(SOURCES[e.path])} líneas</span>
              </div>
              <p>{e.text}</p>
              <button type="button" className="hl-code-toggle" aria-expanded={open === e.id} aria-controls="hl-source" onClick={() => setOpen(open === e.id ? null : e.id)}>
                {open === e.id ? "Ocultar el código" : "Ver el código"} {open === e.id ? "↑" : "→"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {issued !== null && (
        <section className="hl-forms" aria-labelledby="hl-forms-title" data-example={issued.by}>
          <h2 id="hl-forms-title">El mismo documento, en las formas que puede entregar su sistema</h2>
          <p className="pg-note">Es el documento que acaba de emitir «{examples.find((e) => e.id === issued.by)?.title}». Estas tres formas las pide su servidor al API; las tarjetas de arriba solo muestran el resultado con su propio diseño.</p>
          <DocumentForms code={issued.code} estado={issued.estado} seal={issued.seal} showHow={false} title="La hoja carta, el ticket de punto de venta y el JSON DTE: el mismo documento legal." />
        </section>
      )}

      <p className="hl-note">Los tres ejemplos muestran cada estado del flujo: emitiendo, sellada, contingencia, rechazada y sesión vencida.</p>

      <div id="hl-source" className="hl-source" aria-live="polite">
        {shown !== null && (
          <>
            <CodeBlock title={shown.file} code={SOURCES[shown.path]} path={shown.path} />
            <CodeBlock title="Comparten · sections/headless/outcome.tsx (cada estado, con estilos propios)" code={SOURCES["playground/site/sections/headless/outcome.tsx"]} path="playground/site/sections/headless/outcome.tsx" />
          </>
        )}
      </div>
    </div>
  );
}
