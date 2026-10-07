// The workbench's rail: one entry per SDK component (or example), grouped as in the approved board.
// Each file shown comes from `shown-files.ts` (the file imported with `?raw` beside its repository path),
// so the code panel shows the file that runs and links to it on GitHub.

import { sourceFile, type SourceFile, type SourcePath } from "../../shown-files.ts";


export type GroupId = "emitir" | "despues" | "entrega" | "datos" | "mas";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "emitir", label: "Emitir" },
  { id: "despues", label: "Después de emitir" },
  { id: "entrega", label: "Entrega" },
  { id: "datos", label: "Datos" },
  { id: "mas", label: "Más" },
];

export interface WorkbenchItem {
  id: string;
  /** What the rail and the title say (an SDK export, or a plain name). */
  title: string;
  group: GroupId;
  /** True when the component is a window: the run-mode control applies. */
  window: boolean;
  /** True when «La venta» is needed to see the component. */
  needsSale: boolean;
  /** The executed example file. */
  source: SourceFile;
  /** The server file that applies, shown in the «server.ts» tab. */
  server: SourceFile;
  /** Longer title and one-line lead for the head of the page (defaults to the title). */
  heading?: string;
  lead?: string;
  /** Show the live part in a card instead of the dashed stage. */
  panel?: boolean;
  /** More tabs after «server.ts» (e.g. the server-only recipe). */
  extra?: { id: string; label: string; file: SourceFile; note: string }[];
  /** What the server tab is about, in one line. */
  serverNote: string;
}

const KEY_TAB = { id: "llave", label: "Llave", file: sourceFile("playground/server/order-key.ts"), note: "La llave de idempotencia que viaja en la sesión: su número de pedido, atado al visitante" };
const SALE = {
  server: sourceFile("playground/server/sale.ts"),
  serverNote: "El servidor valida la descripción de la venta y arma la solicitud fiscal; el navegador nunca escribe el documento.",
  extra: [KEY_TAB],
};
const HANDLER = { server: sourceFile("playground/server/router.ts"), serverNote: "El servidor guarda la llave y atiende las rutas que usan estos componentes." };

export const ITEMS: WorkbenchItem[] = [
  { id: "dialog", title: "FactaInvoiceDialog", group: "emitir", window: true, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/dialog.tsx"), ...SALE },
  { id: "drawer", title: "FactaInvoiceDrawer", group: "emitir", window: true, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/drawer.tsx"), ...SALE },
  { id: "inline", title: "FactaInvoiceInline", group: "emitir", window: true, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/inline.tsx"), ...SALE },
  { id: "button", title: "FactaIssueButton", group: "emitir", window: true, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/issue-button.tsx"), ...SALE },
  { id: "window", title: "useFactaWindow", group: "emitir", window: true, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/window-hook.tsx"), ...SALE },
  { id: "receipt", title: "FactaReceipt", group: "despues", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/receipt.tsx"), ...HANDLER },
  { id: "badge", title: "FactaStatusBadge", group: "despues", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/receipt.tsx"), ...HANDLER },
  { id: "download", title: "FactaDownloadButton", group: "despues", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/receipt.tsx"), ...HANDLER },
  {
    id: "delivery", title: "Correo y WhatsApp", group: "entrega", window: false, needsSale: false, panel: true,
    heading: "Entregar el documento al cliente",
    lead: "Su servidor marca los canales al crear la sesión. Apenas Hacienda sella, Facta DTE envía el JSON y el PDF; la ventana muestra cada canal en vivo y nunca espera a que termine para cerrar.",
    source: sourceFile("playground/site/sections/screens/examples/delivery.tsx"),
    server: sourceFile("playground/server/delivery.ts"),
    serverNote: "Su servidor marca los canales con createFactaSession({ deliver }); viajan firmados dentro del token y el cliente solo los sigue con onDelivery. Aquí solo se marca el correo y se aplican los límites",
    extra: [KEY_TAB, { id: "solo", label: "Solo servidor", file: sourceFile("playground/server/recipes/deliver-email.ts"), note: "Sin navegador, en dos llamadas: issue devuelve el token de entrega y deliverEmail lo usa (cinco minutos) · la receta 8 de «Solo servidor»" }],
  },
  { id: "list", title: "FactaDocumentList", group: "datos", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/document-list.tsx"), ...HANDLER },
  { id: "detail", title: "FactaDocumentDetail", group: "datos", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/document-detail.tsx"), ...HANDLER },
  { id: "pickers", title: "Selectores de catálogo", group: "datos", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/pickers.tsx"), ...HANDLER },
  { id: "status", title: "FactaServiceStatus", group: "datos", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/service-status.tsx"), ...HANDLER },
  { id: "invalidate", title: "Anular un documento", group: "mas", window: false, needsSale: false, source: sourceFile("playground/site/sections/screens/examples/invalidate.tsx"), ...HANDLER },
  { id: "studio", title: "Estudio de apariencia", group: "mas", window: false, needsSale: true, source: sourceFile("playground/site/sections/screens/examples/appearance-studio.tsx"), ...SALE },
];

export const itemOf = (id: string | null): WorkbenchItem => ITEMS.find((item) => item.id === id) ?? ITEMS[0]!;
