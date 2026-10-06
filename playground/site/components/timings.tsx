import { API_BREAKDOWN_PENDING, type Timings } from "../../shared/timings.ts";
import { setTimingsEnabled, useIssueInsight, useTimingsEnabled } from "../timings.ts";
import "./timings.css";

/** The switch. Off by default; remembered in this browser. */
export function TimingsToggle({ className }: { className?: string }) {
  const on = useTimingsEnabled();
  return (
    <label className={`pg-check pg-timings-toggle${className ? ` ${className}` : ""}`}>
      <input type="checkbox" checked={on} onChange={(event) => setTimingsEnabled(event.target.checked)} />
      Mostrar tiempos (depuración)
    </label>
  );
}

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/**
 * A waterfall: one row per step with its start, its bar and its duration. The playground's own steps are
 * in the accent colour and the API's in green. Until the API returns a breakdown the page says so.
 */
export function TimingsPanel({ title, timings }: { title: string; timings: Timings }) {
  const span = Math.max(timings.totalMs, ...timings.steps.map((s) => s.startedAtMs + s.ms), 1);
  return (
    <section className="pg-timings" aria-label={title} data-testid="timings">
      <header>
        <h4>{title}</h4>
        <b>Total {seconds(timings.totalMs)}</b>
      </header>
      {typeof timings.region === "string" && timings.region !== "" && (
        <p className="pg-hint" data-testid="timings-region">Región del API: {timings.region}</p>
      )}
      <ol>
        {timings.steps.map((step, index) => (
          <li key={`${step.step}-${index}`} data-source={step.source}>
            <span className="pg-timings-name">{step.step}</span>
            <span className="pg-timings-track" aria-hidden>
              <i style={{ left: `${(step.startedAtMs / span) * 100}%`, width: `${Math.max(0.8, (step.ms / span) * 100)}%` }} />
            </span>
            <span className="pg-timings-ms">{seconds(step.ms)}</span>
          </li>
        ))}
      </ol>
      {!timings.apiBreakdown && <p className="pg-hint">{API_BREAKDOWN_PENDING}</p>}
    </section>
  );
}

/**
 * What the last issue taught: the replay notice and, with «Mostrar tiempos», where the time went.
 * Drawn under every window that issues.
 */
export function IssueInsight() {
  const insight = useIssueInsight();
  if (insight === null) return null;
  return (
    <div className="pg-insight">
      {insight.replay && (
        <p className="pg-replay" role="status" data-testid="replay-notice">
          <b>Mismo pedido{insight.orderNumber === null ? "" : ` (${insight.orderNumber})`}:</b> Hacienda no emitió otra factura; este es el documento original.
        </p>
      )}
      {insight.session !== null && <TimingsPanel title="Preparar la sesión" timings={insight.session} />}
      {insight.issue !== null && <TimingsPanel title="Emitir" timings={insight.issue} />}
    </div>
  );
}
