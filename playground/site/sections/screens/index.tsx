import { useCallback, type ReactNode } from "react";
import type { AutoCloseOn, RunMode } from "../../../../react.ts";
import { createSession } from "../../api.ts";
import { ExampleCard } from "../../components/example-card.tsx";
import { usePlayground } from "../../state.tsx";
import "./screens.css";
import { AppearanceStudio } from "./examples/appearance-studio.tsx";
import appearanceSource from "./examples/appearance-studio.tsx?raw";
import { DialogExample } from "./examples/dialog.tsx";
import dialogSource from "./examples/dialog.tsx?raw";
import { DocumentDetailExample } from "./examples/document-detail.tsx";
import documentDetailSource from "./examples/document-detail.tsx?raw";
import { DocumentListExample } from "./examples/document-list.tsx";
import documentListSource from "./examples/document-list.tsx?raw";
import { DrawerExample } from "./examples/drawer.tsx";
import drawerSource from "./examples/drawer.tsx?raw";
import { InlineExample } from "./examples/inline.tsx";
import inlineSource from "./examples/inline.tsx?raw";
import { InvalidateExample } from "./examples/invalidate.tsx";
import invalidateSource from "./examples/invalidate.tsx?raw";
import { IssueButtonExample } from "./examples/issue-button.tsx";
import issueButtonSource from "./examples/issue-button.tsx?raw";
import { PickersExample } from "./examples/pickers.tsx";
import pickersSource from "./examples/pickers.tsx?raw";
import { ReceiptExample } from "./examples/receipt.tsx";
import receiptSource from "./examples/receipt.tsx?raw";
import { ServiceStatusExample } from "./examples/service-status.tsx";
import serviceStatusSource from "./examples/service-status.tsx?raw";
import { WindowHookExample } from "./examples/window-hook.tsx";
import windowHookSource from "./examples/window-hook.tsx?raw";
import { SaleBuilder } from "./sale-builder.tsx";
import saleBuilderSource from "./sale-builder.tsx?raw";
import { ScreenStateProvider, useScreens } from "./screen-state.tsx";

function Band({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="pg-band" id={id}>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

function RunBar() {
  const s = useScreens();
  return (
    <div className="pg-runbar">
      <label className="pg-field">
        <span>Modo de ejecución (<code>run</code>)</span>
        <select value={s.run} onChange={(event) => s.setRun(event.target.value as RunMode)}>
          <option value="manual">manual: revisar y pulsar Emitir</option>
          <option value="auto">auto: emite al abrir</option>
          <option value="auto-close">auto-close: emite y se cierra</option>
        </select>
      </label>
      <label className="pg-field">
        <span>Cierre en ms (<code>autoCloseDelay</code>)</span>
        <input type="number" min={0} step={100} value={s.autoCloseDelay} disabled={s.run !== "auto-close"} onChange={(event) => s.setAutoCloseDelay(Math.max(0, Number(event.target.value) || 0))} />
      </label>
      <label className="pg-field">
        <span>Cerrar en (<code>autoCloseOn</code>)</span>
        <select value={s.autoCloseOn} disabled={s.run !== "auto-close"} onChange={(event) => s.setAutoCloseOn(event.target.value as AutoCloseOn)}>
          <option value="success">success: solo si se emitió</option>
          <option value="any">any: también ante un error</option>
        </select>
      </label>
    </div>
  );
}

function ScreensPage() {
  const { view } = usePlayground();
  const s = useScreens();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;

  const prepareSample = useCallback(async () => {
    const created = await createSession({ tipoDte: "01", lines: [{ descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5 }] });
    s.setPrepared({ ...created, tipoDte: "01" });
  }, [s]);

  const windowProps = {
    session: s.prepared?.session ?? null,
    run: s.run,
    autoCloseDelay: s.autoCloseDelay,
    autoCloseOn: s.autoCloseOn,
    onIssued: s.onIssued,
  };

  return (
    <section className="pg-page">
      <header className="pg-hero">
        <p className="pg-eyebrow">Ambiente de pruebas · documentos sin valor fiscal</p>
        <h1>Pantallas React del SDK, funcionando</h1>
        <p className="pg-lead">
          Cada ejemplo usa los componentes de <code>@facta-dte/api/react</code> contra el servidor del playground, con su
          código al lado. El código que ve es el archivo que se ejecuta.
        </p>
        {state !== null && visitor === null && <p className="pg-note">Inicie sesión para emitir y para ver sus documentos.</p>}
      </header>

      <ul className="pg-subnav" aria-label="En esta página">
        <li><a href="#venta">1 · Venta</a></li>
        <li><a href="#emitir">2 · Emitir</a></li>
        <li><a href="#despues">3 · Después de emitir</a></li>
        <li><a href="#datos">4 · Datos</a></li>
        <li><a href="#anular">5 · Anular</a></li>
        <li><a href="#apariencia">6 · Apariencia</a></li>
      </ul>

      <Band id="venta" title="1 · Arme una venta">
        El navegador solo describe la venta (tipo, cliente, líneas). El servidor la valida, arma la solicitud fiscal y le entrega un
        token de sesión: ningún valor fiscal sale del navegador.
      </Band>
      {state !== null ? (
        <ExampleCard wide title="Constructor de ventas" intro="Seis tipos de documento: los que el API v1 acepta hoy." code={saleBuilderSource} codeTitle="Navegador · sections/screens/sale-builder.tsx"
          note={s.prepared === null ? undefined : `Venta lista: ${s.prepared.title} · $${s.prepared.total.toFixed(2)}${s.prepared.emailTo ? ` · correo a ${s.prepared.emailTo}` : ""}. Úsela en los ejemplos de abajo.`}>
          <SaleBuilder state={state} issued={s.issued} onPrepared={s.setPrepared} />
        </ExampleCard>
      ) : <p className="pg-note">Esperando al servidor…</p>}

      <Band id="emitir" title="2 · Emitir">
        La misma venta se puede emitir con cuatro presentaciones y con una función. Los modos de ejecución cambian cuándo arranca la emisión.
        Los ejemplos comparten la venta: si ya la emitió, los demás muestran el mismo documento (misma llave de idempotencia).
      </Band>
      <RunBar />
      <div style={{ height: 16 }} />
      <ExampleCard title={<code>FactaInvoiceDialog</code>} intro="Ventana modal; en el teléfono se vuelve una hoja inferior." code={dialogSource} codeTitle="sections/screens/examples/dialog.tsx">
        <DialogExample {...windowProps} />
      </ExampleCard>
      <ExampleCard title={<code>FactaInvoiceDrawer</code>} intro="El mismo flujo en un panel lateral." code={drawerSource} codeTitle="sections/screens/examples/drawer.tsx">
        <DrawerExample {...windowProps} />
      </ExampleCard>
      <ExampleCard title={<code>FactaInvoiceInline</code>} intro="Incrustada en su página, sin capa encima." code={inlineSource} codeTitle="sections/screens/examples/inline.tsx">
        <InlineExample {...windowProps} />
      </ExampleCard>
      <ExampleCard title={<code>FactaIssueButton</code>} intro="Un botón para punto de venta: etiqueta, progreso y marca de listo." code={issueButtonSource} codeTitle="sections/screens/examples/issue-button.tsx">
        <IssueButtonExample {...windowProps} />
      </ExampleCard>
      <ExampleCard title={<code>useFactaWindow().open</code>} intro="Sin componente en su JSX: una promesa con el resultado." code={windowHookSource} codeTitle="sections/screens/examples/window-hook.tsx">
        <WindowHookExample {...windowProps} />
      </ExampleCard>

      <Band id="despues" title="3 · Después de emitir">
        Recibo, estado y descargas del último documento que emitió en esta página. La fila «Entrega» aparece si pidió el correo en la venta.
      </Band>
      <ExampleCard title={<><code>FactaReceipt</code> · <code>FactaStatusBadge</code> · <code>FactaDownloadButton</code></>} code={receiptSource} codeTitle="sections/screens/examples/receipt.tsx">
        <ReceiptExample result={s.last} />
      </ExampleCard>

      <Band id="datos" title="4 · Datos">
        Listados, detalle, selectores y estado del servicio. El playground solo muestra los documentos que usted emitió aquí.
      </Band>
      <ExampleCard wide title={<code>FactaDocumentList</code>} intro="Tabla en escritorio, tarjetas en el teléfono." code={documentListSource} codeTitle="sections/screens/examples/document-list.tsx">
        <DocumentListExample onInvalidated={() => void s.refreshIssued()} />
      </ExampleCard>
      <ExampleCard title={<code>FactaDocumentDetail</code>} code={documentDetailSource} codeTitle="sections/screens/examples/document-detail.tsx">
        <DocumentDetailExample issued={s.issued} onInvalidated={() => void s.refreshIssued()} />
      </ExampleCard>
      {state !== null && (
        <ExampleCard title={<><code>FactaCustomerPicker</code> · <code>FactaProductPicker</code></>} code={pickersSource} codeTitle="sections/screens/examples/pickers.tsx">
          <PickersExample state={state} />
        </ExampleCard>
      )}
      <ExampleCard title={<code>FactaServiceStatus</code>} code={serviceStatusSource} codeTitle="sections/screens/examples/service-status.tsx">
        <ServiceStatusExample />
      </ExampleCard>

      <Band id="anular" title="5 · Anular">
        La anulación nace en el servidor: usted pide un token, el servidor comprueba que el documento sea suyo y pone a los responsables de la demostración.
      </Band>
      <ExampleCard title="Diálogo de anulación" code={invalidateSource} codeTitle="sections/screens/examples/invalidate.tsx">
        <InvalidateExample issued={s.issued} canInvalidate={state?.demo.canInvalidate ?? false} onInvalidated={() => void s.refreshIssued()} />
      </ExampleCard>

      <Band id="apariencia" title="6 · Estudio de apariencia">
        Cambie tokens, marca, clases y textos sobre una ventana real. Abajo queda el código listo para copiar.
      </Band>
      <ExampleCard wide title="Estudio de apariencia" intro="Parte de los tres ajustes de la vista previa del SDK." code={appearanceSource} codeTitle="sections/screens/examples/appearance-studio.tsx">
        <div style={{ width: "100%" }}>
          <AppearanceStudio session={s.prepared?.session ?? null} canPrepare={visitor !== null} onPrepare={() => void prepareSample()} />
        </div>
      </ExampleCard>
    </section>
  );
}

export function Screens() {
  return (
    <ScreenStateProvider>
      <ScreensPage />
    </ScreenStateProvider>
  );
}
