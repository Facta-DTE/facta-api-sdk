import { useMemo, useState } from "react";
import { ApiError } from "../../api.ts";
import { Busy } from "../../components/busy.tsx";
import { CodeBlock } from "../../code-block.tsx";
import { OrderField, RepeatBanner, RepeatCard } from "../../components/order-field.tsx";
import { TimingsPanel, TimingsToggle } from "../../components/timings.tsx";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { Segmented } from "../../components/ui.tsx";
import { RECIPE_ORDER } from "../../order-number.ts";
import { orders, recipeScope, useOrders } from "../../order-session.ts";
import { money } from "../registro/registry-rows.ts";
import { usePlayground } from "../../state.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
import { customers, keyOf, orderToRequest, OrderError, priceList, type Order } from "../../../server/recipes/order-webhook.ts";
import type { RecipeSpec } from "../../../server/recipes/specs.ts";
import { runRecipe, type MyDocument, type RunResponse } from "./recipes-api.ts";
import { addLine, changeQty, formatOrder, MAX_LINES, orderTotal, parseOrder } from "./order-webhook-model.ts";
import { recipePath, recipeSource } from "./sources.ts";
import { RECIPE_GUIDES } from "./guides.ts";
import { panelId, RecipeGuideView, RecipeTabBar, useRecipeTab } from "../guides/recipe-guide.tsx";
import { denoBunScript, nodeScript, projectZip } from "./export.ts";
import { useCopy } from "../../code-block.tsx";
import "./order-webhook.css";

const SCOPE = recipeScope("order-webhook");

function downloadZip(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const makeOrderId = () => `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

/** A JSON value coloured the way the boards do: keys blue, strings green, numbers amber. */
function Json({ text }: { text: string }) {
  const parts = text.split(/("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b-?\d+(?:\.\d+)?\b)/g);
  return <>{parts.map((part, i) => (i % 2 === 0 ? part : /:$/.test(part) ? <span key={i} className="k">{part}</span> : part.startsWith('"') ? <span key={i} className="s">{part}</span> : <span key={i} className="f">{part}</span>))}</>;
}

/**
 * Recipe 7 as a small online shop: the visitor builds an order, «the shop» posts it to their server, and the page
 * shows the three steps the server takes (receive, translate, issue) with the real request and answer.
 * Board: PedidoEntrante.dc.html.
 */
export function OrderWebhookPanel({ spec, number, onIssued }: { spec: RecipeSpec; number: number; mine: MyDocument[]; onIssued(docs: MyDocument[]): void }) {
  const { view, refresh } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;
  const exhausted = state?.quota != null && !state.quota.allowed;
  const ready = useTurnstileReady();
  const store = useOrders();

  const [lines, setLines] = useState<Order["lines"]>([{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }]);
  const [orderId, setOrderId] = useState(makeOrderId);
  const [customerRef, setCustomerRef] = useState("");
  const [mode, setMode] = useState<"ver" | "editar">("ver");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"first" | "again" | null>(null);
  const [run, setRun] = useState<{ response: RunResponse; sent: Order | null; again: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const { copied, copy } = useCopy();
  const [chosenTab, setTab] = useRecipeTab();
  const guide = RECIPE_GUIDES[spec.id];
  const tab = guide === undefined && chosenTab === "guia" ? "probar" : chosenTab;

  const order: Order = useMemo(() => ({ orderId, ...(customerRef === "" ? {} : { customerRef }), lines }), [orderId, customerRef, lines]);
  const text = formatOrder(order);
  const total = orderTotal(lines);
  const orderValid = RECIPE_ORDER.test(orderId.trim());
  const repeated = orderValid && store.find(SCOPE, orderId, "01") !== null;
  const source = recipeSource(spec.file);

  /** The builder changed: the JSON in the editor follows it. */
  function commit(next: Order) {
    setOrderId(next.orderId);
    setCustomerRef(next.customerRef ?? "");
    setLines(next.lines);
    if (mode === "editar") setDraft(formatOrder(next));
  }
  function edit(value: string) {
    setDraft(value);
    const parsed = parseOrder(value);
    if (parsed !== null) { setOrderId(parsed.orderId); setCustomerRef(parsed.customerRef ?? ""); setLines(parsed.lines); }
  }

  // What the server would send to Facta, or why it cannot (the same function the server runs).
  const translated = useMemo(() => {
    try { return { request: orderToRequest(order), error: null as string | null }; } catch (error) { return { request: null, error: error instanceof OrderError ? error.message : null }; }
  }, [order]);

  async function send(again: boolean) {
    const body = again && lastSent !== null ? lastSent : mode === "editar" ? draft : text;
    setBusy(again ? "again" : "first");
    setProblem(null);
    try {
      const response = await runRecipe({ recipe: spec.id, params: { order: body } });
      const sent = parseOrder(body);
      setLastSent(body);
      const first = response.issued[0];
      if (response.ok && first !== undefined && sent !== null) {
        orders.record({ scope: SCOPE, order: sent.orderId, type: "01", total: first.total ?? null, code: first.codigoGeneracion, control: first.numeroControl ?? null, ms: response.totalMs });
        onIssued(response.issued.map((d) => ({ codigoGeneracion: d.codigoGeneracion, ...(d.tipoDte === undefined ? {} : { tipoDte: d.tipoDte }), estado: "sellado" })));
      }
      setRun({ response, sent, again: orders.lastRepeat()?.scope === SCOPE && again });
      void refresh();
    } catch (error) {
      setRun(null);
      setProblem(error instanceof ApiError ? error.message : "No se pudo enviar el pedido.");
    } finally {
      setBusy(null);
    }
  }

  const blocked = visitor === null || exhausted || !ready || busy !== null;
  const sealed = run?.response.ok === true ? run.response.issued[0] ?? null : null;
  const failedTranslate = problem !== null;
  const sentId = run?.sent?.orderId ?? orderId;

  return (
    <div className="ow">
      <header className="srv-head ow-head">
        <div className="srv-crumb">Solo servidor · receta {number}</div>
        <h1 id={`r-${spec.id}`}>{spec.title}</h1>
        <p>{spec.summary}</p>
        <div className="ord-banner ow-notice" role="note" data-testid="not-a-feature">
          <span className="ord-banner-ic" aria-hidden>i</span>
          <div><b>Esto es un ejemplo de integración, no una función de Facta DTE.</b> Facta DTE no recibe pedidos: aquí se simula el aviso (webhook) que manda una tienda en línea de terceros —Shopify, WooCommerce o la suya— cuando alguien compra, y cómo su servidor lo convierte en una factura con el SDK.</div>
        </div>
      </header>

      <RecipeTabBar recipe={spec.id} tab={tab} onChange={setTab} withGuide={guide !== undefined} />
      {guide !== undefined && <RecipeGuideView recipe={spec.id} guide={guide} hidden={tab !== "guia"} onTry={() => setTab("probar")} />}

      <div className="ow-cols" id={panelId(spec.id, "probar")} role="tabpanel" aria-labelledby={`${spec.id}-tab-probar`} hidden={tab !== "probar"}>
        <div className="ow-col">
          <section className="ow-card" aria-labelledby="ow-shop">
            <p className="ow-cap" id="ow-shop">1 · Arme el pedido en la Tienda de ejemplo (ficticia)</p>
            <p className="ow-sub">Esta es la lista de precios de la Tienda de ejemplo (ficticia). Su servidor usaría la suya.</p>
            <table className="ow-table">
              <thead><tr><th scope="col">SKU</th><th scope="col">Producto</th><th scope="col" className="r">Precio</th><th scope="col"><span className="pg-sr">Agregar</span></th></tr></thead>
              <tbody>
                {Object.entries(priceList).map(([sku, product]) => (
                  <tr key={sku}>
                    <td className="mono">{sku}</td>
                    <td>{product.descripcion}</td>
                    <td className="r">{money(product.precioUni)}</td>
                    <td><button type="button" className="ow-add" aria-label={`Agregar ${product.descripcion}`} disabled={!lines.some((l) => l.sku === sku) && lines.length >= MAX_LINES} onClick={() => commit({ ...order, lines: addLine(lines, sku) })}>+ Agregar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="ow-cart-title">Carrito</h3>
            {lines.length === 0 && <p className="ow-sub">El carrito está vacío. Agregue un producto de la lista.</p>}
            <ul className="ow-cart">
              {lines.map((line) => {
                const product = priceList[line.sku];
                return (
                  <li key={line.sku}>
                    <span className="mono">{line.sku}</span>
                    <span>{product?.descripcion ?? <i className="ow-unknown">SKU que la tienda no tiene</i>}</span>
                    <span className="ow-qty">
                      <button type="button" aria-label={`Quitar una unidad de ${line.sku}`} onClick={() => commit({ ...order, lines: changeQty(lines, line.sku, -1) })}>−</button>
                      <output aria-label={`Cantidad de ${line.sku}`}>{line.qty}</output>
                      <button type="button" aria-label={`Agregar una unidad de ${line.sku}`} onClick={() => commit({ ...order, lines: changeQty(lines, line.sku, 1) })}>+</button>
                    </span>
                    <span className="r">{product === undefined ? "—" : money(line.qty * product.precioUni)}</span>
                    <button type="button" className="ow-x" aria-label={`Quitar ${line.sku} del carrito`} onClick={() => commit({ ...order, lines: lines.filter((l) => l.sku !== line.sku) })}>×</button>
                  </li>
                );
              })}
            </ul>
            <p className="ow-total"><span>Total del pedido</span><b>{money(total)}</b></p>

            <RepeatBanner scope={SCOPE} order={orderId} type="01" detailed />
            <div className="ow-pair">
              <OrderField scope={SCOPE} label="Número de pedido" value={orderId} onChange={(value) => commit({ ...order, orderId: value })} make={makeOrderId} type="01" valid={orderValid} />
              <label className="pg-field">
                <span>Cliente</span>
                <select value={customerRef} onChange={(event) => commit({ ...order, ...(event.target.value === "" ? { customerRef: undefined } : { customerRef: event.target.value }) } as Order)}>
                  <option value="">Sin cliente (consumidor final)</option>
                  {Object.entries(customers).map(([ref, c]) => <option key={ref} value={ref}>{ref} · {c.nombre}</option>)}
                  {customerRef !== "" && customers[customerRef] === undefined && <option value={customerRef}>{customerRef} (no existe)</option>}
                </select>
              </label>
            </div>
          </section>

          <section className="ow-card ow-card--code" aria-label="Lo que la tienda manda a su servidor">
            <div className="ow-code-head">
              <b>Lo que la tienda manda a su servidor</b>
              <Segmented label="Ver o editar el JSON" value={mode} onChange={(value) => { setMode(value); if (value === "editar") setDraft(text); }} choices={[{ value: "ver", label: "Ver" }, { value: "editar", label: "Editar JSON" }]} />
            </div>
            {mode === "ver" ? (
              <pre className="mono ow-pre" data-testid="order-json"><span className="c">POST https://su-servidor.example/webhooks/pedidos</span>{"\n"}<Json text={text} /></pre>
            ) : (
              <div className="ow-edit">
                <textarea className="mono" aria-label="JSON del pedido" spellCheck={false} rows={10} value={draft} onChange={(event) => edit(event.target.value)} />
                <p className="pg-hint">Los cambios válidos se reflejan en el carrito. Un JSON roto se envía tal cual y su servidor lo explica.</p>
              </div>
            )}
          </section>

          <TurnstileBox />
          <TimingsToggle />
          <div className="ow-actions">
            <button type="button" className="pg-primary" disabled={blocked || !orderValid || lines.length === 0} onClick={() => void send(false)}>
              {busy === "first" ? <Busy>Enviando…</Busy> : "Enviar el pedido"}
            </button>
            <button type="button" className="pg-secondary" disabled={blocked || lastSent === null} onClick={() => void send(true)}>
              {busy === "again" ? <Busy>Enviando…</Busy> : "Enviar el mismo aviso otra vez"}
            </button>
          </div>
          {visitor === null && state !== null && <p className="pg-note">Inicie sesión para ejecutar recetas.</p>}
          {exhausted && <p className="pg-error">Límite de emisiones alcanzado. Intente de nuevo más tarde.</p>}
        </div>

        <div className="ow-col">
          <section className="ow-card" aria-labelledby="ow-server">
            <p className="ow-cap" id="ow-server">2 · Lo que hace su servidor</p>
            <div className="ow-flow">
              <div className={`ow-node${run !== null || failedTranslate ? " is-done" : ""}`}><b>{run !== null || failedTranslate ? "✓ " : ""}Recibe el aviso</b>Lee el pedido {sentId}.</div>
              <span aria-hidden className="ow-arrow">→</span>
              <div className={`ow-node${run !== null ? " is-done" : failedTranslate ? " is-bad" : ""}`}><b>{run !== null ? "✓ " : failedTranslate ? "✗ " : ""}Traduce</b>Cada SKU a su descripción y precio; el cliente a su receptor.</div>
              <span aria-hidden className="ow-arrow">→</span>
              <div className={`ow-node${sealed !== null ? " is-done" : ""}`}><b>{sealed !== null ? "✓ " : ""}Emite</b><code className="mono">{`facta.issue(…, { idempotencyKey: "${keyOf({ ...order, orderId: sentId })}" })`}</code></div>
            </div>
            <p className="ow-sub">{run !== null ? "La solicitud que salió hacia Facta:" : "La solicitud que saldrá hacia Facta:"}</p>
            {translated.request !== null
              ? <pre className="mono ow-pre ow-pre--round" data-testid="outgoing-request"><Json text={JSON.stringify(translated.request, null, 2)} /></pre>
              : <p className="ow-bad" role="status">{translated.error ?? "El pedido todavía no se puede traducir."}</p>}
          </section>

          <section className="ow-card" aria-labelledby="ow-answer">
            <p className="ow-cap" id="ow-answer">3 · Lo que su servidor responde a la tienda</p>
            {busy !== null && <p className="ow-sub" role="status">Esperando la respuesta de staging…</p>}
            {busy === null && sealed !== null && (
              <div className="ow-ok" data-testid="webhook-answer"><b>200 · Factura sellada</b><span className="mono">{sealed.numeroControl}</span></div>
            )}
            {busy === null && run !== null && !run.response.ok && <div className="ow-fail" role="alert"><b>{run.response.error?.message ?? "No se pudo emitir."}</b></div>}
            {busy === null && problem !== null && <div className="ow-fail" role="alert"><b>400 · {problem}</b></div>}
            {busy === null && run === null && problem === null && <p className="ow-sub">Aparece al enviar el pedido.</p>}
            <div className="ord-banner" role="note"><span className="ord-banner-ic" aria-hidden>i</span><div>Si pulsa «Enviar el mismo aviso otra vez»: <b>esta petición simula una doble solicitud para la misma factura,</b> por lo tanto se le devolverá la misma.</div></div>
            {run?.again === true && <RepeatCard outcome={store.lastRepeat()} />}
            {run?.response.timings !== undefined && <TimingsPanel title="Dónde se fue el tiempo" timings={run.response.timings} replay={run.again} />}
          </section>

          <section className="ow-card ow-help">
            <p className="ow-cap">Si algo no cuadra</p>
            <p>«El SKU <span className="mono">CAF-999</span> no está en la lista de precios de la tienda de ejemplo. Use CAF-250, CAF-500, TAZ-01, FIL-50 o ENV-SV.»</p>
            <p>«El cliente <span className="mono">CLI-9</span> no existe en la tienda de ejemplo. Elija uno de la lista (CLI-01, CLI-02 o CLI-03) o deje el pedido sin cliente.»</p>
          </section>
        </div>
      </div>

      <div className="ow-source" id={panelId(spec.id, "codigo")} role="tabpanel" aria-labelledby={`${spec.id}-tab-codigo`} hidden={tab !== "codigo"}>
        <CodeBlock
          title={`recipes/${spec.file}`}
          code={source}
          path={recipePath(spec.file)}
          actions={
            <span className="srv-code-actions">
              <button type="button" className="pg-code-action" onClick={() => copy("node", nodeScript(source))}>{copied === "node" ? "Copiado" : "Copiar para Node"}</button>
              <button type="button" className="pg-code-action" onClick={() => copy("deno", denoBunScript(source))}>{copied === "deno" ? "Copiado" : "Deno / Bun"}</button>
              <button type="button" className="pg-code-action" onClick={() => downloadZip(`facta-receta-${spec.id}.zip`, projectZip(source, spec.id))}>Descargar proyecto</button>
            </span>
          }
        />
        <p className="pg-hint">El proyecto descargable pide SU llave de pruebas en <code>.env</code>; nunca incluye la del playground.</p>
      </div>
    </div>
  );
}
