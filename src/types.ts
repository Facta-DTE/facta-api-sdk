// The wire types, transcribed from openapi.yaml.
//
// Deliberately thin. Everything here is a shape the server owns; the SDK's job
// is to carry it, not to interpret it. Note what is NOT in this file: no VAT
// rate, no rounding rule, no control-number format, no catalog. Those live in
// `dte-core`, on the server, and a second copy of them here would be a second
// fiscal engine (`docs/plan/tareas/sdks-de-la-api.md` §5).

export interface Address {
  departamento: string;
  municipio: string;
  distrito?: string;
  complemento: string;
}

export interface Recipient {
  /** A customer already stored in Facta. Combines with the fields below:
   * whatever is spelled out wins over what is stored. */
  customerId?: string;
  nombre?: string;
  tipoDocumento?: string;
  numDocumento?: string;
  nrc?: string;
  codActividad?: string;
  descActividad?: string;
  direccion?: Address;
  telefono?: string | null;
  correo?: string;
  nombreComercial?: string | null;
}

/** Foreign recipient used only by an export invoice (11). */
export interface ExportRecipient {
  nombre: string;
  tipoDocumento?: string;
  numDocumento: string;
  codPais: string;
  nombrePais: string;
  complemento: string;
  tipoPersona: 1 | 2;
  descActividad: string;
  correo: string;
  telefono?: string | null;
  nombreComercial?: string | null;
}

/** Recipient used only by an excluded-subject invoice (14). */
export interface ExcludedSubjectRecipient {
  numDocumento: string;
  nombre: string;
  direccion: Address;
  tipoDocumento?: string;
  codActividad?: string | null;
  telefono?: string | null;
  correo?: string | null;
}

export interface LineItem {
  /** Optional when productId resolves this field (locally, or on the server for a readable-catalog key). */
  descripcion?: string;
  cantidad: number;
  /** FE (01): VAT INCLUDED. CCF (03): VAT EXCLUDED. The official schemas
   * differ and the server does not guess. */
  /** Optional when productId resolves this field (locally, or on the server for a readable-catalog key). */
  precioUni?: number;
  /** Facta catalog product reference. Resolved on the server for a key with a readable catalog, otherwise locally by the SDK. */
  productId?: string;
  /** 05/06: target document number when the note corrects multiple documents. */
  numeroDocumento?: string;
  codigo?: string | null;
  tipoItem?: 1 | 2 | 3 | 4;
  uniMedida?: number;
  /**
   * Discount of THIS line, in money (not a percentage), in the same VAT basis as `precioUni`.
   * Between 0 and `cantidad × precioUni`, otherwise `400`. The exact spelling matters: `descuento`,
   * `discount` or `descu` do not exist and come back as a `campo_desconocido` warning that suggests
   * `montoDescu`. There is no global discount on the wire yet.
   */
  montoDescu?: number;
  /**
   * How this line treats VAT: `gravada` (the default, 13 %), `exenta` (`ventaExenta` column) or `no_sujeta`
   * (`ventaNoSuj` column). Chosen by you, never deduced by Facta. Valid in 01, 03, 05 and 06; on 11 and 14 the
   * server refuses it (`422 validation_failed`) even when it says `gravada`, so leave it out there. In a note
   * use the class the corrected line had. With `productId` the product's class does not reach the API yet:
   * send `tipoVenta` on the line. `aplicarReteRenta` next to an `exenta` or `no_sujeta` line is
   * `422 retention_mixed_class_unsupported`.
   */
  tipoVenta?: SaleType;
}

/** One row of `pagos[]`: a payment method and the amount paid with it. */
export interface Pago {
  /** Payment-method code of the Ministry's catalogue (e.g. "01"); the server checks it (`422 validation_failed`, `details.supported`). */
  codigo: string;
  /** Paid with this method, at most two decimals, greater than zero. */
  montoPago: number;
  /** Voucher, cheque number, etc. (at most 50 characters). */
  referencia?: string | null;
}

/** A server warning in the sealed response (`advertencias`). Only the fields of its code are present. */
export interface ServerWarning {
  codigo?: string;
  code?: string;
  mensaje?: string;
  detalle?: string;
  /** `campo_desconocido`: exact path of the ignored field (`items[2].descuento`). `plantilla_no_aplicada`: the template field. */
  campo?: string;
  /** `campo_desconocido` only: the field the caller probably meant (`items[2].montoDescu`). */
  sugerencia?: string;
  /** `plantilla_no_aplicada` only: `plan`, `no_existe` or `incompatible`. */
  motivo?: string;
  [field: string]: unknown;
}

/** A request field Facta DTE does not know: it was ignored and is NOT part of the document. */
export interface UnknownFieldWarning {
  codigo: "campo_desconocido";
  campo: string;
  mensaje: string;
  sugerencia?: string;
}

/** The parsed `Facta-Warning` response header (`campo_desconocido; campos=2`). */
export interface FactaWarningHeader {
  code: string;
  /** The `campos=N` parameter, when the header carries it. */
  count: number | null;
}

export type DteType = "01" | "03" | "05" | "06" | "11" | "14";

export type RelatedDocument =
  /** The API can resolve this short form for a document in the same company. */
  | { codigoGeneracion: string; tipoDocumento?: never; numeroDocumento?: never; fechaEmision?: never; tipoGeneracion?: never }
  /** Full reference for a document not present in the company's Facta index. */
  | { codigoGeneracion?: never; tipoDocumento: string; numeroDocumento: string; fechaEmision: string; tipoGeneracion?: 1 | 2 };

export interface ExportDetails {
  tipoItemExpor: 1 | 2 | 3;
  incoterms?: string | null;
  /** Customs-precinct code; a code outside the catalogue is `422 validation_failed`. */
  recintoFiscal?: string | null;
  /** Regime type code (`EX-1`, `EX-2`, `EX-3`, `TA-1`); checked like `recintoFiscal`. */
  tipoRegimen?: string | null;
  /** Regime code, or the composite `<type>.<regime>`; checked like `recintoFiscal`. */
  regimen?: string | null;
  flete?: number;
  seguro?: number;
}

interface DteRequestBase {
  items: LineItem[];
  condicionOperacion?: 1 | 2 | 3;
  plazo?: "01" | "02" | "03" | null;
  periodo?: number | null;
  /** Payment-method code. A code outside the catalogue is `422 validation_failed` (`details.field`, `details.supported`). Not combined with `pagos`. */
  formaPago?: string;
  /**
   * Several payment methods for one document (01, 03, 11, 14): 1 to 10 rows whose `montoPago` add up to the
   * total to pay, to the cent. Refused (`400`) together with `formaPago` and on 05/06; refused (`422`) with
   * `condicionOperacion` 2 (credit).
   */
  pagos?: Pago[];
  observaciones?: string | null;
}

/** Own fields of other types: the server answers `400` (not a silent ignore) when a type receives them. */
interface VatOwnFieldsNever {
  aplicarRetencionIva?: never;
  aplicarPercepcionIva?: never;
}

/** 01 and 03: the 1 % VAT withholding the RECEIVER practises (art. 162 CT) on the taxable net after discounts. Never automatic: you ask for it. */
interface VatWithholdingField {
  aplicarRetencionIva?: boolean;
}

/** DTE request union. DTE-specific fields are available only on their type. */
export type DteRequest =
  | (DteRequestBase & VatWithholdingField & { aplicarPercepcionIva?: never; tipoDte: "01"; receptor?: Recipient | null; documentosRelacionados?: never; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & VatWithholdingField & {
    tipoDte: "03"; receptor?: Recipient | null; documentosRelacionados?: never; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never;
    /**
     * Only 03. The 1 % VAT perception (art. 163 CT) on the taxable net of the GOODS lines (`tipoItem` 1) after
     * the proportional share of any global discount; services are not in the base. Added to the total to pay,
     * not part of `montoTotalOperacion`. Never automatic: you ask for it.
     */
    aplicarPercepcionIva?: boolean;
  })
  | (Omit<DteRequestBase, "pagos"> & VatOwnFieldsNever & { pagos?: never; tipoDte: "05"; receptor?: Recipient | null; documentosRelacionados: RelatedDocument[]; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (Omit<DteRequestBase, "pagos"> & VatOwnFieldsNever & { pagos?: never; tipoDte: "06"; receptor?: Recipient | null; documentosRelacionados: RelatedDocument[]; numPagoElectronico?: string | null; exportacion?: never; aplicarReteRenta?: never })
  | (DteRequestBase & VatOwnFieldsNever & { tipoDte: "11"; receptor: ExportRecipient; exportacion: ExportDetails; documentosRelacionados?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & VatOwnFieldsNever & { tipoDte: "14"; receptor: ExcludedSubjectRecipient; aplicarReteRenta?: boolean; documentosRelacionados?: never; exportacion?: never; numPagoElectronico?: never });

/** How the key's company stores the catalog the API can see. */
export type CatalogMode = "encrypted" | "readable" | "plain";

export interface CatalogReadOptions {
  /** @deprecated No effect since 0.6: catalogue reads are always live (there is no local snapshot). */
  allowStale?: boolean;
  /** Include deactivated records (`active: false`). Default false. */
  includeInactive?: boolean;
  /** Abort the read (only used when the catalog is read through the API). */
  signal?: AbortSignal;
}

/** Options of a catalog write. */
export interface CatalogWriteOptions {
  /** Create only: reuse the same key to make a retried create safe. One is minted when omitted. */
  idempotencyKey?: string;
  /**
   * Update only: apply the change only if the record is still at this revision (the `revision` you read).
   * Otherwise `FactaError` `catalog_revision_conflict` (409) with `details.revisionActual`. Honoured by a
   * company that shares its data key; a plain-catalogue company ignores it (last write wins per field).
   */
  ifMatch?: number | string;
  signal?: AbortSignal;
}

/**
 * Fields of a customer you can create or change, with the names the public API uses.
 * Numbers may be typed with dashes; the SDK sends digits only. The stored spellings
 * (`name`, `doc_type`, `doc_number`, `activity_code`, `address`, `phone`, `email`)
 * are still accepted and translated; do not mix both for the same field.
 */
export interface CustomerInput {
  /** Required on create. */
  nombre?: string;
  /** Document type code: `36` NIT, `13` DUI, `37` other, `03` passport, `02` residence card. */
  tipoDocumento?: string | null;
  /** DUI: 9 digits. NIT: 14 digits. */
  numDocumento?: string | null;
  /** 1 to 8 digits. */
  nrc?: string | null;
  /** Economic activity code. */
  codActividad?: string | null;
  /** Department, municipality and district codes, plus the free-text line. */
  direccion?: Address | null;
  telefono?: string | null;
  correo?: string | null;
  /** Update only: `true` reactivates a deactivated customer (`deactivateCustomer` sets it false). */
  activo?: boolean;
  /** @deprecated Use `nombre`. */
  name?: string;
  /** @deprecated Use `tipoDocumento`. */
  doc_type?: string | null;
  /** @deprecated Use `numDocumento`. */
  doc_number?: string | null;
  /** @deprecated Use `codActividad`. */
  activity_code?: string | null;
  /** @deprecated Use `direccion`. */
  address?: Address | null;
  /** @deprecated Use `telefono`. */
  phone?: string | null;
  /** @deprecated Use `correo`. */
  email?: string | null;
}

/** VAT treatment of a product, spelled like `items[].tipoVenta`. */
export type SaleType = "gravada" | "exenta" | "no_sujeta";

/**
 * Fields of a product you can create or change, with the names the public API uses
 * (the same as an issuing line). The stored spellings (`description`, `item_type`,
 * `unit_price`, `unit_of_measure`, `code`, `barcode`, `vat_included`) are still accepted.
 */
export interface ProductInput {
  /** Required on create. */
  descripcion?: string;
  /** Required on create: `1` good, `2` service, `3` both. Never defaulted. */
  tipoItem?: 1 | 2 | 3;
  /** Required on create. Greater than zero. */
  precioUni?: number;
  /** Unit-of-measure code; the server uses 59 (unidad) when omitted. */
  uniMedida?: number;
  codigo?: string | null;
  codigoBarras?: string | null;
  /** Whether `precioUni` already includes VAT. Defaults to true. */
  ivaIncluido?: boolean;
  /** VAT treatment: taxed (default), exempt or non-subject. Chosen, never inferred. */
  tipoVenta?: SaleType;
  /** Update only: `true` reactivates a deactivated product (`deactivateProduct` sets it false). */
  activo?: boolean;
  /** @deprecated Use `descripcion`. */
  description?: string;
  /** @deprecated Use `tipoItem`. */
  item_type?: 1 | 2 | 3;
  /** @deprecated Use `precioUni`. */
  unit_price?: number;
  /** @deprecated Use `uniMedida`. */
  unit_of_measure?: number;
  /** @deprecated Use `codigo`. */
  code?: string | null;
  /** @deprecated Use `codigoBarras`. */
  barcode?: string | null;
  /** @deprecated Use `ivaIncluido`. */
  vat_included?: boolean;
}

/**
 * A customer, as the API returns it (Ministry names) and as the stored record holds it
 * (stored names). Every record the SDK returns carries both spellings, so code written
 * against either keeps working in every catalog mode.
 */
export interface CatalogCustomer {
  id: string;
  nombre?: string | null;
  tipoDocumento?: string | null;
  numDocumento?: string | null;
  nrc?: string | null;
  codActividad?: string | null;
  direccion?: Address | null;
  telefono?: string | null;
  correo?: string | null;
  /** false once deactivated. */
  activo?: boolean;
  creadoEn?: string | null;
  actualizadoEn?: string | null;
  name?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  activity_code?: string | null;
  address?: Address | null;
  phone?: string | null;
  email?: string | null;
  active?: boolean;
  /** The record's catalogue revision, on single reads and writes of a company that shares its data key. Pass it as `ifMatch`. */
  revision?: number;
  [field: string]: unknown;
}

/** A product, with both spellings like `CatalogCustomer`. */
export interface CatalogProduct {
  id: string;
  codigo?: string | null;
  codigoBarras?: string | null;
  descripcion?: string | null;
  tipoItem?: number | null;
  uniMedida?: number | null;
  precioUni?: number | null;
  ivaIncluido?: boolean | null;
  /** VAT treatment; a product that never chose one reads as `gravada`. */
  tipoVenta?: SaleType;
  /** The same treatment as `tipoVenta`, spelled as Facta stores it: `gravada`, `exenta` or `noSuj`. */
  sale_class?: "gravada" | "exenta" | "noSuj";
  activo?: boolean;
  actualizadoEn?: string | null;
  code?: string | null;
  barcode?: string | null;
  description?: string | null;
  item_type?: string | number | null;
  unit_of_measure?: string | number | null;
  unit_price?: number | null;
  vat_included?: boolean | null;
  active?: boolean;
  /** See `CatalogCustomer.revision`. */
  revision?: number;
  [field: string]: unknown;
}

export interface CatalogSearchOptions extends CatalogReadOptions {
  /** Maximum number of matches. Defaults to 50; valid range is 1–500. */
  limit?: number;
}

/** Computed by the server. Read them; never recompute them. */
export interface Totals {
  totalNoSuj: number;
  totalExenta: number;
  totalGravada: number;
  totalDescu: number;
  totalIva: number;
  montoTotalOperacion: number;
  totalPagar: number;
  totalLetras: string;
}

// --- Debug timings (a debugging aid, off by default) ----------------------------

/** One measured step of the API's processing. */
export interface DebugTiming {
  step: string;
  /** Duration of the step, milliseconds. */
  ms: number;
  /** Milliseconds from the start of the request to the start of the step. Absent when only `Server-Timing` was available. */
  startedAtMs?: number;
}

/**
 * Per-step processing times the API returns when the request carries
 * `X-Facta-Debug: timings` (client option `debug: { timings: true }`). Never present otherwise.
 * `source` says where the SDK read it from: the response body or the `Server-Timing` header.
 */
export interface DebugInfo {
  timings: DebugTiming[];
  totalMs: number;
  source?: "body" | "server-timing";
}

export interface SealedDte {
  estado: "sellado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  fecEmi: string;
  horEmi: string;
  selloRecibido: string;
  fhProcesamiento: string | null;
  observaciones: string[];
  totales: Totals;
  documento: Record<string, unknown>;
  /** Archive THIS. Re-serializing `documento` does not reproduce the bytes
   * whose signature Hacienda validated. */
  jws: string;
  /** Exact server-generated JSON archive contents; persist this verbatim. */
  archivoJson?: string;
  /**
   * The Archivo DTE for the receiver: the document plus `firmaElectronica` and
   * `selloRecibido`, as exact UTF-8 text. Absent on API servers that predate it
   * and in contingency; `archivoDteOf(result)` builds it from `documento`,
   * `jws` and `selloRecibido` when the field is missing.
   */
  archivoDte?: string;
  /** Server-rendered PDF as base64, present after a successful seal. */
  representacionGrafica?: string | null;
  /** Facta-managed durable copies; absent on older API servers. */
  storage?: ManagedStorageReceipt;
  /** Fiscal success is preserved when an attached storage receipt is malformed. */
  storageErrorCode?: "storage_contract_invalid";
  /** Present only when the request marked delivery channels (`deliver`). Carries the delivery token. */
  entrega?: DeliveryOffer;
  /** Only with `debug: { timings: true }`. */
  debug?: DebugInfo;
  /** Server warnings (e.g. `sin_almacenamiento_duradero`); the emergency safeguard reads them. */
  advertencias?: Array<string | ServerWarning>;
  /** The `campo_desconocido` warnings of `advertencias`, ready to read. Present only when the request carried a field Facta DTE does not know. */
  unknownFields?: UnknownFieldWarning[];
  /** The `Facta-Warning` response header, parsed. Present only when the server sent it. */
  factaWarning?: FactaWarningHeader;
  /** Present only when the emergency safeguard ran. */
  emergency?: import("./emergency.ts").EmergencyReport;
  /** SDK-side notices; `emergency_saved` / `emergency_failed`. */
  sdkWarnings?: Array<{ code: "emergency_saved" | "emergency_failed"; detail: string }>;
}

export interface DteInContingency {
  estado: "contingencia";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  fecEmi: string;
  horEmi: string;
  detalle: string;
  documento: Record<string, unknown>;
  jws: string;
  /** Exact server-generated JSON archive contents; persist this verbatim. */
  archivoJson?: string;
  /** Storage is not committed until Hacienda returns a seal. */
  storage?: ManagedStorageReceipt;
  /** Fiscal success is preserved when an attached storage receipt is malformed. */
  storageErrorCode?: "storage_contract_invalid";
  /** Channels are `esperando_sello` and there is NO token: delivery after contingency is not offered yet. */
  entrega?: DeliveryOffer;
  /** Only with `debug: { timings: true }`. */
  debug?: DebugInfo;
  /** Server warnings (e.g. `sin_almacenamiento_duradero`); the emergency safeguard reads them. */
  advertencias?: Array<string | ServerWarning>;
  /** The `campo_desconocido` warnings of `advertencias`, ready to read. Present only when the request carried a field Facta DTE does not know. */
  unknownFields?: UnknownFieldWarning[];
  /** The `Facta-Warning` response header, parsed. Present only when the server sent it. */
  factaWarning?: FactaWarningHeader;
  /** Present only when the emergency safeguard ran. */
  emergency?: import("./emergency.ts").EmergencyReport;
  /** SDK-side notices; `emergency_saved` / `emergency_failed`. */
  sdkWarnings?: Array<{ code: "emergency_saved" | "emergency_failed"; detail: string }>;
}

export type IssueResult = SealedDte | DteInContingency;

export type ManagedStorageArtifactState = "stored" | "pending" | "failed" | "not_configured" | "unsupported";

export interface ManagedStorageArtifactReceipt {
  state: ManagedStorageArtifactState;
  sha256: string | null;
  bytes: number | null;
  storedAt: string | null;
  errorCode: string | null;
  retryable: boolean;
}

export interface ManagedStorageReceipt {
  destination: "managed" | "none";
  environment: "00" | "01";
  json: ManagedStorageArtifactReceipt;
  pdf: ManagedStorageArtifactReceipt;
  operationId: string;
}

export interface ManagedStorageStatus {
  capabilityVersion: 1;
  managed: {
    configured: boolean;
    ready: boolean;
    state: string;
    integration: "ready" | "unavailable";
    quotaBytes: number | null;
    usedBytes: number | null;
    reservedBytes: number | null;
    usedBytesTotal: number | null;
    reservedBytesTotal: number | null;
    coveredUntil: string | null;
    accessUntil: string | null;
    bucketState: string | null;
    backupState: string | null;
  };
  byos: { ready: boolean };
  /** Always names `json` and `pdf`; newer servers add kinds (today `invalidation`). */
  supportedKinds: Array<"json" | "pdf" | "invalidation" | (string & {})>;
  unsupportedKinds: Array<"ticket" | "invalidation" | (string & {})>;
  /** Absent on servers that predate the capability. `byosCopyReport: 1` accepts BYOS copy reports. */
  capabilities?: { byosCopyReport?: number };
}

export interface ManagedDocumentCopy {
  generationCode: string;
  /** `invalidation`: the invalidation event file stored under the document's code. */
  kind: "json" | "pdf" | "invalidation";
  environment: "00" | "01";
  state: "stored" | "pending" | "failed";
  bytes: number;
  sha256: string;
  issuedDate: string;
  storedAt: string | null;
}

export interface ManagedDocumentCopies {
  capabilityVersion: 1;
  copies: ManagedDocumentCopy[];
}

export interface PreparedDte {
  estado: "preparado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  totales: Totals;
  documento: Record<string, unknown>;
  prepareToken: string;
  /** Only with `debug: { timings: true }`. */
  debug?: DebugInfo;
  /** Server warnings, e.g. `campo_desconocido`. Present only when there is something to review. */
  advertencias?: Array<string | ServerWarning>;
  /** The `campo_desconocido` warnings of `advertencias`. Present only when the request carried a field Facta DTE does not know. */
  unknownFields?: UnknownFieldWarning[];
  /** The `Facta-Warning` response header, parsed. Present only when the server sent it. */
  factaWarning?: FactaWarningHeader;
}

export interface DocumentStatus {
  estado:
    | "sellado"
    | "firmado"
    | "rechazado"
    | "contingencia"
    | "invalidado"
    | "reservado"
    | "liberado"
    | "descartado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  fecEmi: string;
  horEmi?: string | null;
  selloRecibido: string | null;
  observaciones?: string[];
  motivo?: unknown;
  totales: Record<string, unknown>;
  receptor?: Record<string, unknown> | null;
  /**
   * Returns registered over this document (FE, FEX and FSE only), newest first.
   * Rejected ones are listed with `estado: "rechazado"` and subtract nothing.
   */
  retornos?: ReturnSummary[];
  /**
   * What is still returnable per line (FE, FEX and FSE only). `null` when the
   * API does not hold the signed JSON of the document (it was issued from the
   * app) or the document is no longer in force.
   */
  disponible?: ReturnAvailability[] | null;
  /** Only with `debug: { timings: true }`. */
  debug?: DebugInfo;
}

export interface ListDocumentsFilters {
  desde?: string;
  hasta?: string;
  estado?: "contingencia" | "firmado" | "invalidado" | "sellado";
  tipoDte?: DteType;
  limit?: number;
  cursor?: string;
  /**
   * `["dte"]` adds the Archivo DTE (and a `resumen`) to every row, resolved in
   * the same call. The page is 20 rows by default and 25 at most. Needs the
   * `download` scope. Rows the API cannot open itself are completed locally with
   * `unlockKey`; a row that still cannot be read carries `dteError`.
   */
  include?: Array<"dte">;
}

/** Why a row of `listDocuments({ include: ["dte"] })` has no `archivoDte`. */
export interface ListedDteError {
  /**
   * `not_sealed` (contingency), `storage_unavailable`, `not_found`, `timeout`,
   * `needs_local_decrypt` (only readable with `unlockKey`, which is not set or
   * cannot reach the copy), `destinations_unavailable`, `destination_read_failed`.
   */
  code: string;
  message: string;
  /** Copies the SDK can read with `unlockKey` (`needs_local_decrypt`). */
  destinos?: Array<{ id: string; rutaJson: string; verificada: boolean }>;
}

export interface ListedDte {
  estado: "sellado" | "firmado" | "contingencia" | "invalidado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  fecEmi: string;
  horEmi?: string;
  selloRecibido?: string | null;
  totales?: { totalGravada?: number; totalIva?: number; totalPagar?: number };
  /** Null when this document’s receiver metadata cannot be opened by the API. */
  receptor?: { nombre?: string | null; numDocumento?: string | null } | null;
  /** Only with `include: ["dte"]`: the Archivo DTE, same text as `downloadDocument(code, "json")`. */
  archivoDte?: string;
  /** Only with `archivoDte`: `summarizeArchivoDte(archivoDte)`. The receiver comes from the legal document. */
  resumen?: import("./archivo-dte-summary.ts").DteResumen | null;
  /** Only with `include: ["dte"]`, instead of `archivoDte`. */
  dteError?: ListedDteError;
}

export interface DtePage {
  documentos: ListedDte[];
  siguiente: string | null;
}

export interface InvalidationPerson {
  nombre: string;
  tipoDocumento: string;
  numDocumento: string;
}

export interface InvalidationRequest {
  tipoAnulacion: 1 | 2 | 3;
  motivo?: string | null;
  codigoGeneracionReemplazo?: string | null;
  responsable: InvalidationPerson;
  solicita: InvalidationPerson;
}

export interface CompleteInvalidationResult {
  estado: "invalidado";
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: DteType;
  ambiente: string;
  yaEstabaInvalidado?: false;
  evento: { codigoGeneracion: string; selloRecibido: string; fhProcesamiento?: string; observaciones?: string[]; tipoAnulacion: number };
  documento: Record<string, unknown>;
  jws: string;
  anotadoEnElIndice: boolean;
}

/** Idempotent server response when the target was already invalidated. */
export interface AlreadyInvalidatedResult {
  estado: "invalidado";
  codigoGeneracion: string;
  numeroControl: string;
  yaEstabaInvalidado: true;
}

export type InvalidationResult = CompleteInvalidationResult | AlreadyInvalidatedResult;

/**
 * One line that comes back. Lines are counted from 1, the way a person reads
 * the invoice. Carry exactly one of `cantidad` (units returned) or `noGravado`
 * (a charge, positive, or credit, negative, that does not touch the taxable
 * base).
 */
export type ReturnItem =
  | { linea: number; cantidad: number; noGravado?: never }
  | { linea: number; noGravado: number; cantidad?: never };

export interface ReturnRequest {
  items: ReturnItem[];
  /** `YYYY-MM-DD`; today in El Salvador when omitted. Bounded by the return window. */
  fechaEvento?: string;
}

/** What is left to return of one line, counted from 1. */
export interface ReturnAvailability {
  linea: number;
  vendida: number;
  devuelta: number;
  disponible: number;
  noGravado: { vendido: number; devuelto: number; disponible: number } | null;
}

export interface ReturnTotals {
  totalGravada: number;
  totalExenta: number;
  totalNoSuj: number;
  totalIva: number;
  totalPagar: number;
}

interface ReturnBase {
  /** The code of the return EVENT, not of the document it applies to. */
  codigoGeneracion: string;
  documentoRelacionado: { codigoGeneracion: string; numeroControl: string; tipoDte: "01" | "11" | "14"; fecEmi: string };
  ambiente: string;
  fecEmi: string;
  horEmi: string;
  totales: ReturnTotals;
  documento: Record<string, unknown>;
  /** The signed event. A retry after a 202 resends exactly this. */
  jws: string;
  /** Exact bytes of the event's JSON, to store as-is. */
  archivoJson: string;
  /** Per line, already counting this return. */
  disponible: ReturnAvailability[];
  almacenamiento?: "retencion" | "ninguno";
}

/** Hacienda sealed the return. */
export interface ReturnSealed extends ReturnBase {
  estado: "sellado";
  selloRecibido: string;
  fhProcesamiento?: string | null;
  observaciones?: string[];
  /** Letter-size PDF in base64, or `null` when it could not be drawn. */
  representacionGrafica: string | null;
  storage?: ManagedStorageReceipt;
  storageErrorCode?: string;
  /** `false` when Hacienda registered it but our book has not noted the verdict yet. */
  anotadoEnElLibro: boolean;
}

/**
 * Hacienda did not answer (HTTP 202). The event is signed and recorded, and its
 * units already count as returned. Repeat the call with the SAME
 * `idempotencyKey` and request: the same `jws` is sent again.
 */
export interface ReturnPending extends ReturnBase {
  estado: "firmado";
  detalle: string;
}

export type ReturnResult = ReturnSealed | ReturnPending;

/** A return listed on `DocumentStatus.retornos`. */
export interface ReturnSummary {
  codigoGeneracion: string;
  estado: "firmado" | "sellado" | "rechazado";
  fecha: string;
  selloRecibido: string | null;
  totales: { totalGravada: number; totalIva: number; totalPagar: number };
  lineas: Array<{ linea: number; cantidad?: number; noGravado?: number }>;
}

export interface RetainedDocument {
  codigoGeneracion: string;
  ambiente: "00" | "01";
  whereLanded: "holding" | "synced";
  gaveUp: boolean;
  attempts: number;
  expiresAt: string;
  downloadedAt?: string | null;
  downloadCount: number;
  syncedAt?: string | null;
  createdAt: string;
}

export interface HoldingPage { documentos: RetainedDocument[]; }

export interface DownloadedDocument {
  codigoGeneracion: string;
  kind: "json" | "pdf" | "ticket";
  bytes: Uint8Array;
  contentType: string;
  filename: string | null;
  /** Source selected by the API. Missing on servers predating source reporting. */
  storageSource?: "managed" | "holding" | "archive";
  /**
   * JSON downloads only, from `X-Facta-Json-Format`: `archivo-dte` is the
   * receiver's file (the default), `raw` the stored original. Missing on
   * servers that predate the header.
   */
  jsonFormat?: "archivo-dte" | "raw";
  /** Present for tickets; defaults to 80 mm when not requested. */
  paperWidthMm?: number;
}

export interface RateLimitWindow {
  limit: number;
  used: number;
  remaining: number;
}

export type SyncState = "legacy" | "ready" | "pending" | "error";

export interface SyncRevision {
  desiredRevision?: number;
  publishedRevision?: number | null;
  status: SyncState;
}

export interface ApiSyncStatus {
  environment?: "00" | "01";
  sign?: SyncRevision;
  destinations?: SyncRevision;
  /** @deprecated Retired in 0.6: the server no longer publishes a catalogue snapshot. */
  catalog?: SyncRevision;
}

export interface Status {
  ok: boolean;
  version: string;
  ambiente: string;
  /** Functions region the API runs in (e.g. `us-west-2`); absent on older APIs. */
  region?: string;
  /** Region that served this very call, when the API reports it. */
  servedRegion?: string;
  emisor: { nit: string; nombre: string; ambiente: string } | null;
  llave: {
    keyId: string;
    label: string | null;
    modo: "custodian" | "byok";
    alcances: string[];
    tiposDte: DteType[];
    venceEl: string | null;
    /**
     * `plain`: the company catalog is unencrypted and the API reads and writes it.
     * Since 0.6 the server resolves `customerId` / `productId` in every mode
     * (also when the company keeps the catalog encrypted at rest) and the SDK
     * just sends the ids; this field is informational.
     */
    catalogMode?: CatalogMode;
    /** true when the company stores its catalog unencrypted: the API reads and writes it. Advertised alongside `catalogMode: "readable"` for older SDKs. */
    catalogoSinCifrar?: boolean;
    /** true while the owner allows API keys with `catalog:write` to administer customers and products. */
    catalogoEscritura?: boolean;
  };
  /** Freshness of the published readable catalog; null unless `catalogMode` is readable. */
  catalogoLegible?: { publicado: boolean; revisionPublicada: number | null; revisionActual: number } | null;
  /** Whether this key can sign and its signing origin. The vault has no read
   * endpoint; only separately registered public certificate facts are exposed. */
  firma?: {
    vaultDeFirma: boolean;
    origenDeLaFirma: "vault" | "plataforma" | "sin-provisionar";
    cabecera: string;
    /** Public certificate metadata matched by the vault's public fingerprint. */
    certificado?: {
      fingerprint: string | null;
      validFrom: string | null;
      validTo: string | null;
      nit: string | null;
      environment: string | null;
    } | null;
  };
  /** Published/current revisions for signing, and storage destinations. */
  sincronizacion?: ApiSyncStatus | null;
  /** Absent on older servers; use getStorageStatus() to negotiate the contract. */
  storage?: ManagedStorageStatus;
  limites: {
    hora: RateLimitWindow | null;
    dia: RateLimitWindow | null;
    estado: RateLimitWindow | null;
    montoMaximoPorDocumentoCentavos: number;
  };
}


// --- Delivery by e-mail and WhatsApp (docs/api-delivery-tokens.md §3) ------------
// Wire names stay Spanish (they are the API's); identifiers are English.

export type DeliveryChannel = "correo" | "whatsapp";

/** `pendiente` and `en_proceso` are the only non-final states. */
export type DeliveryChannelState =
  | "pendiente"
  | "en_proceso"
  | "enviado"
  | "fallido"
  | "sin_credito"
  | "sin_consentimiento"
  | "no_permitido"
  | "vencido"
  | "esperando_sello";

/** Stable reason codes the API documents; unknown codes may appear later. */
export type DeliveryReason =
  | "smtp_rejected"
  | "invalid_address"
  | "wallet_empty"
  | "provider_unavailable"
  | "quota_exceeded"
  | "consent_not_attested"
  | "scope_missing"
  | "token_expired"
  | "contingency"
  | "document_rejected"
  | "document_unavailable"
  | "provider_rejected"
  | "outcome_unknown"
  | "delivery_unavailable"
  | (string & {});

/** What the issue request sends as `entrega`. */
export interface DeliveryRequest {
  /** `true` uses `receptor.correo`; a string overrides it for delivery only. */
  correo?: true | string;
  whatsapp?: { numero: string; consentimiento: true };
}

/** The `deliver` option of `issue`: English names, mapped to `DeliveryRequest`. */
export interface DeliverOptions {
  /** `true` uses `receptor.correo`; a string overrides it for delivery only. */
  email?: true | string;
  /**
   * `consent: true` is YOUR attestation that the receiver agreed to receive
   * documents by WhatsApp. It is stored with the key id and the masked number.
   */
  whatsapp?: { number: string; consent: true };
}

export interface DeliveryChannelStatus {
  estado: DeliveryChannelState;
  /** The recipient, always masked by the server («m•••@ejemplo.com»). */
  destino?: string | null;
  /** Stable reason code when the state is not `enviado`. */
  motivo?: DeliveryReason | null;
  /** ISO-8601 instant of the last change. */
  actualizado?: string;
  /** Only with `debug: { timings: true }` (on `deliverEmail`). */
  debug?: DebugInfo;
}

export type DeliveryChannels = Partial<Record<DeliveryChannel, DeliveryChannelStatus>>;

/** `IssueResult.entrega`. The token is a bearer secret for five minutes: keep it on your server. */
export interface DeliveryOffer {
  /** Absent when nothing is deliverable: a contingency document, or no marked channel has its scope and consent. */
  token?: string;
  /** Issuance + 5 minutes. */
  venceEn?: string;
  canales: DeliveryChannels;
}

/** Answer of `GET /v1/dte/{code}/entrega`. Works after the token expired. */
export interface DeliveryStatus {
  codigoGeneracion?: string;
  ambiente?: "00" | "01";
  /** Token expiry, while the API still reports it. */
  venceEn?: string;
  canales: DeliveryChannels;
  /** Only with `debug: { timings: true }`. */
  debug?: DebugInfo;
}

/** Answer of `POST …/entrega/{canal}`: 200 final, or 202 with `en_proceso`. */
export type DeliveryChannelResult = DeliveryChannelStatus & { canal?: DeliveryChannel };

export interface WaitForDeliveryOptions {
  /** Channels to wait for. Default: every channel the API reports. */
  channels?: DeliveryChannel[];
  /** Give up waiting (not sending) after this long. Default 60 000. */
  timeoutMs?: number;
  /** Pause between reads. Default 2 000. */
  intervalMs?: number;
  signal?: AbortSignal;
  /** Debugging aid: ask the API for its per-step times on each read. */
  debug?: { timings?: boolean };
}

/** `waitForDelivery` result: the last status read, and whether every awaited channel is final. */
export interface WaitedDelivery extends DeliveryStatus {
  settled: boolean;
}
