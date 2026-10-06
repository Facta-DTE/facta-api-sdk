import { CodeBlock } from "../../code-block.tsx";
import { usePlayground } from "../../state.tsx";
import { CheckoutForm } from "./checkout-form.tsx";
import checkoutSource from "./checkout-form.tsx?raw";
import { CreditSwitch } from "./credit-switch.tsx";
import creditSource from "./credit-switch.tsx?raw";
import outcomeSource from "./outcome.tsx?raw";
import { PosKeypad } from "./pos-keypad.tsx";
import posSource from "./pos-keypad.tsx?raw";
import "./headless.css";

// Section «Mi propia implementación» (docs/playground.md §5.3): the issuing flow
// without the SDK's visual components. Each example runs for real against the
// handler and shows the file that runs.
export function Headless() {
  const { view } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const exhausted = state?.quota != null && !state.quota.allowed;
  const disabled = state === null || state.visitor === null || exhausted;

  return (
    <section className="pg-page">
      <header className="pg-hero">
        <p className="pg-eyebrow">Su interfaz, el motor del SDK</p>
        <h1>Mi propia implementación</h1>
        <p className="pg-lead">
          Tres ejemplos que no usan ninguna pantalla del SDK. Emiten de verdad en el ambiente de pruebas y
          cada uno muestra, debajo, el archivo completo que acaba de ejecutar.
        </p>
        {state !== null && state.visitor === null && <p className="pg-note">Inicie sesión para emitir facturas de prueba.</p>}
        {exhausted && <p className="pg-note">Límite alcanzado. Intente de nuevo más tarde.</p>}
      </header>

      <article className="pg-card hl-example">
        <h2>Formulario de cobro</h2>
        <p>Solo <code>@facta-dte/api/browser</code>: <code>createFactaClient</code> y <code>createIssueFlow</code>, con HTML y estado propios.</p>
        <CheckoutForm disabled={disabled} />
      </article>
      <CodeBlock title="sections/headless/checkout-form.tsx" code={checkoutSource} />

      <article className="pg-card hl-example">
        <h2>Teclado de punto de venta</h2>
        <p>Botones propios y el hook <code>useFactaIssue</code> en modo <code>auto</code>: cobrar emite, sin pantalla de revisión.</p>
        <PosKeypad disabled={disabled} />
      </article>
      <CodeBlock title="sections/headless/pos-keypad.tsx" code={posSource} />

      <article className="pg-card hl-example">
        <h2>¿Necesita crédito fiscal?</h2>
        <p>Un interruptor decide si el servidor arma una Factura o un Comprobante de crédito fiscal; el navegador no escribe el documento.</p>
        <CreditSwitch disabled={disabled} />
      </article>
      <CodeBlock title="sections/headless/credit-switch.tsx" code={creditSource} />
      <CodeBlock title="Comparten · sections/headless/outcome.tsx (cada estado, con estilos propios)" code={outcomeSource} />
    </section>
  );
}
