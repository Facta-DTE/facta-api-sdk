import { useEffect, useState } from "react";
import { FactaDocumentDetail } from "../../../../../react.ts";
import { requestInvalidation, type IssuedDocument } from "../../../api.ts";

// One document, inline or as a drawer. Pick one of the documents you issued here.
export function DocumentDetailExample({ issued, onInvalidated }: { issued: IssuedDocument[]; onInvalidated: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (code === null && issued[0] !== undefined) setCode(issued[0].codigoGeneracion);
  }, [issued, code]);
  if (issued.length === 0) return <p className="pg-note">Aún no emitió documentos aquí. Emita uno y vuelva.</p>;
  return (
    <div style={{ display: "grid", gap: 12, width: "100%" }}>
      <label className="pg-field">
        <span>Documento</span>
        <select value={code ?? ""} onChange={(event) => setCode(event.target.value)}>
          {issued.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.numeroControl ?? d.codigoGeneracion}</option>)}
        </select>
      </label>
      <button type="button" className="pg-secondary" onClick={() => setDrawer(true)}>Abrir como panel lateral</button>
      <div style={{ maxWidth: 520 }}>
        <FactaDocumentDetail
          key={code}
          presentation="inline"
          codigoGeneracion={code}
          onInvalidate={(doc) => requestInvalidation(doc.codigoGeneracion)}
          onInvalidated={onInvalidated}
        />
      </div>
      <FactaDocumentDetail codigoGeneracion={code} open={drawer} onOpenChange={setDrawer} />
    </div>
  );
}
