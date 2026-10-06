import { useMemo, useState } from "react";
import type { RegistryDocument } from "../../api.ts";
import { StatusChip } from "../../components/ui.tsx";
import { Busy, Skeleton } from "../../components/busy.tsx";
import { Link } from "../../router.tsx";
import { usePlayground } from "../../state.tsx";
import { useDownload } from "./downloads.ts";
import { InvalidateDialog } from "./invalidate-dialog.tsx";
import { money, needsEnrich, observationsOf, TYPE_NAMES, tail, totalOf, useRegistry, useVisibleRows, whenOf } from "./registry-data.ts";
import "./registro.css";

// Section «Registro» (docs/playground.md §5.5). The list is the visitor's own record
// (server/issued-codes.ts), which already holds each document's total. The API is asked only about
// the rows on screen that need it (a pending state, a missing total), a few at a time, and the server
// answers from its cache whenever it can. Files go through the SDK handler, which only serves codes
// this visitor issued.
const STATES: [string, string][] = [["sellado", "Sellada"], ["rechazado", "Rechazada"], ["invalidado", "Anulada"], ["contingencia", "Contingencia"]];

export function Registro() {
  const { view } = usePlayground();
  const { registry, reload, enrich, signedIn } = useRegistry();
  const { busy, problem, download } = useDownload();
  const [type, setType] = useState("");
  const [estado, setEstado] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [voiding, setVoiding] = useState<RegistryDocument | null>(null);
  const canInvalidate = view.status === "ready" && view.state.demo.canInvalidate;

  const documents = registry.status === "ready" ? registry.documents : [];
  const types = useMemo(() => [...new Set(documents.map((d) => d.tipoDte))].sort(), [documents]);
  const shown = documents.filter((d) => (type === "" || d.tipoDte === type) && (estado === "" || d.estado === estado));
  // The first rejected document explains itself without a click, as in the board.
  const open = reason ?? documents.find((d) => d.estado === "rechazado")?.codigoGeneracion ?? null;

  // Only the rows that scroll into view and still need the API are asked about.
  const observe = useVisibleRows((codes) => {
    const wanted = codes.filter((code) => {
      const row = documents.find((d) => d.codigoGeneracion === code);
      return row !== undefined && needsEnrich(row);
    });
    if (wanted.length > 0) void enrich(wanted);
  });

  async function check(code: string) {
    setChecking(code);
    await enrich([code], { force: true });
    setChecking(null);
  }

  async function refresh() {
    setRefreshing(true);
    await reload();
    // Pending documents (contingencia) are the ones whose state can have changed.
    const pending = documents.filter((d) => d.estado === "contingencia").slice(0, 10).map((d) => d.codigoGeneracion);
    await enrich(pending, { force: true });
    setRefreshing(false);
  }

  return (
    <div className="pg-wrap pg-wrap--mid reg">
      <header className="reg-head">
        <div>
          <h1>Sus documentos de prueba</h1>
          <p className="reg-lead">Solo los que usted emitió en el playground. Cada documento guarda su total al emitirse; el estado solo se consulta al API cuando puede haber cambiado.</p>
        </div>
        {documents.length > 0 && (
          <div className="reg-filters">
            <label className="reg-select"><span className="pg-sr">Tipo de documento</span>
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">Todos los tipos</option>
                {types.map((t) => <option key={t} value={t}>{TYPE_NAMES[t] ?? `Tipo ${t}`}</option>)}
              </select>
            </label>
            <label className="reg-select"><span className="pg-sr">Estado</span>
              <select value={estado} onChange={(event) => setEstado(event.target.value)}>
                <option value="">Todos los estados</option>
                {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button type="button" className="pg-secondary reg-refresh" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <Busy>Actualizando…</Busy> : "Actualizar"}</button>
          </div>
        )}
      </header>

      {view.status === "ready" && !signedIn && <p className="pg-note">Inicie sesión para ver su registro.</p>}
      {signedIn && registry.status === "loading" && <div aria-busy="true"><Skeleton lines={4} label="Leyendo su registro" /></div>}
      {signedIn && registry.status === "error" && <p role="alert" className="pg-error">{registry.message}</p>}
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}

      {registry.status === "ready" && documents.length === 0 && (
        <div className="pg-card reg-empty">
          <h2>Todavía no hay documentos</h2>
          <p>Cuando emita una factura de prueba aparecerá aquí.</p>
          <Link to="/" className="pg-primary">Emitir desde Inicio</Link>
        </div>
      )}

      {documents.length > 0 && (
        <>
          <p className="pg-hint reg-count" role="status">{shown.length} de {documents.length} documento{documents.length === 1 ? "" : "s"} (los últimos 200)</p>
          {shown.length === 0 && <p className="pg-note">Ningún documento coincide con los filtros.</p>}
          {shown.length > 0 && (
            <div className="reg-table-card">
              <table className="reg-table">
                <thead>
                  <tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Número de control</th><th scope="col" className="r">Total</th><th scope="col">Estado</th><th scope="col"><span className="pg-sr">Acciones</span></th></tr>
                </thead>
                <tbody>
                  {shown.map((d) => {
                    const total = totalOf(d);
                    const label = `${TYPE_NAMES[d.tipoDte] ?? d.tipoDte} ${tail(d.numeroControl, 4)}`;
                    const observations = observationsOf(d);
                    return [
                      <tr key={d.codigoGeneracion} ref={observe(d.codigoGeneracion)} className={`reg-row reg-row--${d.estado}`}>
                        <td className="when">{whenOf(d)}</td>
                        <td className="type">{TYPE_NAMES[d.tipoDte] ?? `Tipo ${d.tipoDte}`}</td>
                        <td className="ctl mono" title={d.numeroControl}><span className="reg-ctl-full">{d.numeroControl}</span><span className="reg-ctl-short">{tail(d.numeroControl, 4)}</span></td>
                        <td className="total r">{total === null ? "—" : money(total)}</td>
                        <td className="state"><StatusChip estado={d.estado} /></td>
                        <td className="act">
                          {(d.estado === "sellado" || d.estado === "invalidado") && (["pdf", "json"] as const).map((kind) => (
                            <button key={kind} type="button" className="pg-btn pg-btn--sm" aria-label={`Descargar ${kind.toUpperCase()} de ${label}`} disabled={busy !== null} onClick={() => void download(d.codigoGeneracion, kind)}>
                              {busy === `${d.codigoGeneracion}.${kind}` ? "…" : kind.toUpperCase()}
                            </button>
                          ))}
                          {d.estado === "sellado" && canInvalidate && (
                            <button type="button" className="pg-btn pg-btn--sm reg-void" aria-label={`Anular ${label}`} onClick={() => setVoiding(d)}>Anular</button>
                          )}
                          {d.estado === "rechazado" && (
                            <button type="button" className="pg-btn pg-btn--sm" aria-expanded={open === d.codigoGeneracion} aria-controls={`reason-${d.codigoGeneracion}`} onClick={() => setReason(open === d.codigoGeneracion ? "" : d.codigoGeneracion)}>Ver motivo</button>
                          )}
                          {d.estado === "contingencia" && (
                            <button type="button" className="pg-btn pg-btn--sm" aria-label={`Consultar estado de ${label}`} disabled={checking !== null} onClick={() => void check(d.codigoGeneracion)}>
                              {checking === d.codigoGeneracion ? <Busy>Consultando…</Busy> : "Consultar estado"}
                            </button>
                          )}
                        </td>
                      </tr>,
                      d.estado === "rechazado" && open === d.codigoGeneracion && (
                        <tr key={`${d.codigoGeneracion}-why`} className="reg-why-row">
                          <td colSpan={6}>
                            <div className="reg-why" id={`reason-${d.codigoGeneracion}`} role="note">
                              <b>Motivo de Hacienda:</b>{" "}
                              {observations.length > 0
                                ? observations.map((o) => <code key={o}>{o}</code>)
                                : <span>Hacienda no devolvió observaciones para este documento. Use «Actualizar» para volver a leerlo.</span>}
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {voiding !== null && <InvalidateDialog doc={voiding} onClose={() => setVoiding(null)} onDone={() => void reload()} />}
    </div>
  );
}
