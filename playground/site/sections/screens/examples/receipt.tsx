import { useEffect } from "react";
import { FactaDownloadButton, FactaReceipt, FactaStatusBadge, type IssueResult } from "../../../../../react.ts";
import { Skeleton } from "../../../components/busy.tsx";
import { DocumentForms } from "../../../components/document-forms.tsx";
import { lacksCurrent, resultFromRegistry, useRegistry } from "../../registro/registry-data.ts";

// After issuing: the compact receipt (it renders a result you already hold, with no
// network call), the status badge, and download buttons that ask the server for PDF,
// JSON or the 80 mm ticket. The «Entrega» row appears when the sale asked for e-mail.
//
// Before this page has issued anything, the visitor's newest document from an earlier visit stands in
// (the server's record of what they issued), so the components are never shown empty to someone who
// already has documents.
//
// DISPONIBLE DESDE LA PRÓXIMA VERSIÓN DEL SDK (todavía no corre con la versión publicada): the «json»
// button will download the Archivo DTE (document + signature + seal), and the stored original will be offered
// separately (`downloadDocument(code, { kind: "json", raw: true })`). The Registro page already offers both.
export function ReceiptExample({ result }: { result: IssueResult | null }) {
  const { registry, enrich } = useRegistry();
  const latest = registry.status === "ready" ? registry.documents[0] : undefined;
  const needsSeal = result === null && latest !== undefined && lacksCurrent(latest);
  const latestCode = latest?.codigoGeneracion;
  useEffect(() => {
    if (needsSeal && latestCode !== undefined) void enrich([latestCode]);
  }, [needsSeal, latestCode, enrich]);

  const shown = result ?? (latest === undefined ? null : resultFromRegistry(latest));
  if (shown === null) {
    if (registry.status === "loading") return <Skeleton lines={4} label="Buscando su último documento" />;
    return <p className="pg-note">Emita una factura desde «Emitir» (prepare la venta y úsela en cualquier ventana) y aparecerá aquí.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 24, width: "100%", gridTemplateColumns: "minmax(0, 1fr)" }}>
    <div style={{ display: "grid", gap: 16, width: "100%", maxWidth: 520, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {result === null && <p className="pg-hint">Su último documento emitido en el playground. Al emitir uno nuevo, aparece aquí.</p>}
      <FactaReceipt result={shown} environment="00" reference="Playground" />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <FactaStatusBadge estado={shown.estado} />
        <FactaDownloadButton codigoGeneracion={shown.codigoGeneracion} kinds={["pdf", "json", "ticket"]} />
        <FactaDownloadButton codigoGeneracion={shown.codigoGeneracion} variant="outline" size="sm" kinds={["json"]} />
      </div>
    </div>
      {/* The same document in its three forms; the ticket is the one that used to hide in the dropdown. */}
      <DocumentForms code={shown.codigoGeneracion} estado={shown.estado} seal={"selloRecibido" in shown ? shown.selloRecibido ?? null : null} eager />
    </div>
  );
}
