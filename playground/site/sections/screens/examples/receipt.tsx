import { FactaDownloadButton, FactaReceipt, FactaStatusBadge, type IssueResult } from "../../../../../react.ts";

// After issuing: the compact receipt (it renders a result you already hold, with no
// network call), the status badge, and download buttons that ask the server for PDF,
// JSON or the 80 mm ticket. The «Entrega» row appears when the sale asked for e-mail.
export function ReceiptExample({ result }: { result: IssueResult | null }) {
  if (result === null) {
    return <p className="pg-note">Emita una factura con cualquiera de los ejemplos de arriba y aparecerá aquí.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 16, width: "100%", maxWidth: 520 }}>
      <FactaReceipt result={result} environment="00" reference="Playground" />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <FactaStatusBadge estado={result.estado} />
        <FactaDownloadButton codigoGeneracion={result.codigoGeneracion} kinds={["pdf", "json", "ticket"]} />
        <FactaDownloadButton codigoGeneracion={result.codigoGeneracion} variant="outline" size="sm" kinds={["json"]} />
      </div>
    </div>
  );
}
