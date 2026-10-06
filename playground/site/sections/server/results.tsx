import { useEffect, useMemo, useState } from "react";
import type { RunFile, RunResponse } from "./recipes-api.ts";

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
    <details className="pg-file" open>
      <summary>
        {file.name} <small>({Math.max(1, Math.round(file.size / 1024))} KB)</small>
      </summary>
      {blob === null && <p className="pg-note">El archivo es demasiado grande para mostrarlo aquí.</p>}
      {url !== null && <a className="pg-btn" href={url} download={file.name}>Descargar</a>}
      {url !== null && file.contentType.includes("pdf") && <iframe className="pg-pdf" title={`Vista previa de ${file.name}`} src={url} />}
      {text !== null && <pre className="pg-json" tabIndex={0}>{text}</pre>}
    </details>
  );
}

export function Results({ run }: { run: RunResponse }) {
  return (
    <div className="pg-results" data-testid="recipe-results">
      {run.ok ? (
        <p className="pg-ok" role="status">Listo en {run.totalMs} ms.</p>
      ) : (
        <div role="alert" className="pg-fail">
          <strong>{run.error?.message ?? "La receta no se completó."}</strong>
          <p className="pg-note">Código: <code>{run.error?.code}</code>{run.error?.status ? ` · HTTP ${run.error.status}` : ""}</p>
          {run.error?.spent && (
            <p className="pg-note">Hacienda rechazó el documento y ya gastó el correlativo {run.error.spent.numeroControl}.</p>
          )}
          {run.error?.observations?.map((o) => <p className="pg-note" key={o}>Hacienda: {o}</p>)}
        </div>
      )}

      <h3>Solicitudes al API</h3>
      {run.steps.length === 0 ? <p className="pg-note">No se llegó a llamar al API.</p> : (
        <div className="pg-table-wrap">
          <table className="pg-table">
            <thead><tr><th>Método</th><th>Dirección</th><th>Estado</th><th>Tiempo</th></tr></thead>
            <tbody>
              {run.steps.map((step, index) => (
                <tr key={index}>
                  <td>{step.method}</td>
                  <td><code>{step.endpoint}</code></td>
                  <td>{step.status ?? "—"}</td>
                  <td>{step.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {run.steps.some((s) => s.request !== undefined) && (
        <details>
          <summary>Cuerpo de las solicitudes (sin llaves)</summary>
          <pre className="pg-json" tabIndex={0}>{JSON.stringify(run.steps.filter((s) => s.request !== undefined).map((s) => ({ [`${s.method} ${s.endpoint}`]: s.request })), null, 2)}</pre>
        </details>
      )}

      {run.result !== null && (
        <>
          <h3>Respuesta</h3>
          <p className="pg-note">Se muestra sin llaves, rutas ni identificadores de almacenamiento.</p>
          <pre className="pg-json" tabIndex={0}>{JSON.stringify(run.result, null, 2)}</pre>
        </>
      )}
      {run.files.length > 0 && (
        <>
          <h3>Archivos</h3>
          {run.files.map((file) => <FileView key={file.name} file={file} />)}
        </>
      )}
    </div>
  );
}
