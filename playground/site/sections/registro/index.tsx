import { useCallback, useEffect, useState } from "react";
import { base64ToBytes, createFactaClient, formatDateTime, saveBlob, truncateMiddle } from "../../../../browser.ts";
import { ApiError, loadRegistry, type RegistryDocument } from "../../api.ts";
import { Link } from "../../router.tsx";
import { usePlayground } from "../../state.tsx";
import "./registro.css";

// Section «Registro» (docs/playground.md §5.5). The list is the visitor's own record
// (server/issued-codes.ts); the server adds each document's current state. Files go
// through the SDK handler, which only serves codes this visitor issued.
const client = createFactaClient({ endpoint: "/api/facta" });
const TYPES: Record<string, string> = { "01": "Factura", "03": "Crédito fiscal", "05": "Nota de crédito", "06": "Nota de débito", "11": "Exportación", "14": "Sujeto excluido" };
const STATES: Record<string, string> = { sellado: "Sellado", contingencia: "En contingencia", invalidado: "Invalidado", rechazado: "Rechazado" };

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; documents: RegistryDocument[] };

export function Registro() {
  const { view } = usePlayground();
  const signedIn = view.status === "ready" && view.state.visitor !== null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      setLoad({ status: "ready", documents: await loadRegistry() });
    } catch (error) {
      setLoad({ status: "error", message: error instanceof ApiError ? error.message : "No se pudo leer su registro." });
    }
  }, []);
  useEffect(() => { if (signedIn) void refresh(); }, [signedIn, refresh]);

  async function download(code: string, kind: "pdf" | "json") {
    setBusy(`${code}.${kind}`);
    setProblem(null);
    try {
      const file = await client.downloadDocument(code, kind);
      saveBlob(new Blob([base64ToBytes(file.base64)], { type: file.contentType }), file.filename);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo descargar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pg-page">
      <header className="pg-hero">
        <p className="pg-eyebrow">Solo sus documentos</p>
        <h1>Registro</h1>
        <p className="pg-lead">
          Las facturas de prueba que usted emitió desde el playground, con su estado actual en Hacienda. Otros
          visitantes no aparecen aquí ni pueden abrir sus archivos.
        </p>
      </header>

      {view.status === "ready" && !signedIn && <p className="pg-note">Inicie sesión para ver su registro.</p>}
      {signedIn && load.status === "loading" && <p className="pg-note" aria-busy="true">Leyendo su registro…</p>}
      {signedIn && load.status === "error" && <p role="alert" className="pg-error">{load.message}</p>}
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}

      {load.status === "ready" && load.documents.length === 0 && (
        <div className="pg-card rg-empty">
          <h2>Todavía no hay documentos</h2>
          <p>Cuando emita una factura de prueba aparecerá aquí.</p>
          <Link to="/" className="pg-primary rg-link">Emitir desde Inicio</Link>
        </div>
      )}

      {load.status === "ready" && load.documents.length > 0 && (
        <>
          <div className="rg-bar">
            <span className="pg-note">{load.documents.length} documento{load.documents.length === 1 ? "" : "s"} (los últimos 200)</span>
            <button type="button" className="rg-refresh" onClick={() => void refresh()}>Actualizar</button>
          </div>
          <ul className="rg-list">
            {load.documents.map((d) => (
              <li key={d.codigoGeneracion} className="pg-card rg-row">
                <div className="rg-main">
                  <strong>{TYPES[d.tipoDte] ?? `Tipo ${d.tipoDte}`}</strong>
                  <span className={`rg-state rg-state--${d.estado}`}>{STATES[d.estado] ?? d.estado}</span>
                </div>
                <dl className="rg-meta">
                  <dt>Código</dt><dd title={d.codigoGeneracion}>{truncateMiddle(d.codigoGeneracion, 8, 6)}</dd>
                  <dt>Control</dt><dd title={d.numeroControl}>{truncateMiddle(d.numeroControl, 12, 8)}</dd>
                  <dt>Emitido</dt><dd>{d.current ? formatDateTime(d.current.fecEmi, d.current.horEmi) : formatDateTime(d.issuedAt.slice(0, 10), d.issuedAt.slice(11, 16))}</dd>
                  {d.current?.selloRecibido && <><dt>Sello</dt><dd>{truncateMiddle(d.current.selloRecibido)}</dd></>}
                </dl>
                <div className="rg-actions">
                  {(["pdf", "json"] as const).map((kind) => (
                    <button key={kind} type="button" disabled={busy !== null} onClick={() => void download(d.codigoGeneracion, kind)}>
                      {busy === `${d.codigoGeneracion}.${kind}` ? "Descargando…" : kind === "pdf" ? "Descargar PDF" : "Descargar JSON"}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
