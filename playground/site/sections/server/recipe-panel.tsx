import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api.ts";
import { CodeBlock } from "../../code-block.tsx";
import { usePlayground } from "../../state.tsx";
import { RECIPE_SPECS, type FieldSpec, type RecipeSpec } from "../../../server/recipes/specs.ts";
import { denoBunScript, nodeScript, projectZip } from "./export.ts";
import { runRecipe, type MyDocument, type RunResponse } from "./recipes-api.ts";
import { Results } from "./results.tsx";
import { RECIPE_SOURCES } from "./sources.ts";

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
        {field.help && <p className="pg-note">{field.help}</p>}
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
        <input id={id} type={field.kind === "number" ? "number" : "text"} value={String(value)} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      )}
      {field.kind === "textarea" && <textarea id={id} rows={8} spellCheck={false} value={String(value)} onChange={(e) => onChange(e.target.value)} />}
      {field.help && <p className="pg-note">{field.help}</p>}
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

export function RecipePanel({ spec, mine, onIssued }: { spec: RecipeSpec; mine: MyDocument[]; onIssued(docs: MyDocument[]): void }) {
  const { view, refresh } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const firstProduct = state?.demo.products[0]?.id;
  const [values, setValues] = useState<Values>(() => defaults(spec, firstProduct));
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const source = RECIPE_SOURCES[spec.id]!;

  useEffect(() => {
    if (spec.id === "order-webhook" && firstProduct !== undefined) setValues(defaults(spec, firstProduct));
  }, [spec, firstProduct]);

  const visitor = state?.visitor ?? null;
  const exhausted = spec.consumesQuota && state?.quota != null && !state.quota.allowed;
  const unavailable = spec.needsCatalog && state !== null && !state.catalog;
  const blocked = visitor === null || exhausted === true || unavailable === true;
  const needsDocument = spec.fields.some((f) => f.kind === "issued" && f.required && !values[f.name]);

  async function execute(stage: string | undefined, id: string | null) {
    setBusy(true);
    setProblem(null);
    const params: Record<string, unknown> = { ...values };
    if (stage === "sign" && continuation !== null) params.continuation = continuation;
    try {
      const out = await runRecipe({ recipe: spec.id, params, ...(stage === undefined ? {} : { stage }), ...(id === null ? {} : { runId: id }) });
      setRun(out);
      setRunId(out.runId);
      setContinuation(out.continuation ?? null);
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

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    }, () => undefined);
  };

  const sameDocument = useMemo(() => (previous !== null && code(run) !== null ? previous === code(run) : null), [previous, run]);

  return (
    <article className="pg-card pg-recipe" aria-labelledby={`r-${spec.id}`}>
      <h2 id={`r-${spec.id}`}>{spec.title}</h2>
      <p>{spec.summary}</p>
      {spec.consumesQuota && <p className="pg-note">Esta receta cuenta contra su límite de emisiones; repetir la misma llave no cuenta otra vez.</p>}

      <form className="pg-form" onSubmit={(e) => { e.preventDefault(); if (!busy && !blocked && !needsDocument) { setPrevious(null); setContinuation(null); void execute(firstStage, null); } }}>
        {spec.fields.map((field) => (
          <Field key={field.name} field={field} value={values[field.name] ?? ""} mine={mine} onChange={(v) => setValues((c) => ({ ...c, [field.name]: v }))} />
        ))}
        <div className="pg-actions">
          <button type="submit" className="pg-primary" disabled={busy || blocked || needsDocument}>
            {busy && !continuation ? "Ejecutando…" : spec.stages ? `Ejecutar: ${spec.stages[0]!.label}` : "Ejecutar en staging"}
          </button>
          {nextStage !== undefined && continuation !== null && run?.ok === true && run.stage === firstStage && (
            <button type="button" className="pg-primary" disabled={busy} onClick={() => void execute(nextStage, runId)}>{spec.stages![1]!.label}</button>
          )}
          {spec.retry && run !== null && run.ok && runId !== null && (
            <button type="button" className="pg-btn" disabled={busy} onClick={() => { setPrevious(code(run)); void execute(firstStage, runId); }}>
              Reintentar con la misma llave
            </button>
          )}
        </div>
      </form>
      {visitor === null && state !== null && <p className="pg-note">Inicie sesión para ejecutar recetas.</p>}
      {exhausted && <p className="pg-error">Límite de emisiones alcanzado. Intente de nuevo más tarde.</p>}
      {unavailable && <p className="pg-note">El catálogo no está habilitado en este playground.</p>}
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
      {sameDocument !== null && (
        <p className={sameDocument ? "pg-ok" : "pg-error"} role="status">
          {sameDocument ? "Es el mismo documento: la llave evitó una segunda emisión." : "El documento es distinto."}
        </p>
      )}

      {run !== null && (
        <>
          <Results run={run} />
          {spec.id === "catalog-refs" && <CatalogPicks run={run} onPick={(name, value) => setValues((c) => ({ ...c, [name]: value }))} />}
        </>
      )}

      <h3>El código que se ejecuta</h3>
      <CodeBlock title={`Servidor · server/recipes/${spec.file}`} code={source} />
      <div className="pg-actions">
        <button type="button" className="pg-btn" onClick={() => copy("node", nodeScript(source))}>{copied === "node" ? "Copiado" : "Copiar para Node"}</button>
        <button type="button" className="pg-btn" onClick={() => copy("deno", denoBunScript(source))}>{copied === "deno" ? "Copiado" : "Copiar para Deno/Bun"}</button>
        <button type="button" className="pg-btn" onClick={() => download(`facta-receta-${spec.id}.zip`, projectZip(source, spec.id), "application/zip")}>
          Descargar proyecto (con su propia llave)
        </button>
      </div>
      <p className="pg-note">El proyecto pide SU llave de pruebas en <code>.env</code>; nunca incluye la del playground.</p>
    </article>
  );
}

function CatalogPicks({ run, onPick }: { run: RunResponse; onPick(name: string, value: string): void }) {
  const result = run.result as { customers?: Array<{ id: string; name: string | null }>; products?: Array<{ id: string; description: string | null }> } | null;
  if (!result) return null;
  return (
    <div className="pg-picks">
      {result.customers && result.customers.length > 0 && (
        <div><h4>Clientes</h4>{result.customers.map((c) => <button type="button" className="pg-chip" key={c.id} onClick={() => onPick("customerId", c.id)}>{c.name ?? c.id}</button>)}</div>
      )}
      {result.products && result.products.length > 0 && (
        <div><h4>Productos</h4>{result.products.map((p) => <button type="button" className="pg-chip" key={p.id} onClick={() => onPick("productId", p.id)}>{p.description ?? p.id}</button>)}</div>
      )}
    </div>
  );
}

export { RECIPE_SPECS };
