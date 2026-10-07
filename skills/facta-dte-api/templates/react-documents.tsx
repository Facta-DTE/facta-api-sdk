// React documents screen: the account's documents with download buttons, a detail drawer, and the status
// of the service. Needs the handler of express-server.ts / nextjs-route.ts to DECLARE what the browser may
// read, otherwise every read answers 403 `action_not_allowed`:
//
//   createFactaHandler({ ..., capabilities: { documents: "read", downloads: ["pdf", "json", "ticket"],
//                        status: true, invalidate: "session" } })
//
// Adapted from playground/site/sections/screens/examples/{document-list,document-detail,receipt,
// service-status}.tsx. The playground-only pieces (Turnstile, its demo session endpoint, the registry
// helper) are removed; `requestInvalidationToken` below is YOUR server's endpoint that calls
// `createFactaInvalidationSession` after checking who may cancel what. UI copy is Spanish (es-SV, usted).
import { useState } from "react";
import {
  FactaDocumentDetail,
  FactaDocumentList,
  FactaDownloadButton,
  FactaProvider,
  FactaServiceStatus,
  useFactaActions,
} from "@facta-dte/api/react";
import "@facta-dte/api/react/styles.css";

/** TODO: your endpoint. It must check the user's right to cancel and answer with the invalidation session token. */
async function requestInvalidationToken(codigoGeneracion: string): Promise<string> {
  const response = await fetch("/api/invalidation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codigoGeneracion }),
  });
  if (!response.ok) throw new Error("No se pudo preparar la anulación.");
  return await response.text();
}

function DocumentsScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [version, setVersion] = useState(0); // bump to remount the list after an invalidation
  const actions = useFactaActions();

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 1040, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1>Documentos emitidos</h1>
        <FactaServiceStatus /> {/* «Hacienda en línea», contingencia… (public, polls every 60 s) */}
      </header>

      <FactaDocumentList
        key={version}
        title="Documentos de la cuenta"
        pageSize={25}
        downloads={["pdf", "json", "ticket"]}            // row menu; pass [] to hide downloads
        detail={false}                                    // we open our own drawer below
        onOpen={(row) => { setSelected(row.codigoGeneracion); setDrawer(true); }}
        onInvalidate={(row) => requestInvalidationToken(row.codigoGeneracion)} // «Anular» appears only with this
        onInvalidated={() => setVersion((v) => v + 1)}
      />

      <FactaDocumentDetail
        codigoGeneracion={selected}
        open={drawer}
        onOpenChange={setDrawer}
        kinds={["pdf", "json", "ticket"]}
        onInvalidate={(doc) => requestInvalidationToken(doc.codigoGeneracion)}
        onInvalidated={() => setVersion((v) => v + 1)}
      />

      {selected !== null && (
        <section aria-label="Descargas del documento elegido" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* One split button: the first kind is the main action. The Archivo DTE is «json»; rawJson adds the stored original. */}
          <FactaDownloadButton codigoGeneracion={selected} kinds={["pdf", "json", "ticket"]} paperWidthMm={80} />
          <FactaDownloadButton codigoGeneracion={selected} variant="outline" size="sm" kinds={["json"]} rawJson /> {/* needs capabilities.rawJson: true on the server */}
          <button type="button" onClick={() => void actions.copyCode(selected)}>Copiar código de generación</button>
        </section>
      )}
    </main>
  );
}

export function DocumentsPage() {
  return (
    <FactaProvider endpoint="/api/facta">
      <DocumentsScreen />
    </FactaProvider>
  );
}
