import { FactaServiceStatus } from "../../../../react.ts";
import { CodeBlock } from "../../code-block.tsx";
import { Link } from "../../router.tsx";
import { usePlayground } from "../../state.tsx";
import { LiveInvoice } from "./live-invoice.tsx";
import liveInvoiceSource from "./live-invoice.tsx?raw";
import saleSource from "../../../server/sale.ts?raw";

export function Home() {
  const { view, refresh } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;
  const quota = state?.quota ?? null;
  const exhausted = quota !== null && !quota.allowed;

  return (
    <section className="pg-page">
      <header className="pg-hero">
        <p className="pg-eyebrow">Ambiente de pruebas · documentos sin valor fiscal</p>
        <h1>Emita una factura real en el ambiente de pruebas de Facta DTE</h1>
        <p className="pg-lead">
          Este sitio ejecuta el SDK de verdad: el servidor guarda la llave, el navegador solo recibe un
          token de sesión y Hacienda recibe el documento en su servicio de pruebas.
        </p>
      </header>

      <div className="pg-grid">
        <article className="pg-card">
          <h2>Una factura, un clic</h2>
          <p>
            Emite una Factura (01) de $8.50 con la ventana de emisión del SDK. Cada emisión usa un número de
            control del ambiente de pruebas.
          </p>
          <LiveInvoice
            email={visitor?.email ?? null}
            disabled={view.status !== "ready" || visitor === null || exhausted}
            onIssued={() => void refresh()}
          />
          {view.status === "ready" && visitor === null && (
            <p className="pg-note">Inicie sesión para emitir facturas de prueba.</p>
          )}
          {quota !== null && (
            <p className="pg-note" data-testid="quota">
              {exhausted
                ? "Límite alcanzado. Intente de nuevo más tarde."
                : `Le quedan ${quota.remainingHour} emisiones esta hora y ${quota.remainingDay} hoy.`}
            </p>
          )}
        </article>

        <article className="pg-card">
          <h2>Estado del servicio</h2>
          <p>Lo que el SDK sabe del API ahora mismo, con el componente <code>FactaServiceStatus</code>.</p>
          <FactaServiceStatus />
          <h2 className="pg-spaced">Dónde seguir</h2>
          <ul className="pg-links">
            <li><Link to="/pantallas">Pantallas React</Link> · las pantallas del SDK, funcionando.</li>
            <li><Link to="/implementacion">Mi propia implementación</Link> · su interfaz sobre el cliente de navegador.</li>
            <li><Link to="/servidor">Solo servidor</Link> · recetas sin navegador.</li>
          </ul>
        </article>
      </div>

      <h2 className="pg-section-title">El código que acaba de ver correr</h2>
      <p className="pg-lead">Son los archivos reales del playground, no copias: lo que ve aquí es lo que se ejecuta.</p>
      <CodeBlock title="Navegador · sections/home/live-invoice.tsx" code={liveInvoiceSource} />
      <CodeBlock title="Servidor · server/sale.ts (arma la solicitud fiscal)" code={saleSource} />
    </section>
  );
}
