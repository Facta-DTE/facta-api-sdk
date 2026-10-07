// Wire types of the handler contract (docs/react-signing-ui.md §5, simplified:
// the window never edits data, so the actions are only `session.describe`,
// `issue` and `status`).
//
// These are the shapes the implementer's server sends to the browser. They are
// a subset of the SDK's own types: the handler minimises what it returns, so
// every field beyond the summary is optional here.

import type { DeliveryChannelStatus, DeliveryChannel, DteType, Totals } from "../types.ts";
import type { FactaErrorCode } from "../errors.ts";

/** Codes the handler adds on top of `FactaErrorCode`. */
export type HandlerErrorCode =
  | "session_invalid"
  | "session_expired"
  | "action_not_allowed"
  | "unauthorized"
  | "bad_request";

export type WireErrorCode = FactaErrorCode | HandlerErrorCode;
export type Environment = "00" | "01";

export interface DraftLine {
  descripcion?: string;
  cantidad: number;
  precioUni?: number;
}

/** The receiver as the integrator's system drafted it. Shown, never edited. */
export interface DraftRecipient {
  nombre?: string;
  tipoDocumento?: string;
  numDocumento?: string;
  nrc?: string;
  correo?: string | null;
}

export interface SessionDraft {
  tipoDte: DteType;
  receptor?: DraftRecipient | null;
  items: DraftLine[];
  observaciones?: string | null;
}

/** Presentation hints from the implementer. Never fiscal data. */
export interface SessionDisplay {
  /** «Total de su pedido»: the implementer's own figure, shown as given. */
  total?: number;
  /** Their order number or similar. */
  reference?: string;
  /** A short subtitle, e.g. «Pedido #1042 · Café del Volcán». */
  title?: string;
}

export interface SessionInfo {
  draft: SessionDraft;
  /** `false` withholds PDF/JSON from the browser (default true). */
  download?: boolean;
  /** `"00"` for a test key, `"01"` for a live key, `null` when unknown. */
  environment: Environment | null;
  /** ISO-8601 instant. */
  expiresAt: string;
  display?: SessionDisplay;
}

/** Where the document's copies stand. Retried by the integrator's server. */
export interface StorageSummary {
  managed?: "stored" | "pending" | "failed" | "not_configured" | "unsupported" | null;
  archive?: "complete" | "partial" | "failed" | "off";
  copies?: { complete?: number; pending?: number; failed?: number };
}

/**
 * The summary the browser gets for a finished document. `sellado` carries the
 * seal and totals; `contingencia` carries `detalle`. Files are present only
 * when the session allows download.
 */
export interface IssueSummary {
  estado: "sellado" | "contingencia";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  fecEmi: string;
  horEmi?: string;
  selloRecibido?: string;
  fhProcesamiento?: string | null;
  observaciones?: string[];
  detalle?: string;
  totales?: Partial<Totals>;
  archivoJson?: string;
  /** The receiver's Archivo DTE (document + `firmaElectronica` + `selloRecibido`); sealed documents only. */
  archivoDte?: string;
  /** Base64 PDF. */
  representacionGrafica?: string | null;
  /** Top-level sibling of `result` on the wire; the client merges it in. */
  storage?: StorageSummary;
  /**
   * Present only when the server's emergency safeguard ran for this document: whether the
   * integrator's emergency store took it. Never carries a path or a file.
   */
  emergency?: { saved: boolean; reason: string; critical?: boolean };
  /** Lets the window ask `status` about this document. Added by the client. */
  statusToken?: string;
  /** Opaque, session-bound handle for `delivery.status`. Added by the client, consumed by the flow. */
  deliveryHandle?: string;
  /** The delivery rows to show; present only when the integrator's server marked channels. */
  delivery?: DeliveryView;
}

/**
 * Delivery state as the browser sees it: per marked channel, the state, the
 * MASKED destination and a reason code. Never the Facta token or an address.
 * `settled` and `timedOut` are added by the flow, not by the server.
 */
export interface DeliveryView {
  canales: Partial<Record<DeliveryChannel, DeliveryChannelStatus>>;
  /** Every channel reached a final state. */
  settled?: boolean;
  /** The flow stopped polling after its time budget; the state may still change. */
  timedOut?: boolean;
}

/** Alias used by the React surface and `useFactaWindow`. */
export type IssueResult = IssueSummary;

export interface SpentInfo {
  codigoGeneracion?: string;
  numeroControl?: string;
}

/** A field the API or Hacienda pointed at. */
export interface WireFieldIssue {
  path: string;
  message: string;
}

export interface WireError {
  code: WireErrorCode | (string & {});
  message: string;
  retryable: boolean;
  /** Absent: nothing was spent. Present: a control number was burned. */
  spent?: boolean | SpentInfo;
  observaciones?: string[];
  /** Present with `spent`: lets the window ask `status` about that document. */
  statusToken?: string;
  fields?: WireFieldIssue[];
}

export interface StatusSummary {
  estado: string;
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  fecEmi: string;
  horEmi?: string | null;
  selloRecibido?: string | null;
  observaciones?: string[];
  totales?: Partial<Totals>;
}

export type Action =
  | "session.describe"
  | "issue"
  | "status"
  | "delivery.status"
  | "documents.list"
  | "documents.get"
  | "documents.download"
  | "documents.copies"
  | "documents.retryStorage"
  | "documents.holding"
  | "catalog.customers.search"
  | "catalog.customers.get"
  | "catalog.products.search"
  | "catalog.products.get"
  | "service.status"
  | "storage.status"
  | "invalidate.describe"
  | "invalidate";

// --- Data components (docs/react-signing-ui.md §11) -----------------------------

export type DocumentEstado = "sellado" | "firmado" | "contingencia" | "invalidado" | (string & {});
export type DownloadKind = "pdf" | "json" | "ticket";

/** Filters of `documents.list`. `buscar` is applied in the browser over the loaded rows. */
export interface DocumentFilters {
  desde?: string | undefined;
  hasta?: string | undefined;
  estado?: "contingencia" | "firmado" | "invalidado" | "sellado" | undefined;
  tipoDte?: DteType | undefined;
  /** Substring of the control number, matched against the rows already loaded. */
  buscar?: string | undefined;
  /** `["dte"]`: rows also carry `resumen` (receiver and concept read from the legal document). Pages are 25 rows at most. */
  include?: Array<"dte"> | undefined;
}

/** What a row says about its document when the list was asked with `include: ["dte"]`. */
export interface DocumentResumenView {
  /** Present only when the handler has `exposeRecipient`; the number is masked like `receptor`. */
  receptor?: (DocumentRecipientView & { tipoDocumento: string | null }) | null;
  lineas: number;
  primeraDescripcion: string | null;
  totalIva: number | null;
  totalPagar: number | null;
}

export interface DocumentRecipientView {
  nombre: string | null;
  /** Masked: `0530 ••••• 5`. */
  numDocumento: string | null;
}

/** One row of the list. `receptor` is absent unless the handler has `exposeRecipient`. */
export interface DocumentRow {
  estado: DocumentEstado;
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  fecEmi: string;
  horEmi?: string | null;
  selloRecibido?: string | null;
  totales?: Partial<Totals> | null;
  receptor?: DocumentRecipientView | null;
  /** Only with `include: ["dte"]` on a row the handler could read. */
  resumen?: DocumentResumenView | null;
  /** Only with `include: ["dte"]` on a row that could not be read. */
  dteError?: { code: string; message: string };
}

export interface DocumentPage {
  documentos: DocumentRow[];
  siguiente: string | null;
}

export interface DocumentDetail extends DocumentRow {
  ambiente: string;
  observaciones?: string[];
}

export interface CopyRow {
  kind: "json" | "pdf";
  state: "stored" | "pending" | "failed";
  bytes: number;
  storedAt: string | null;
  environment: Environment;
}

export interface StorageRetryResult {
  json: string | null;
  pdf: string | null;
}

export interface HoldingRow {
  codigoGeneracion: string;
  ambiente: Environment;
  whereLanded: "holding" | "synced";
  gaveUp: boolean;
  attempts: number;
  expiresAt: string;
}

export interface DownloadedFile {
  codigoGeneracion: string;
  kind: DownloadKind;
  filename: string;
  contentType: string;
  bytes: number;
  /** The file, base64. */
  base64: string;
  /** JSON only: `archivo-dte` (the receiver's file) or `raw` (the stored original). */
  jsonFormat?: "archivo-dte" | "raw";
}

export interface CustomerOption {
  id: string;
  name: string | null;
  docType: string | null;
  docNumber: string | null;
  nrc: string | null;
}

export interface ProductOption {
  id: string;
  code: string | null;
  description: string | null;
  price: number | null;
  vatIncluded: boolean | null;
}

export type ServiceState = "online" | "contingency" | "degraded" | "offline";

export interface ServiceStatusView {
  state: ServiceState;
  checkedAt: string;
}

export interface StorageView {
  configured: boolean;
  ready: boolean;
  state: string;
  quotaBytes: number | null;
  usedBytes: number | null;
  reservedBytes: number | null;
  coveredUntil: string | null;
  byosReady: boolean;
}

export interface InvalidationPersonView {
  nombre: string;
  tipoDocumento: string;
  numDocumento: string;
}

/** What the invalidation dialog shows. Prepared by the host's server; never editable. */
export interface InvalidationInfo {
  invalidation: {
    codigoGeneracion: string;
    tipoAnulacion: 1 | 2 | 3;
    motivo: string | null;
    codigoGeneracionReemplazo: string | null;
    responsable: InvalidationPersonView;
    solicita: InvalidationPersonView;
  };
  /** Summary of the target, or null when it could not be read. */
  document: DocumentDetail | null;
  environment: Environment | null;
  expiresAt: string;
}

export interface InvalidationOutcome {
  estado: "invalidado";
  codigoGeneracion: string;
  numeroControl: string;
  yaEstabaInvalidado: boolean;
  evento?: {
    codigoGeneracion: string;
    selloRecibido: string;
    fhProcesamiento: string | null;
    tipoAnulacion: number;
  };
}
