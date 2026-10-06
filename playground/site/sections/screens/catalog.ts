// The workbench's rail: one entry per SDK component (or example), grouped as in the approved board.
// `source` is the example's own file imported with `?raw`, so the code panel shows the file that runs.

import appearanceSource from "./examples/appearance-studio.tsx?raw";
import dialogSource from "./examples/dialog.tsx?raw";
import documentDetailSource from "./examples/document-detail.tsx?raw";
import documentListSource from "./examples/document-list.tsx?raw";
import drawerSource from "./examples/drawer.tsx?raw";
import inlineSource from "./examples/inline.tsx?raw";
import invalidateSource from "./examples/invalidate.tsx?raw";
import issueButtonSource from "./examples/issue-button.tsx?raw";
import pickersSource from "./examples/pickers.tsx?raw";
import receiptSource from "./examples/receipt.tsx?raw";
import serviceStatusSource from "./examples/service-status.tsx?raw";
import windowHookSource from "./examples/window-hook.tsx?raw";
import routerSource from "../../../server/router.ts?raw";
import saleSource from "../../../server/sale.ts?raw";

export type GroupId = "emitir" | "despues" | "datos" | "mas";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "emitir", label: "Emitir" },
  { id: "despues", label: "Después de emitir" },
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
  source: string;
  sourceName: string;
  /** The server file that applies, shown in the «server.ts» tab. */
  server: string;
  serverName: string;
  /** What the server tab is about, in one line. */
  serverNote: string;
}

const SALE = { server: saleSource, serverName: "server/sale.ts", serverNote: "El servidor valida la descripción de la venta y arma la solicitud fiscal; el navegador nunca escribe el documento." };
const HANDLER = { server: routerSource, serverName: "server/router.ts", serverNote: "El servidor guarda la llave y atiende las rutas que usan estos componentes." };

export const ITEMS: WorkbenchItem[] = [
  { id: "dialog", title: "FactaInvoiceDialog", group: "emitir", window: true, needsSale: true, source: dialogSource, sourceName: "examples/dialog.tsx", ...SALE },
  { id: "drawer", title: "FactaInvoiceDrawer", group: "emitir", window: true, needsSale: true, source: drawerSource, sourceName: "examples/drawer.tsx", ...SALE },
  { id: "inline", title: "FactaInvoiceInline", group: "emitir", window: true, needsSale: true, source: inlineSource, sourceName: "examples/inline.tsx", ...SALE },
  { id: "button", title: "FactaIssueButton", group: "emitir", window: true, needsSale: true, source: issueButtonSource, sourceName: "examples/issue-button.tsx", ...SALE },
  { id: "window", title: "useFactaWindow", group: "emitir", window: true, needsSale: true, source: windowHookSource, sourceName: "examples/window-hook.tsx", ...SALE },
  { id: "receipt", title: "FactaReceipt", group: "despues", window: false, needsSale: false, source: receiptSource, sourceName: "examples/receipt.tsx", ...HANDLER },
  { id: "badge", title: "FactaStatusBadge", group: "despues", window: false, needsSale: false, source: receiptSource, sourceName: "examples/receipt.tsx", ...HANDLER },
  { id: "download", title: "FactaDownloadButton", group: "despues", window: false, needsSale: false, source: receiptSource, sourceName: "examples/receipt.tsx", ...HANDLER },
  { id: "list", title: "FactaDocumentList", group: "datos", window: false, needsSale: false, source: documentListSource, sourceName: "examples/document-list.tsx", ...HANDLER },
  { id: "detail", title: "FactaDocumentDetail", group: "datos", window: false, needsSale: false, source: documentDetailSource, sourceName: "examples/document-detail.tsx", ...HANDLER },
  { id: "pickers", title: "Selectores de catálogo", group: "datos", window: false, needsSale: false, source: pickersSource, sourceName: "examples/pickers.tsx", ...HANDLER },
  { id: "status", title: "FactaServiceStatus", group: "datos", window: false, needsSale: false, source: serviceStatusSource, sourceName: "examples/service-status.tsx", ...HANDLER },
  { id: "invalidate", title: "Anular un documento", group: "mas", window: false, needsSale: false, source: invalidateSource, sourceName: "examples/invalidate.tsx", ...HANDLER },
  { id: "studio", title: "Estudio de apariencia", group: "mas", window: false, needsSale: true, source: appearanceSource, sourceName: "examples/appearance-studio.tsx", ...SALE },
];

export const itemOf = (id: string | null): WorkbenchItem => ITEMS.find((item) => item.id === id) ?? ITEMS[0]!;
