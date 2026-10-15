import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { base64ToBytes, createFactaClient, saveBlob } from "../../../browser.ts";
import { archivoDteFromStored, dteFileName } from "../../shared/archivo-dte.ts";
import { playgroundFetch } from "../api.ts";
import { Busy } from "./busy.tsx";
import { DteView } from "./dte-view.tsx";
import "./document-forms.css";
import {
  canShowPdfInline, DEFAULT_ROLL_MM, downloadProblem, MAX_ROLL_MM, MIN_ROLL_MM, parseRollWidth, ROLL_PRESETS, ticketLabel,
  ticketUnavailable, type DocumentFormsKind,
} from "./document-forms-logic.ts";

// «Las tres formas del documento» (board Ticket.dc.html): the same sealed document as a letter-size PDF, as the
// 80 mm POS ticket and as the JSON DTE. The files come through the SDK handler (`/api/facta`, action
// `documents.download`), which only serves documents this visitor issued and validates `paperWidthMm`.

const client = createFactaClient({ endpoint: "/api/facta", fetch: (input, init) => playgroundFetch(input, init) });

type Form = "carta" | "ticket" | "json";
const FORM_LABEL: Record<Form, string> = { carta: "Hoja carta (PDF)", ticket: "Ticket", json: "JSON DTE" };
/** Shorter wording for containers under 420 px (the CSS swaps them), so three segments never clip. */
const FORM_SHORT: Record<Form, string> = { carta: "Carta", ticket: "Ticket", json: "JSON" };

interface Loaded { url: string; filename: string; text?: string }

/** One download, remembered by what was asked so a tab or width already seen is not fetched twice. */
const cache = new Map<string, Promise<{ bytes: Uint8Array; filename: string; contentType: string }>>();
function fetchFile(code: string, kind: "pdf" | "json" | "ticket", paperWidthMm?: number) {
  const key = `${code}|${kind}|${paperWidthMm ?? ""}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = client.downloadDocument(code, kind, paperWidthMm === undefined ? undefined : { paperWidthMm }).then((file) => ({ bytes: base64ToBytes(file.base64), filename: file.filename, contentType: file.contentType }));
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

export interface DocumentFormsProps {
  /** Generation code of a document THIS visitor issued. */
  code: string;
  /** `contingencia` explains the ticket instead of offering it. */
  estado?: string;
  /** A return event has no ticket. */
  kind?: DocumentFormsKind;
  /** Hacienda's seal, to build the Archivo DTE from the stored JSON (unknown: the original is shown). */
  seal?: string | null;
  /** Load the preview on mount. Default false: a button asks for it, so a results area does not spend an API call per run. */
  eager?: boolean;
  /** Show the «Cómo se pide» snippet beside the downloads. */
  showHow?: boolean;
  title?: string;
}

export function DocumentForms({ code, estado, kind = "document", seal = null, eager = false, showHow = true, title }: DocumentFormsProps) {
  const [form, setForm] = useState<Form>("ticket");
  const [preset, setPreset] = useState<"58" | "80" | "otro">("80");
  const [other, setOther] = useState("100");
  const [asked, setAsked] = useState(eager);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<Form | null>(null);
  const last = useRef<string | null>(null);

  const width = preset === "otro" ? parseRollWidth(other) : Number(preset);
  const noTicket = ticketUnavailable({ kind, estado });
  const invalidWidth = form === "ticket" && width === null;
  const inline = useMemo(() => canShowPdfInline(typeof navigator === "undefined" ? {} : (navigator as Navigator & { pdfViewerEnabled?: boolean })), []);

  // The preview: the real file for the chosen form, as an object URL that is revoked when it is replaced.
  useEffect(() => {
    if (!asked || (form === "ticket" && (noTicket !== null || width === null))) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setProblem(null);
    const wanted = form === "carta" ? "pdf" : form === "ticket" ? "ticket" : "json";
    void (async () => {
      try {
        const file = await fetchFile(code, wanted, form === "ticket" ? width! : undefined);
        if (cancelled) return;
        if (form === "json") {
          const stored = new TextDecoder().decode(file.bytes);
          const dte = archivoDteFromStored(stored, seal);
          url = URL.createObjectURL(new Blob([dte ?? stored], { type: "application/json" }));
          setLoaded({ url, filename: dteFileName(code), text: dte ?? stored });
        } else {
          url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.contentType }));
          setLoaded({ url, filename: file.filename });
        }
      } catch (error) {
        if (!cancelled) {
          setLoaded(null);
          setProblem(downloadProblem(error as { code?: string; status?: number }, wanted));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (url !== null) URL.revokeObjectURL(url); };
  }, [asked, form, width, code, noTicket, seal]);

  // A new document starts a new preview.
  useEffect(() => {
    if (last.current !== null && last.current !== code) { setLoaded(null); setAsked(eager); }
    last.current = code;
  }, [code, eager]);

  const save = useCallback(async (what: Form) => {
    setBusy(what);
    setProblem(null);
    try {
      const wanted = what === "carta" ? "pdf" : what === "ticket" ? "ticket" : "json";
      const file = await fetchFile(code, wanted, what === "ticket" ? width ?? DEFAULT_ROLL_MM : undefined);
      if (what === "json") {
        const stored = new TextDecoder().decode(file.bytes);
        const dte = archivoDteFromStored(stored, seal);
        saveBlob(new Blob([dte ?? stored], { type: "application/json" }), dte === null ? `${code}.raw.json` : dteFileName(code));
      } else {
        saveBlob(new Blob([file.bytes as BlobPart], { type: file.contentType }), file.filename);
      }
    } catch (error) {
      setProblem(downloadProblem(error as { code?: string; status?: number }, what === "carta" ? "pdf" : what === "ticket" ? "ticket" : "json"));
    } finally {
      setBusy(null);
    }
  }, [code, width, seal]);

  const ticketWidth = width ?? DEFAULT_ROLL_MM;
  const forms: Form[] = ["carta", "ticket", "json"];
  const shown = form === "ticket" && noTicket !== null;

  return (
    <section className="docforms" aria-label="Las tres formas del documento">
      <header className="docforms-head">
        <p className="docforms-lead">{title ?? "El mismo documento tiene tres formas: la hoja carta (PDF), el ticket para impresora térmica de punto de venta y el JSON DTE. El ticket se dibuja al ancho de su rollo; su contenido legal es el mismo."}</p>
        <div role="tablist" aria-label="Forma del documento" className="docforms-seg">
          {forms.map((f) => <button key={f} type="button" role="tab" aria-selected={form === f} aria-label={FORM_LABEL[f]} onClick={() => setForm(f)}><span className="df-long">{FORM_LABEL[f]}</span><span className="df-short" aria-hidden="true">{FORM_SHORT[f]}</span></button>)}
        </div>
      </header>

      <div className="docforms-grid">
        <div className="docforms-stage">
          {form === "ticket" && (
            <div className="docforms-roll">
              <span className="docforms-roll-label" id="docforms-roll">Ancho del rollo</span>
              <div role="radiogroup" aria-labelledby="docforms-roll" className="docforms-seg docforms-seg--small">
                {ROLL_PRESETS.map((p) => <button key={p} type="button" role="radio" aria-checked={preset === String(p)} onClick={() => setPreset(String(p) as "58" | "80")}>{p} mm</button>)}
                <button type="button" role="radio" aria-checked={preset === "otro"} onClick={() => setPreset("otro")}>Otro…</button>
              </div>
              {preset === "otro" && (
                <label className="docforms-other">
                  <span className="pg-sr">Ancho en milímetros</span>
                  <input inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-invalid={width === null} />
                  <span>mm</span>
                </label>
              )}
              <span className="docforms-roll-note">Vista previa del PDF real que devuelve el API</span>
            </div>
          )}
          {invalidWidth && <p className="pg-error" role="alert">El ancho debe ser un entero de {MIN_ROLL_MM} a {MAX_ROLL_MM} mm.</p>}

          <div className="docforms-view" aria-busy={loading}>
            {shown && <p className="docforms-unavailable" role="status">{noTicket}</p>}
            {!shown && !asked && (
              <button type="button" className="docforms-btn" onClick={() => setAsked(true)}>Ver vista previa</button>
            )}
            {!shown && asked && loading && <p className="pg-note" role="status"><Busy>{`Dibujando el ${form === "ticket" ? `ticket de ${ticketWidth} mm` : form === "carta" ? "PDF" : "JSON"}…`}</Busy></p>}
            {!shown && asked && !loading && problem !== null && <p className="pg-error" role="alert">{problem}</p>}
            {!shown && asked && !loading && problem === null && loaded !== null && form === "json" && loaded.text !== undefined && (
              <DteView code={code} dte={loaded.text} raw={null} downloads={false} />
            )}
            {!shown && asked && !loading && problem === null && loaded !== null && form !== "json" && (
              inline
                ? <iframe className={`docforms-pdf docforms-pdf--${form}`} style={form === "ticket" ? { maxWidth: `${Math.round(ticketWidth * 4.2)}px` } : undefined} title={`Vista previa: ${FORM_LABEL[form]}`} src={`${loaded.url}#toolbar=0&navpanes=0`} />
                : (
                  <div className="docforms-nopreview" role="status">
                    <p>Este dispositivo no muestra PDF dentro de la página. El archivo es el mismo: ábralo o descárguelo.</p>
                    <div className="docforms-actions">
                      <a className="docforms-btn" href={loaded.url} target="_blank" rel="noreferrer">Abrir el {form === "ticket" ? "ticket" : "PDF"}</a>
                      <a className="docforms-btn" href={loaded.url} download={loaded.filename}>Descargar</a>
                    </div>
                  </div>
                )
            )}
          </div>
        </div>

        <div className="docforms-side">
          <div className="docforms-card">
            <h3>Descargar</h3>
            <div className="docforms-actions">
              <button type="button" className="docforms-btn docforms-btn--primary" disabled={busy !== null || noTicket !== null || width === null} aria-describedby={noTicket !== null ? "docforms-why" : undefined} onClick={() => void save("ticket")}>
                {busy === "ticket" ? <Busy>Preparando…</Busy> : ticketLabel(ticketWidth)}
              </button>
              <button type="button" className="docforms-btn" disabled={busy !== null} onClick={() => void save("carta")}>{busy === "carta" ? <Busy>Preparando…</Busy> : "PDF carta"}</button>
              <button type="button" className="docforms-btn" disabled={busy !== null} onClick={() => void save("json")}>{busy === "json" ? <Busy>Preparando…</Busy> : "JSON DTE"}</button>
            </div>
            {noTicket !== null
              ? <p id="docforms-why" className="pg-hint">{noTicket}</p>
              : <p className="pg-hint">El ticket se genera en el momento; no se guarda en el almacenamiento.</p>}
          </div>
          {showHow && (
            <div className="docforms-card">
              <h3>Cómo se pide</h3>
              <pre className="docforms-code" tabIndex={0}><code>{`const pdf = await facta.downloadDocument(codigo, {\n  kind: "ticket",\n  paperWidthMm: ${ticketWidth},   // de ${MIN_ROLL_MM} a ${MAX_ROLL_MM}\n});`}</code></pre>
              <dl className="docforms-how">
                <div><dt>HTTP</dt><dd className="mono">GET /v1/dte/{"{codigo}"}/file?kind=ticket&amp;paperWidthMm={ticketWidth}</dd></div>
                <div><dt>React</dt><dd className="mono">{`<FactaDownloadButton kinds={["ticket"]} />`}</dd></div>
                <div><dt>Plantilla</dt><dd>La de ticket que la empresa eligió en Facta DTE.</dd></div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A single «Ticket» button for a row of a list (Registro): downloads the 80 mm ticket of one document. */
export function TicketButton({ code, estado, kind = "document", width = DEFAULT_ROLL_MM, className = "pg-btn pg-btn--sm" }: { code: string; estado?: string; kind?: DocumentFormsKind; width?: number; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const unavailable = ticketUnavailable({ kind, estado });
  return (
    <>
      <button type="button" className={className} disabled={busy || unavailable !== null} title={unavailable ?? undefined} onClick={async () => {
        setBusy(true);
        setProblem(null);
        try {
          const file = await fetchFile(code, "ticket", width);
          saveBlob(new Blob([file.bytes as BlobPart], { type: file.contentType }), file.filename);
        } catch (error) {
          setProblem(downloadProblem(error as { code?: string; status?: number }, "ticket"));
        } finally {
          setBusy(false);
        }
      }}>{busy ? <Busy>Ticket…</Busy> : "Ticket"}</button>
      {problem !== null && <span role="alert" className="pg-error">{problem}</span>}
    </>
  );
}
