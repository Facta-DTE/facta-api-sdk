import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api.ts";
import { CodeBlock, useCopy } from "../../code-block.tsx";
import { usePlayground } from "../../state.tsx";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
import { RECIPE_SPECS, type FieldSpec, type RecipeSpec } from "../../../server/recipes/specs.ts";
import { denoBunScript, nodeScript, portableSource, projectZip } from "./export.ts";
import { runRecipe, type MyDocument, type RunResponse } from "./recipes-api.ts";
import { ResultTabs, RunNotice, Timeline, type TimelineRun } from "./results.tsx";
import { excerptOf } from "./subtitles.ts";
import { highlight } from "../../components/highlight.tsx";
import { recipePath, recipeSource } from "./sources.ts";

type Values = Record<string, string | boolean>;

function defaults(spec: RecipeSpec, firstProduct: string | undefined): Values {
  const values: Values = {};
  for (const field of spec.fields) {
    if (spec.id === "order-webhook" && field.name === "order") {
      values.order = JSON.stringify({ orderId: `ORD-${Math.floor(1000 + Math.random() * 9000)}`, lines: [{ sku: firstProduct ?? "id-de-un-producto", qty: 2 }] }, null, 2);
    } else values[field.name] = field.default === undefined ? (field.kind === "checkbox" ? false : "") : (field.default as string | boolean);
  }
  return values;
}

function Field({ field, value, onChange, mine }: { field: FieldSpec; value: string | boolean; onChange(v: string | boolean): void; mine: MyDocument[] }) {
  const id = `f-${field.name}`;
  if (field.kind === "checkbox") {
    return (
      <div className="pg-field">
        <label className="pg-check"><input type="checkbox" id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />{field.label}</label>
        {field.help && <p className="pg-hint">{field.help}</p>}
      </div>
    );
  }
  return (
    <div className="pg-field">
      <label htmlFor={id}>{field.label}</label>
      {field.kind === "select" && (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {field.kind === "issued" && (
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? "Elija un documento que usted emitió" : "Ninguno"}</option>
          {mine.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.tipoDte ?? ""} · {d.codigoGeneracion.slice(0, 8)}…{d.estado ? ` · ${d.estado}` : ""}</option>)}
        </select>
      )}
      {(field.kind === "text" || field.kind === "number") && (
        <input id={id} className={field.name === "type" ? undefined : "mono"} type={field.kind === "number" ? "number" : "text"} value={String(value)} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      )}
      {field.kind === "textarea" && <textarea id={id} rows={8} spellCheck={false} value={String(value)} onChange={(e) => onChange(e.target.value)} />}
      {field.help && <p className="pg-hint">{field.help}</p>}
    </div>
  );
}

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RecipePanel({ spec, number, mine, onIssued }: { spec: RecipeSpec; number: number; mine: MyDocument[]; onIssued(docs: MyDocument[]): void }) {
  const { view, refresh } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const firstProduct = state?.demo.products[0]?.id;
  const [values, setValues] = useState<Values>(() => defaults(spec, firstProduct));
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [runs, setRuns] = useState<TimelineRun[]>([]);
  const [previous, setPrevious] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fullCode, setFullCode] = useState(false);
  const { copied, copy } = useCopy();
  const source = recipeSource(spec.file);

  useEffect(() => {
    if (spec.id === "order-webhook" && firstProduct !== undefined) setValues(defaults(spec, firstProduct));
  }, [spec, firstProduct]);

  const visitor = state?.visitor ?? null;
  const exhausted = spec.consumesQuota && state?.quota != null && !state.quota.allowed;
  const unavailable = spec.needsCatalog && state !== null && !state.catalog;
  const ready = useTurnstileReady();
  const blocked = visitor === null || exhausted === true || unavailable === true || (spec.consumesQuota && !ready);
  // The e-mail recipe needs an address or one of your own documents.
  const needsAddress = spec.id === "deliver-email" && !values.code && String(values.email ?? "").trim() === "";
  const needsDocument = needsAddress || spec.fields.some((f) => f.kind === "issued" && f.required && !values[f.name]);

  async function execute(stage: string | undefined, id: string | null, retry = false) {
    setBusy(true);
    setProblem(null);
    const params: Record<string, unknown> = { ...values };
    if (stage === "sign" && continuation !== null) params.continuation = continuation;
    try {
      const out = await runRecipe({ recipe: spec.id, params, ...(stage === undefined ? {} : { stage }), ...(id === null ? {} : { runId: id }) });
      setRun(out);
      setRunId(out.runId);
      setContinuation(out.continuation ?? null);
      const result = out.result as { numeroControl?: unknown } | null;
      const control = typeof result?.numeroControl === "string" ? result.numeroControl : out.issued[0]?.codigoGeneracion;
      const entry: TimelineRun = { retry, steps: out.steps, issuedLabel: out.ok && out.issued.length > 0 && control ? `…${control.slice(-12)}` : null };
      setRuns((all) => (retry || stage === nextStage ? [...all, entry] : [entry]));
      if (out.issued.length > 0) onIssued(out.issued.map((d) => ({ codigoGeneracion: d.codigoGeneracion, ...(d.tipoDte === undefined ? {} : { tipoDte: d.tipoDte }), estado: "sellado" })));
      void refresh();
      return out;
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "No se pudo ejecutar la receta.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const code = (out: RunResponse | null) => out === null ? null : out.issued[0]?.codigoGeneracion ?? null;
  const firstStage = spec.stages?.[0]?.id;
  const nextStage = spec.stages?.[1]?.id;

  const sameDocument = useMemo(() => (previous !== null && code(run) !== null ? previous === code(run) : null), [previous, run]);
  const tail = (value: string) => `…${value.slice(-12)}`;
  const portable = portableSource(source);

  return (
    <>
      <article className="srv-main" aria-labelledby={`r-${spec.id}`}>
        <div className="srv-head">
          <div className="srv-crumb">Solo servidor · receta {number}</div>
          <h1 id={`r-${spec.id}`}>{spec.title}</h1>
          <p>{spec.summary}</p>
          {spec.consumesQuota && <p className="pg-hint">Esta receta cuenta contra su límite de emisiones; repetir la misma llave no cuenta otra vez.</p>}
        </div>

        <div className={`srv-codewrap${fullCode ? " is-full" : ""}`}>
          <CodeBlock
            className="srv-codeblock"
            title={`recipes/${spec.file}`}
            code={source}
            path={recipePath(spec.file)}
            actions={
              <span className="srv-code-actions">
                <button type="button" className="pg-code-action" onClick={() => copy("node", nodeScript(source))}>{copied === "node" ? "Copiado" : "Copiar para Node"}</button>
                <button type="button" className="pg-code-action" onClick={() => copy("deno", denoBunScript(source))}>{copied === "deno" ? "Copiado" : "Deno / Bun"}</button>
                <button type="button" className="pg-code-action" onClick={() => download(`facta-receta-${spec.id}.zip`, projectZip(source, spec.id), "application/zip")}>Descargar proyecto</button>
              </span>
            }
          />
          <div className="pg-code srv-excerpt">
            <pre tabIndex={0}><code>{highlight(excerptOf(portable))}</code></pre>
            <div className="srv-excerpt-foot">
              <button type="button" onClick={() => setFullCode(true)}>Ver la receta completa</button>
            </div>
          </div>
          <p className="pg-hint srv-code-note">El proyecto descargable pide SU llave de pruebas en <code>.env</code>; nunca incluye la del playground.</p>
          {fullCode && <button type="button" className="srv-collapse" onClick={() => setFullCode(false)}>Ver solo el resumen</button>}
        </div>
      </article>

      <aside className="srv-run" aria-label="Ejecutar en staging">
        <h2>Ejecutar en staging</h2>
        <form className="srv-form" onSubmit={(e) => { e.preventDefault(); if (!busy && !blocked && !needsDocument) { setPrevious(null); setContinuation(null); setRuns([]); void execute(firstStage, null); } }}>
          {spec.fields.map((field) => (
            <Field key={field.name} field={field} value={values[field.name] ?? ""} mine={mine} onChange={(v) => setValues((c) => ({ ...c, [field.name]: v }))} />
          ))}
          <TurnstileBox />
          <div className="srv-actions">
            <button type="submit" className="pg-primary" disabled={busy || blocked || needsDocument}>
              {busy && !continuation ? "Ejecutando…" : spec.stages ? `Ejecutar: ${spec.stages[0]!.label}` : "Ejecutar"}
            </button>
            {nextStage !== undefined && continuation !== null && run?.ok === true && run.stage === firstStage && (
              <button type="button" className="pg-primary" disabled={busy} onClick={() => void execute(nextStage, runId)}>{spec.stages![1]!.label}</button>
            )}
            {spec.retry && (
              <button type="button" className="pg-secondary" disabled={busy || blocked || run === null || !run.ok || runId === null} onClick={() => { setPrevious(code(run)); void execute(firstStage, runId, true); }}>
                Reintentar igual
              </button>
            )}
          </div>
        </form>
        {visitor === null && state !== null && <p className="pg-note">Inicie sesión para ejecutar recetas.</p>}
        {exhausted && <p className="pg-error">Límite de emisiones alcanzado. Intente de nuevo más tarde.</p>}
        {unavailable && <p className="pg-note">El catálogo no está habilitado en este playground.</p>}
        {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
        {sameDocument !== null && !sameDocument && <p className="pg-error" role="status">El documento es distinto.</p>}

        {run !== null && (
          <div className="srv-results">
            <hr />
            <p className="srv-total" role="status">{run.ok ? `Listo en ${(run.totalMs / 1000).toFixed(2)} s.` : "La ejecución falló."}</p>
            <Timeline runs={runs} sameDocument={sameDocument === true && code(run) !== null ? { code: tail(run.issued[0]!.codigoGeneracion) } : null} />
            <RunNotice run={run} />
            {run.ok && <ResultTabs run={run} />}
            {spec.id === "catalog-refs" && <CatalogPicks run={run} onPick={(name, value) => setValues((c) => ({ ...c, [name]: value }))} />}
            <p className="srv-redaction">Las llaves, rutas de almacenamiento y tokens nunca aparecen en la respuesta.</p>
          </div>
        )}
      </aside>
    </>
  );
}

function CatalogPicks({ run, onPick }: { run: RunResponse; onPick(name: string, value: string): void }) {
  const result = run.result as { customers?: Array<{ id: string; name: string | null }>; products?: Array<{ id: string; description: string | null }> } | null;
  if (!result) return null;
  return (
    <div className="srv-picks">
      {result.customers && result.customers.length > 0 && (
        <div><h4>Clientes</h4>{result.customers.map((c) => <button type="button" className="srv-chip" key={c.id} onClick={() => onPick("customerId", c.id)}>{c.name ?? c.id}</button>)}</div>
      )}
      {result.products && result.products.length > 0 && (
        <div><h4>Productos</h4>{result.products.map((p) => <button type="button" className="srv-chip" key={p.id} onClick={() => onPick("productId", p.id)}>{p.description ?? p.id}</button>)}</div>
      )}
    </div>
  );
}

export { RECIPE_SPECS };
