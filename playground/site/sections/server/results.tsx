import { useEffect, useMemo, useState } from "react";
import { Skeleton, useElapsed } from "../../components/busy.tsx";
import type { RunFile, RunResponse, RunStep } from "./recipes-api.ts";

function blobOf(file: RunFile): Blob | null {
  if (file.base64 === undefined) return null;
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: file.contentType });
}

function FileView({ file }: { file: RunFile }) {
  const blob = useMemo(() => blobOf(file), [file]);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (blob === null) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    if (file.contentType.includes("json")) {
      void blob.text().then((raw) => {
        try {
          setText(JSON.stringify(JSON.parse(raw), null, 2));
        } catch {
          setText(raw);
        }
      });
    }
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob, file.contentType]);

  return (
    <div className="srv-file">
      <div className="srv-file-head">
        <span className="mono">{file.name} <small>({Math.max(1, Math.round(file.size / 1024))} KB)</small></span>
        {url !== null && <a className="pg-btn pg-btn--sm" href={url} download={file.name}>Descargar</a>}
      </div>
      {blob === null && <p className="pg-note">El archivo es demasiado grande para mostrarlo aquí.</p>}
      {url !== null && file.contentType.includes("pdf") && <iframe className="srv-pdf" title={`Vista previa de ${file.name}`} src={url} />}
      {text !== null && <pre className="srv-json" tabIndex={0}>{text}</pre>}
    </div>
  );
}

/** One run's calls, as the timeline rows of the board (a retry is its own row). */
export interface TimelineRun { retry: boolean; steps: RunStep[]; issuedLabel: string | null }

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** The row of the call in flight: a pulsing dot, what is running and how long it has been. */
function PendingStep({ label }: { label: string }) {
  const elapsed = useElapsed(true);
  return (
    <li className="srv-step srv-step--pending" role="status" aria-live="polite">
      <span className="srv-dot srv-dot--pending" aria-hidden />
      <div>
        <div className="srv-step-head">
          <span className="mono">{label}</span>
          <span data-testid="pending-elapsed">{seconds(elapsed)}</span>
        </div>
        <div className="srv-step-detail">Esperando la respuesta de staging…</div>
      </div>
    </li>
  );
}

/** What the results area shows while a run is in flight: placeholders where the response, PDF and JSON will be. */
export function ResultSkeleton() {
  return <Skeleton lines={4} label="Esperando el resultado de la ejecución" />;
}

export function Timeline({ runs, sameDocument, pending }: { runs: TimelineRun[]; sameDocument: { code: string } | null; /** Label of the call in flight, when there is one. */ pending?: string | null }) {
  const rows = runs.flatMap((run, runIndex) => run.steps.map((step, i) => ({ run, step, runIndex, last: i === run.steps.length - 1 })));
  if (rows.length === 0 && !pending) return null;
  return (
    <ol className="srv-timeline" aria-label="Llamadas al API">
      {rows.map(({ run, step, last, runIndex }, index) => {
        const failed = step.status === null || step.status >= 400;
        const tone = failed ? "bad" : run.retry ? "retry" : "ok";
        const isLastRow = index === rows.length - 1 && !pending;
        return (
          <li key={index} className="srv-step">
            <span className={`srv-dot srv-dot--${tone}`} aria-hidden />
            <div>
              <div className="srv-step-head">
                <span className="mono">{step.method} {step.endpoint}{run.retry && runIndex > 0 ? " · reintento" : ""}</span>
                <span>{seconds(step.ms)}</span>
              </div>
              <div className="srv-step-detail">
                {step.status ?? "sin respuesta"}{last && run.issuedLabel !== null ? ` · sellada · ${run.issuedLabel}` : ""}
              </div>
              {isLastRow && sameDocument !== null && <div className="srv-same">El mismo documento: {sameDocument.code}</div>}
            </div>
          </li>
        );
      })}
      {pending ? <PendingStep label={pending} /> : null}
    </ol>
  );
}

/** Failure or notices of the last run. */
export function RunNotice({ run }: { run: RunResponse }) {
  if (run.ok) return null;
  return (
    <div role="alert" className="srv-fail" data-testid="recipe-results">
      <strong>{run.error?.message ?? "La receta no se completó."}</strong>
      <p>Código: <code>{run.error?.code}</code>{run.error?.status ? ` · HTTP ${run.error.status}` : ""}</p>
      {run.error?.spent && <p>Hacienda rechazó el documento y ya gastó el correlativo {run.error.spent.numeroControl}.</p>}
      {run.error?.observations?.map((o) => <p key={o}>Hacienda: {o}</p>)}
      {run.steps.length === 0 && <p>No se llegó a llamar al API.</p>}
    </div>
  );
}

type Tab = "response" | "pdf" | "json";

/** Respuesta / PDF / JSON firmado: the redacted result and the real files of the run. */
export function ResultTabs({ run }: { run: RunResponse }) {
  const [tab, setTab] = useState<Tab>("response");
  const pdfs = run.files.filter((f) => f.contentType.includes("pdf"));
  const others = run.files.filter((f) => !f.contentType.includes("pdf"));
  const tabs: Array<[Tab, string]> = [["response", "Respuesta"], ["pdf", "PDF"], ["json", "JSON firmado"]];
  const requests = run.steps.filter((s) => s.request !== undefined);
  return (
    <div className="srv-result" data-testid={run.ok ? "recipe-results" : undefined}>
      <div role="tablist" aria-label="Resultado" className="srv-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`srv-tab-${id}`} aria-selected={tab === id} aria-controls="srv-tabpanel" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id="srv-tabpanel" aria-labelledby={`srv-tab-${tab}`} className="srv-tabpanel">
        {tab === "response" && (
          <>
            {run.result !== null ? <pre className="srv-json" tabIndex={0}>{JSON.stringify(run.result, null, 2)}</pre> : <p className="pg-note">Esta receta no devolvió datos.</p>}
            {requests.length > 0 && (
              <details className="srv-requests">
                <summary>Cuerpo de las solicitudes (sin llaves)</summary>
                <pre className="srv-json" tabIndex={0}>{JSON.stringify(requests.map((s) => ({ [`${s.method} ${s.endpoint}`]: s.request })), null, 2)}</pre>
              </details>
            )}
          </>
        )}
        {tab === "pdf" && (pdfs.length > 0 ? pdfs.map((f) => <FileView key={f.name} file={f} />) : <p className="pg-note">Esta ejecución no produjo un PDF.</p>)}
        {tab === "json" && (others.length > 0 ? others.map((f) => <FileView key={f.name} file={f} />) : <p className="pg-note">Esta ejecución no produjo un JSON firmado.</p>)}
      </div>
    </div>
  );
}
