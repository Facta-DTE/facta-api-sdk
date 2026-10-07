import { useMemo, useState, type ReactNode } from "react";
import { dteFileName, parseArchivoDte, rawFileName } from "../../shared/archivo-dte.ts";
import { useCopy } from "../code-block.tsx";
import "./dte-view.css";

/** The sections of a DTE, in the order a person reads them. Anything else goes under «Otros campos». */
const SECTIONS: Array<[key: string, title: string]> = [
  ["identificacion", "Identificación"],
  ["emisor", "Emisor"],
  ["receptor", "Receptor"],
  ["cuerpoDocumento", "Cuerpo del documento"],
  ["resumen", "Resumen"],
];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isLeaf = (value: unknown) => !isRecord(value) && !(Array.isArray(value) && value.some((item) => isRecord(item) || Array.isArray(item)));

function Leaf({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="dte-null">—</span>;
  if (Array.isArray(value)) return <>{value.map((item) => String(item)).join(", ")}</>;
  return <>{String(value)}</>;
}

/** An object as a list of «field: value» rows; nested objects and arrays of objects open below their label. */
function Fields({ value, depth = 0 }: { value: Record<string, unknown>; depth?: number }) {
  return (
    <dl className="dte-fields">
      {Object.entries(value).map(([key, child]) => (
        <div key={key} className={isLeaf(child) ? "dte-row" : "dte-row dte-row--nested"}>
          <dt className="mono">{key}</dt>
          <dd>
            {isLeaf(child) ? <Leaf value={child} /> : <Branch value={child} depth={depth + 1} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Branch({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) {
    return (
      <ol className="dte-items">
        {value.map((item, index) => (
          <li key={index}>
            {isRecord(item) ? <Fields value={item} depth={depth} /> : <Leaf value={item} />}
          </li>
        ))}
      </ol>
    );
  }
  return isRecord(value) ? <Fields value={value} depth={depth} /> : <Leaf value={value} />;
}

function Section({ title, count, children, open = true }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="dte-section" open={open}>
      <summary>{title}{count !== undefined && <span className="dte-count"> · {count} {count === 1 ? "línea" : "líneas"}</span>}</summary>
      <div className="dte-section-body">{children}</div>
    </details>
  );
}

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const shorten = (text: string) => (text.length <= 64 ? text : `${text.slice(0, 40)}…${text.slice(-16)}`);

export interface DteViewProps {
  /** `<codigoGeneracion>`: names the downloads. */
  code: string;
  /** The Archivo DTE text, or null while the document has no seal (contingency). */
  dte: string | null;
  /** The stored original, shown exactly as it is when asked for. */
  raw?: string | null;
  /** Show the download buttons (default). A screen that has its own bar turns them off. */
  downloads?: boolean;
  /** Start on the stored original (tests; a person uses the switch). */
  initiallyRaw?: boolean;
}

/**
 * The JSON of a document as a person reads it: the document by sections, Hacienda's seal and the electronic
 * signature in their own blocks, and a switch to the stored original. Every place that shows a JSON uses this.
 */
export function DteView({ code, dte, raw = null, downloads = true, initiallyRaw = false }: DteViewProps) {
  const parts = useMemo(() => (dte === null ? null : parseArchivoDte(dte)), [dte]);
  const [showRaw, setShowRaw] = useState(initiallyRaw);
  const { copied, copy } = useCopy();
  const hasRaw = raw !== null && raw !== undefined;

  const actions = !downloads ? null : (
    <div className="dte-actions">
      {dte !== null && <button type="button" className="pg-btn pg-btn--sm" onClick={() => save(dteFileName(code), dte)}>Descargar JSON DTE</button>}
      {hasRaw && <button type="button" className="pg-btn pg-btn--sm" onClick={() => save(rawFileName(code), raw)}>Descargar JSON original (raw)</button>}
    </div>
  );

  if (dte === null || parts === null) {
    return (
      <div className="dte" data-testid="dte-view">
        <div className="dte-pending" role="status">
          <strong>Todavía no tiene sello de Hacienda</strong>
          <p>El documento quedó en contingencia: está firmado, pero Hacienda aún no lo ha sellado, así que todavía no hay un JSON DTE completo.{hasRaw ? " Mientras tanto puede descargar el original." : ""}</p>
        </div>
        {hasRaw && (
          <>
            {actions}
            <pre className="srv-json dte-raw" tabIndex={0} data-testid="dte-raw">{raw}</pre>
          </>
        )}
      </div>
    );
  }

  const { document: doc, firma, sello } = parts;
  const known = new Set(SECTIONS.map(([key]) => key));
  const others = Object.fromEntries(Object.entries(doc).filter(([key]) => !known.has(key)));
  return (
    <div className="dte" data-testid="dte-view">
      <div className="dte-bar">
        {actions}
        {hasRaw && (
          <button type="button" className="dte-switch" role="switch" aria-checked={showRaw} onClick={() => setShowRaw((on) => !on)}>
            <span className="dte-switch-track" aria-hidden><span /></span>Ver el original (raw)
          </button>
        )}
      </div>
      {showRaw && hasRaw ? (
        <pre className="srv-json dte-raw" tabIndex={0} data-testid="dte-raw">{raw}</pre>
      ) : (
        <>
          <div className="dte-blocks">
            <div className="dte-block">
              <div className="dte-block-head"><span>Sello de Hacienda</span></div>
              {sello !== null ? (
                <div className="dte-block-body">
                  <code className="mono" data-testid="dte-sello">{sello}</code>
                  <button type="button" className="dte-copy" onClick={() => copy("sello", sello)}>{copied === "sello" ? "Copiado" : "Copiar"}</button>
                </div>
              ) : <p className="dte-null">Sin sello</p>}
            </div>
            <div className="dte-block">
              <div className="dte-block-head"><span>Firma electrónica</span></div>
              {firma !== null ? (
                <div className="dte-block-body">
                  <code className="mono" data-testid="dte-firma" title="Primeros y últimos caracteres; Copiar entrega la firma completa">{shorten(firma)}</code>
                  <button type="button" className="dte-copy" aria-label="Copiar la firma electrónica completa" onClick={() => copy("firma", firma)}>{copied === "firma" ? "Copiado" : "Copiar"}</button>
                </div>
              ) : <p className="dte-null">Sin firma</p>}
            </div>
          </div>
          {SECTIONS.map(([key, title]) => {
            const value = doc[key];
            if (value === undefined) return null;
            return (
              <Section key={key} title={title} {...(Array.isArray(value) ? { count: value.length } : {})} open={key !== "cuerpoDocumento"}>
                <Branch value={value} depth={0} />
              </Section>
            );
          })}
          {Object.keys(others).length > 0 && <Section title="Otros campos" open={false}><Fields value={others} /></Section>}
        </>
      )}
    </div>
  );
}
