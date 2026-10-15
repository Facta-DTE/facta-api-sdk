import { FactaDocumentList } from "../../../../../react.ts";
import { requestInvalidation } from "../../../api.ts";

// The documents table (cards on a phone) with filters, downloads and the detail drawer.
// «Anular» asks YOUR server for an invalidation session; the playground's server only
// seals one for documents this visitor issued here, so other rows answer with its message.
export function DocumentListExample({ onInvalidated }: { onInvalidated: () => void }) {
  return (
    <div style={{ width: "100%" }}>
      <FactaDocumentList
        title="Documentos de la cuenta de pruebas"
        pageSize={10}
        onInvalidate={(row) => requestInvalidation(row.codigoGeneracion)}
        onInvalidated={onInvalidated}
      />
    </div>
  );
}
