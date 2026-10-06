import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutoCloseOn, IssueResult, RunMode } from "../../../../react.ts";
import { CodePanel, type CodeTab } from "../../code-block.tsx";
import { Segmented } from "../../components/ui.tsx";
import { createSession } from "../../api.ts";
import { usePlayground } from "../../state.tsx";
import { GROUPS, ITEMS, itemOf, type WorkbenchItem } from "./catalog.ts";
import { shortName } from "../../shown-files.ts";
import { DeliveryExample } from "./examples/delivery.tsx";
import "./screens.css";
import { AppearanceStudio } from "./examples/appearance-studio.tsx";
import { DialogExample } from "./examples/dialog.tsx";
import { DocumentDetailExample } from "./examples/document-detail.tsx";
import { DocumentListExample } from "./examples/document-list.tsx";
import { DrawerExample } from "./examples/drawer.tsx";
import { InlineExample } from "./examples/inline.tsx";
import { InvalidateExample } from "./examples/invalidate.tsx";
import { IssueButtonExample } from "./examples/issue-button.tsx";
import { PickersExample } from "./examples/pickers.tsx";
import { ReceiptExample } from "./examples/receipt.tsx";
import { ServiceStatusExample } from "./examples/service-status.tsx";
import { WindowHookExample } from "./examples/window-hook.tsx";
import { SaleBuilder } from "./sale-builder.tsx";
import { ScreenStateProvider, useScreens } from "./screen-state.tsx";

type Pane = "venta" | "vista" | "codigo";

/**
 * The response the server's handler gave for the last issued document, without anything the
 * visitor must not see: no signed file, no PDF, no storage locations, no tokens.
 */
export function redactedResponse(result: IssueResult | null): string | null {
  if (result === null) return null;
  const safe = {
    estado: result.estado,
    tipoDte: result.tipoDte,
    ambiente: result.ambiente,
    numeroControl: result.numeroControl,
    codigoGeneracion: result.codigoGeneracion,
    fecEmi: result.fecEmi,
    horEmi: result.horEmi,
    selloRecibido: result.selloRecibido,
    fhProcesamiento: result.fhProcesamiento,
    observaciones: result.observaciones,
    detalle: result.detalle,
    totales: result.totales,
  };
  return JSON.stringify(safe, (_key, value: unknown) => (value === undefined || value === null ? undefined : value), 2);
}

function writeUrl(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("c", id);
  window.history.replaceState(null, "", url);
}

function Stage({ item }: { item: WorkbenchItem }) {
  const { view } = usePlayground();
  const s = useScreens();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;
  const windowProps = { session: s.prepared?.session ?? null, run: s.run, autoCloseDelay: s.autoCloseDelay, autoCloseOn: s.autoCloseOn, onIssued: s.onIssued };

  const prepareSample = useCallback(async () => {
    const created = await createSession({ tipoDte: "01", lines: [{ descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5, tipoItem: 1 }] });
    s.setPrepared({ ...created, tipoDte: "01" });
  }, [s]);

  switch (item.id) {
    case "dialog": return <DialogExample {...windowProps} />;
    case "drawer": return <DrawerExample {...windowProps} />;
    case "inline": return <InlineExample {...windowProps} />;
    case "button": return <IssueButtonExample {...windowProps} />;
    case "window": return <WindowHookExample {...windowProps} />;
    case "delivery": return state === null ? <p className="pg-note">Esperando al servidor…</p> : <DeliveryExample state={state} onIssued={s.onIssued} />;
    case "receipt": case "badge": case "download": return <ReceiptExample result={s.last} />;
    case "list": return <DocumentListExample onInvalidated={() => void s.refreshIssued()} />;
    case "detail": return <DocumentDetailExample issued={s.issued} onInvalidated={() => void s.refreshIssued()} />;
    case "pickers": return state === null ? <p className="pg-note">Esperando al servidor…</p> : <PickersExample state={state} />;
    case "status": return <ServiceStatusExample />;
    case "invalidate": return <InvalidateExample issued={s.issued} canInvalidate={state?.demo.canInvalidate ?? false} onInvalidated={() => void s.refreshIssued()} />;
    default: return <AppearanceStudio session={s.prepared?.session ?? null} canPrepare={visitor !== null} onPrepare={() => void prepareSample()} />;
  }
}

const RUN_CHOICES = [{ value: "manual", label: "manual" }, { value: "auto", label: "auto" }, { value: "auto-close", label: "auto-close" }] as const;

function Workbench() {
  const { view } = usePlayground();
  const s = useScreens();
  const state = view.status === "ready" ? view.state : null;
  const [itemId, setItemId] = useState(() => itemOf(new URLSearchParams(window.location.search).get("c")).id);
  const [tab, setTab] = useState("app");
  const [pane, setPane] = useState<Pane>("venta");
  const item = itemOf(itemId);
  const group = GROUPS.find((g) => g.id === item.group)!;

  const choose = (id: string) => {
    setItemId(id);
    writeUrl(id);
    setTab("app");
    setPane(itemOf(id).needsSale && s.prepared === null ? "venta" : "vista");
  };

  // A prepared sale is what the live view needs: move there once it exists.
  const preparedSession = s.prepared?.session ?? null;
  useEffect(() => {
    if (preparedSession !== null) setPane("vista");
  }, [preparedSession]);
  // The first visit to a component that needs no sale opens its view.
  useEffect(() => {
    if (!item.needsSale) setPane((current) => (current === "venta" ? "vista" : current));
  }, [item.needsSale]);

  const response = redactedResponse(s.last);
  const tabs = useMemo<CodeTab[]>(() => [
    { id: "app", label: "App.tsx", code: item.source.code, path: item.source.path, note: `Este es el archivo que se ejecuta en esta página, no una copia · ${shortName(item.source.path)}` },
    { id: "server", label: "server.ts", code: item.server.code, path: item.server.path, note: `${item.serverNote} · ${shortName(item.server.path)}` },
    ...(item.extra ?? []).map((tab) => ({ id: tab.id, label: tab.label, code: tab.file.code, path: tab.file.path, note: `${tab.note} · ${shortName(tab.file.path)}` })),
    {
      id: "response",
      label: "Respuesta",
      code: response ?? "// La respuesta aparece aquí cuando emita un documento.\n// Se muestra sin archivos, rutas de almacenamiento ni tokens.",
      note: "Respuesta real de staging, sin llaves, archivos ni rutas de almacenamiento.",
    },
  ], [item, response]);

  // After an issue, the «Respuesta» tab is the interesting one.
  const lastCode = s.last?.codigoGeneracion;
  useEffect(() => {
    if (lastCode !== undefined) setTab("response");
  }, [lastCode]);

  const showSale = item.needsSale;

  return (
    <div className="wb" data-pane={pane}>
      <aside className="wb-rail" aria-label="Componentes">
        {GROUPS.map((g) => (
          <div key={g.id}>
            <h2 className="wb-rail-title">{g.label}</h2>
            <ul>
              {ITEMS.filter((i) => i.group === g.id).map((i) => (
                <li key={i.id}>
                  <a href={`?c=${i.id}`} aria-current={i.id === item.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); choose(i.id); }}>{i.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <div className="wb-phone-pick">
        <label className="pg-field">
          <span>Componente</span>
          <select className="wb-select" value={item.id} onChange={(event) => choose(event.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {ITEMS.filter((i) => i.group === g.id).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <Segmented<Pane>
          block
          label="Qué ver"
          value={pane}
          onChange={setPane}
          choices={[{ value: "venta", label: "Venta" }, { value: "vista", label: "Vista" }, { value: "codigo", label: "Código" }]}
        />
      </div>

      <section className="wb-center" aria-labelledby="wb-title">
        <div className="wb-head">
          <div>
            <p className="wb-crumb">Pantallas React · {group.label}</p>
            <h1 id="wb-title" className={item.heading === undefined ? "wb-title" : "wb-title wb-title--text"}>{item.heading ?? item.title}</h1>
            {item.lead !== undefined && <p className="wb-lead">{item.lead}</p>}
          </div>
          {item.window && (
            <div className="wb-run">
              <span id="wb-run-label">Modo</span>
              <Segmented label="Modo de ejecución (run)" value={s.run} onChange={(value) => s.setRun(value as RunMode)} choices={RUN_CHOICES} />
            </div>
          )}
        </div>
        {item.window && s.run === "auto-close" && (
          <div className="wb-runopts">
            <label className="pg-field">
              <span>Cierre en ms (<code>autoCloseDelay</code>)</span>
              <input type="number" min={0} step={100} value={s.autoCloseDelay} onChange={(event) => s.setAutoCloseDelay(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <label className="pg-field">
              <span>Cerrar en (<code>autoCloseOn</code>)</span>
              <select value={s.autoCloseOn} onChange={(event) => s.setAutoCloseOn(event.target.value as AutoCloseOn)}>
                <option value="success">success: solo si se emitió</option>
                <option value="any">any: también ante un error</option>
              </select>
            </label>
          </div>
        )}
        {state !== null && state.visitor === null && <p className="pg-note wb-pad">Inicie sesión para emitir y para ver sus documentos.</p>}

        <div className="wb-sale" hidden={!showSale} data-pane-show="venta">
          {state !== null ? (
            <SaleBuilder state={state} issued={s.issued} onPrepared={s.setPrepared} onStale={() => s.setPrepared(null)} />
          ) : <p className="pg-note">Esperando al servidor…</p>}
          {s.prepared !== null && (
            <p className="pg-note wb-ready" role="status">
              Venta lista: {s.prepared.title} · ${s.prepared.total.toFixed(2)}{s.prepared.emailTo ? ` · correo a ${s.prepared.emailTo}` : ""}.
            </p>
          )}
        </div>

        {item.panel ? (
          <div className="wb-panel" data-pane-show="vista"><Stage item={item} /></div>
        ) : (
          <div className={`wb-stage${item.window ? " wb-stage--center" : ""}`} data-pane-show="vista">
            <span className="wb-stage-label">Vista en vivo · staging</span>
            <div className="wb-stage-body">
              {/* Read-only components (status, pickers, lists, receipt) need no verification; the ones that cost
                  something render their own widget next to their button. */}
              <Stage item={item} />
            </div>
          </div>
        )}
      </section>

      <div className="wb-code" data-pane-show="codigo">
        <CodePanel tabs={tabs} selected={tab} onSelect={setTab} />
      </div>
    </div>
  );
}

export function Screens() {
  return (
    <ScreenStateProvider>
      <Workbench />
    </ScreenStateProvider>
  );
}
