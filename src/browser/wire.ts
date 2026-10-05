// Wire types of the handler contract (docs/react-signing-ui.md §5, simplified:
// the window never edits data, so the actions are only `session.describe`,
// `issue` and `status`).
//
// These are the shapes the implementer's server sends to the browser. They are
// a subset of the SDK's own types: the handler minimises what it returns, so
// every field beyond the summary is optional here.

import type { DteType, Totals } from "../types.ts";
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
  /** `download: false` withholds PDF/JSON from the browser. */
  allow?: { download?: boolean };
  environment: Environment;
  /** ISO-8601 instant. */
  expiresAt: string;
  display?: SessionDisplay;
  /** When the handler can tell it up front, the status fallback uses it. */
  codigoGeneracion?: string;
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
  /** Base64 PDF. */
  representacionGrafica?: string | null;
  storage?: StorageSummary;
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
  /** `false`/absent: nothing was spent. Truthy: a control number was burned. */
  spent?: boolean | SpentInfo;
  observaciones?: string[];
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

export type Action = "session.describe" | "issue" | "status";
