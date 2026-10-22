import { useEffect, useState } from "react";
import { ApiError } from "../../api.ts";
import { Busy } from "../../components/busy.tsx";
import { DocumentForms } from "../../components/document-forms.tsx";
import { OrderField, RepeatBanner } from "../../components/order-field.tsx";
import { newOrderNumber, RECIPE_ORDER } from "../../order-number.ts";
import { orders, recipeScope, useOrders } from "../../order-session.ts";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { usePlayground } from "../../state.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
import { runRecipe, type MyDocument, type RunResponse } from "./recipes-api.ts";
import { RunNotice, Timeline, type TimelineRun } from "./results.tsx";
import { formatCountdown, isExpiredDelivery, offerOf, secondsLeft, sendGate, summaryOf } from "./mail-window.ts";

// «Entregar por correo, en dos llamadas» (board CorreoDosLlamadas.dc.html): call 1 issues a fresh test
// Factura with the e-mail marked and shows the real delivery token with its countdown; call 2 sends the
// e-mail while that token is alive. The send never takes the token from the page: it carries the sealed
// hand-over of call 1 (see server/recipes/index.ts), so the page only displays what the API returned.

const RECIPE = "deliver-email";
const SCOPE = recipeScope(RECIPE);
/** Call 1 always issues a Factura (01): the type a repeat of the order is keyed by. */
const ORDER_TYPE = "01";

const STATE_LABEL: Record<string, string> = {
  pendiente: "en cola", en_proceso: "en proceso", enviado: "entregado", fallido: "fallido", sin_credito: "sin crédito",
  sin_consentimiento: "sin consentimiento", no_permitido: "no permitido", vencido: "vencido", esperando_sello: "esperando el sello",
};
const stateTone = (estado: string) => (estado === "enviado" ? "ok" : estado === "pendiente" || estado === "en_proceso" || estado === "esperando_sello" ? "info" : "bad");

const clock = (iso: string | null) => (iso === null || Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toLocaleTimeString("es-SV", { hour12: false }));
const short = (code: string) => `${code.slice(0, 4)}…${code.slice(-4)}`;

export function MailRecipe({ mine, onIssued, panel }: { mine: MyDocument[]; onIssued(docs: MyDocument[]): void; /** The «Probarla» tab panel wiring from the recipe page. */ panel: { id: string; labelledBy: string; hidden: boolean } }) {
  const { view, refresh } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;
  const exhausted = state?.quota != null && !state.quota.allowed;
  const ready = useTurnstileReady();

  const [email, setEmail] = useState("");
  const [order, setOrder] = useState(newOrderNumber);
  const store = useOrders();
  const [busy, setBusy] = useState<"issue" | "send" | null>(null);
  const [issue, setIssue] = useState<RunResponse | null>(null);
  const [send, setSend] = useState<RunResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [runs, setRuns] = useState<TimelineRun[]>([]);
  const [oldCode, setOldCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [sentCode, setSentCode] = useState<string | null>(null);

  const offer = issue?.ok === true ? offerOf(issue.result) : null;
  const issuedCode = issue?.ok === true ? issue.issued[0]?.codigoGeneracion ?? null : null;
  const control = ((issue?.result as { issued?: { numeroControl?: unknown } } | null)?.issued?.numeroControl) as string | undefined;
  const alive = offer?.token !== undefined && (secondsLeft(offer.venceEn, now) ?? 1) > 0;

  // One tick a second while a token is alive, so the countdown and the gate follow the clock.
  useEffect(() => {
    if (!alive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [alive]);

  const gate = sendGate({ offer, now, busy: busy !== null, ready: ready && visitor !== null, hasContinuation: issue?.continuation !== undefined });
  const left = offer === null ? null : secondsLeft(offer.venceEn, now);
  const emailOk = email.trim() !== "";
  const orderValid = RECIPE_ORDER.test(order.trim());
  const repeated = order.trim() !== "" && store.find(SCOPE, order, ORDER_TYPE) !== null;
  const canIssue = busy === null && visitor !== null && !exhausted && ready && emailOk && orderValid;

  async function call(stage: "issue" | "send", params: Record<string, unknown>, runId?: string) {
    setBusy(stage);
    setProblem(null);
    try {
      const out = await runRecipe({ recipe: RECIPE, stage, params, ...(runId === undefined ? {} : { runId }) });
      setRuns((all) => {
        const entry: TimelineRun = { retry: false, steps: out.steps, issuedLabel: stage === "issue" && out.ok && out.issued.length > 0 ? `…${out.issued[0]!.codigoGeneracion.slice(-12)}` : null };
        return stage === "issue" ? [entry] : [...all, entry];
      });
      if (stage === "issue") {
        setIssue(out);
        setSend(null);
        setSentCode(null);
        const first = out.issued[0];
        if (out.ok && first !== undefined) {
          orders.record({ scope: SCOPE, order: String(params.orderNumber ?? ""), type: ORDER_TYPE, total: first.total ?? null, code: first.codigoGeneracion, control: first.numeroControl ?? null, ms: out.totalMs });
        }
        setNow(Date.now());
        if (out.issued.length > 0) onIssued(out.issued.map((d) => ({ codigoGeneracion: d.codigoGeneracion, ...(d.tipoDte === undefined ? {} : { tipoDte: d.tipoDte }), estado: "sellado" })));
      } else {
        setSend(out);
      }
      void refresh();
    } catch (error) {
      if (stage === "send" && error instanceof ApiError && isExpiredDelivery({ code: error.code, status: error.status })) {
        setSend({ recipe: RECIPE, stage, runId: runId ?? "", ok: false, steps: [], totalMs: 0, result: null, files: [], issued: [], invalidated: [], error: { code: "entrega_vencida", status: 410, message: error.message } });
      } else {
        setProblem(error instanceof ApiError ? error.message : "No se pudo ejecutar la receta.");
      }
    } finally {
      setBusy(null);
    }
  }

  const sendFromIssue = () => {
    if (!gate.enabled || issue === null || issue.continuation === undefined) return;
    setSentCode(issuedCode);
    void call("send", { continuation: issue.continuation }, issue.runId);
  };
  const sendOld = () => {
    if (busy !== null || oldCode === "" || !ready) return;
    setSentCode(oldCode);
    void call("send", { code: oldCode });
  };

  const summary = send?.ok === true ? summaryOf(send.result, sentCode) : null;
  const expiredNow = (send !== null && !send.ok && isExpiredDelivery(send.error)) || gate.expired;
  const tokenJson = offer === null ? null : JSON.stringify({ token: offer.token ?? null, venceEn: offer.venceEn, canales: offer.canales }, null, 2);

  return (
    <aside className="srv-run mail-run" aria-label="Ejecutar en staging" id={panel.id} role="tabpanel" aria-labelledby={panel.labelledBy} hidden={panel.hidden}>
      <h2>Ejecutar en staging</h2>

      <section className="mail-card" aria-labelledby="mail-c1">
        <header className="mail-head">
          <span className={`mail-step${issue?.ok ? " is-done" : ""}`} aria-hidden>{issue?.ok ? "✓" : "1"}</span>
          <div>
            <b id="mail-c1">Llamada 1 · Emitir y marcar el correo</b>
            <code className="mail-sig">facta.issue(venta, {"{"} idempotencyKey, deliver: {"{"} email {"}"} {"}"})</code>
          </div>
        </header>
        <form onSubmit={(e) => { e.preventDefault(); if (canIssue) { setRuns([]); void call("issue", { email, orderNumber: order.trim() }); } }}>
          <div className="pg-field">
            <label htmlFor="mail-email">Correo del cliente</label>
            <input id="mail-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@ejemplo.com" />
            <p className="pg-hint">Se emite una Factura de prueba de $1.13 y se envía el correo estándar de Facta DTE, sin texto suyo. Límites: 5 por hora, 20 por día y 2 por día a una misma dirección.</p>
          </div>
          <RepeatBanner scope={SCOPE} order={order} type={ORDER_TYPE} detailed />
          <OrderField scope={SCOPE} value={order} onChange={setOrder} make={newOrderNumber} type={ORDER_TYPE} valid={orderValid}
            hint={`La llave de idempotencia será esta orden, atada a su sesión. ${repeated ? "Ya se usó: se le devolverá la misma factura." : "Con otro número se emite otra factura."}`} />
          <TurnstileBox />
          <button type="submit" className="pg-primary" disabled={!canIssue}>{busy === "issue" ? <Busy>Emitiendo…</Busy> : repeated ? "Repetir la petición" : "Emitir la factura ahora"}</button>
        </form>
        {visitor === null && state !== null && <p className="pg-note">Inicie sesión para ejecutar recetas.</p>}
        {exhausted && <p className="pg-error">Límite de emisiones alcanzado. Intente de nuevo más tarde.</p>}
        {problem !== null && busy === null && <p role="alert" className="pg-error">{problem}</p>}
        {issue !== null && !issue.ok && <RunNotice run={issue} />}

        {issue?.ok === true && issuedCode !== null && (
          <div className="mail-result">
            <div className="mail-result-head"><b>Factura emitida</b><span className="mail-pill mail-pill--ok">sellada</span></div>
            <dl className="mail-rows">
              {control !== undefined && <div><dt>Número de control</dt><dd className="mono">{control}</dd></div>}
              <div><dt>Código de generación</dt><dd className="mono" title={issuedCode}>{short(issuedCode)}</dd></div>
              <div><dt>Correo marcado</dt><dd>{offer?.canales.correo?.destino ?? "—"}</dd></div>
            </dl>

            {offer?.token !== undefined && tokenJson !== null ? (
              <div className="mail-token" data-testid="delivery-token">
                <div className="mail-token-head">
                  <span>El token de entrega</span>
                  <span className={`mono mail-count${left === 0 ? " is-over" : ""}`} role="timer" aria-live="off">{left === null ? "" : left === 0 ? "venció" : `vence en ${formatCountdown(left)}`}</span>
                </div>
                <pre className="mono" tabIndex={0}><code><span className="mail-k">result.entrega</span> = {tokenJson}</code></pre>
                <p>Vive 5 minutos y sirve solo para este documento. En su integración guárdelo en su servidor: quien lo tenga puede pedir este correo.</p>
              </div>
            ) : (
              <p className="mail-contingency" role="status">Sin token de entrega: el correo se enviará cuando Hacienda confirme el documento.</p>
            )}
            <DocumentForms code={issuedCode} estado={(issue?.result as { issued?: { estado?: string } } | null)?.issued?.estado ?? "sellado"} showHow={false} title="El documento que acaba de emitir, en sus tres formas." />
          </div>
        )}
      </section>

      <section className="mail-card" aria-labelledby="mail-c2">
        <header className="mail-head">
          <span className={`mail-step${summary !== null ? " is-done" : ""}`} aria-hidden>{summary !== null ? "✓" : "2"}</span>
          <div>
            <b id="mail-c2">Llamada 2 · Enviar con el token</b>
            <code className="mail-sig">facta.deliverEmail(codigo, token)</code> y <code className="mail-sig">facta.waitForDelivery(codigo)</code>
          </div>
        </header>
        <p className="pg-note">Se usa el token de la llamada 1. El botón se activa cuando hay un token vigente y se apaga al vencer.</p>
        <TurnstileBox />
        <button type="button" className="pg-primary" disabled={!gate.enabled} aria-describedby="mail-why" onClick={sendFromIssue}>
          {busy === "send" ? <Busy>Enviando…</Busy> : "Enviar el correo"}
        </button>
        <p id="mail-why" className="pg-hint" data-testid="send-reason">{busy === null ? gate.reason ?? "" : ""}</p>

        {(summary !== null || (send !== null && send.ok)) && summary !== null && (
          <div className="mail-result">
            <b>Estado de la entrega</b>
            <dl className="mail-rows">
              <div><dt>Solicitado</dt><dd>{summary.solicitado !== null && <span className={`mail-pill mail-pill--${stateTone(summary.solicitado)}`}>{STATE_LABEL[summary.solicitado] ?? summary.solicitado}</span>}</dd></div>
              <div><dt>Enviado</dt><dd>{clock(summary.actualizado) !== null && `${clock(summary.actualizado)} · `}{summary.estado !== null && <span className={`mail-pill mail-pill--${stateTone(summary.estado)}`}>{STATE_LABEL[summary.estado] ?? summary.estado}</span>}{summary.settled === false && " (aún sin estado final)"}</dd></div>
              <div><dt>Adjuntos</dt><dd className="mono">{summary.adjuntos.join(" · ")}</dd></div>
              {summary.destino !== null && <div><dt>Destino</dt><dd>{summary.destino}</dd></div>}
            </dl>
          </div>
        )}
        {send !== null && !send.ok && <RunNotice run={send} />}

        <div className={`mail-amber${expiredNow ? " is-on" : ""}`} role={expiredNow ? "alert" : undefined}>
          <b>Si el token venció:</b> el API responde <code>entrega_vencida</code> (410). La factura sigue sellada y válida; solo ese correo ya no se puede pedir con ese token. Emita otra factura para probar de nuevo.
        </div>

        <details className="mail-old">
          <summary>Usar una factura que ya emití (menos de 5 minutos)</summary>
          <p className="pg-hint">Elija una de sus facturas recientes con correo marcado; se salta la llamada 1.</p>
          <div className="pg-field">
            <label htmlFor="mail-old">Su factura</label>
            <select id="mail-old" value={oldCode} onChange={(e) => setOldCode(e.target.value)}>
              <option value="">Elija un documento que usted emitió</option>
              {mine.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.tipoDte ?? ""} · {d.codigoGeneracion.slice(0, 8)}…{d.estado ? ` · ${d.estado}` : ""}</option>)}
            </select>
          </div>
          <button type="button" className="pg-secondary" disabled={busy !== null || oldCode === "" || !ready} onClick={sendOld}>Enviar el correo de esa factura</button>
        </details>
      </section>

      {runs.length > 0 && (
        <div className="mail-calls">
          <b>Llamadas al API</b>
          <Timeline runs={runs} sameDocument={null} />
        </div>
      )}
      <p className="srv-redaction">Las llaves y rutas de almacenamiento nunca aparecen. El token de entrega que ve aquí es solo el suyo, de este documento, y vence en 5 minutos.</p>
    </aside>
  );
}
