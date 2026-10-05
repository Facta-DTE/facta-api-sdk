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
  /** Optional when productId resolves this field from the encrypted catalog. */
  descripcion?: string;
  cantidad: number;
  /** FE (01): VAT INCLUDED. CCF (03): VAT EXCLUDED. The official schemas
   * differ and the server does not guess. */
  /** Optional when productId resolves this field from the encrypted catalog. */
  precioUni?: number;
  /** Facta catalog product reference; resolved locally by the SDK. */
  productId?: string;
  /** 05/06: target document number when the note corrects multiple documents. */
  numeroDocumento?: string;
  codigo?: string | null;
  tipoItem?: 1 | 2 | 3 | 4;
  uniMedida?: number;
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
  recintoFiscal?: string | null;
  tipoRegimen?: string | null;
  regimen?: string | null;
  flete?: number;
  seguro?: number;
}

interface DteRequestBase {
  items: LineItem[];
  condicionOperacion?: 1 | 2 | 3;
  plazo?: "01" | "02" | "03" | null;
  periodo?: number | null;
  formaPago?: string;
  observaciones?: string | null;
}

/** DTE request union. DTE-specific fields are available only on their type. */
export type DteRequest =
  | (DteRequestBase & { tipoDte: "01"; receptor?: Recipient | null; documentosRelacionados?: never; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & { tipoDte: "03"; receptor?: Recipient | null; documentosRelacionados?: never; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & { tipoDte: "05"; receptor?: Recipient | null; documentosRelacionados: RelatedDocument[]; exportacion?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & { tipoDte: "06"; receptor?: Recipient | null; documentosRelacionados: RelatedDocument[]; numPagoElectronico?: string | null; exportacion?: never; aplicarReteRenta?: never })
  | (DteRequestBase & { tipoDte: "11"; receptor: ExportRecipient; exportacion: ExportDetails; documentosRelacionados?: never; aplicarReteRenta?: never; numPagoElectronico?: never })
  | (DteRequestBase & { tipoDte: "14"; receptor: ExcludedSubjectRecipient; aplicarReteRenta?: boolean; documentosRelacionados?: never; exportacion?: never; numPagoElectronico?: never });

export interface CatalogSnapshot {
  version: 1;
  customers: CatalogCustomer[];
  products: CatalogProduct[];
}

/** Public synchronization facts for this process-local catalog cache. */
export interface CatalogState {
  freshness: "fresh" | "stale" | "missing";
  localRevision: number | null;
  fetchedAt: string | null;
  desiredRevision: number | null;
  publishedRevision: number | null;
  syncStatus: string | null;
  /** Safe error code when the API could not be reached; never includes response data. */
  statusError: string | null;
}

/** Explicit opt-in for non-fiscal catalog reads from the last process-local snapshot. */
export interface CatalogReadOptions {
  allowStale?: boolean;
}

/** Decrypted customer fields shared with this API key. */
export interface CatalogCustomer {
  id: string;
  name?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  nrc?: string | null;
  activity_code?: string | null;
  address?: Address | null;
  phone?: string | null;
  email?: string | null;
  [field: string]: unknown;
}

/** Decrypted product fields shared with this API key. */
export interface CatalogProduct {
  id: string;
  code?: string | null;
  barcode?: string | null;
  description?: string | null;
  item_type?: string | number | null;
  unit_of_measure?: string | number | null;
  unit_price?: number | null;
  vat_included?: boolean | null;
  active?: boolean;
  [field: string]: unknown;
}

export interface CatalogSearchOptions {
  /** Maximum number of local matches. Defaults to 50; valid range is 1–500. */
  limit?: number;
  /** Permit the last process-local snapshot if status is unreachable or sync is pending. */
  allowStale?: boolean;
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
  /** Server-rendered PDF as base64, present after a successful seal. */
  representacionGrafica?: string | null;
  /** Facta-managed durable copies; absent on older API servers. */
  storage?: ManagedStorageReceipt;
  /** Fiscal success is preserved when an attached storage receipt is malformed. */
  storageErrorCode?: "storage_contract_invalid";
  /** Present only when the request marked delivery channels (`deliver`). Carries the delivery token. */
  entrega?: DeliveryOffer;
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
  supportedKinds: Array<"json" | "pdf">;
  unsupportedKinds: Array<"ticket" | "invalidation">;
}

export interface ManagedDocumentCopy {
  generationCode: string;
  kind: "json" | "pdf";
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
}

export interface ListDocumentsFilters {
  desde?: string;
  hasta?: string;
  estado?: "contingencia" | "firmado" | "invalidado" | "sellado";
  tipoDte?: DteType;
  limit?: number;
  cursor?: string;
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
  catalog?: SyncRevision;
}

export interface Status {
  ok: boolean;
  version: string;
  ambiente: string;
  emisor: { nit: string; nombre: string; ambiente: string } | null;
  llave: {
    keyId: string;
    label: string | null;
    modo: "custodian" | "byok";
    alcances: string[];
    tiposDte: DteType[];
    venceEl: string | null;
  };
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
  /** Published/current revisions for signing, storage destinations, and the encrypted catalog. */
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
  destino?: string;
  /** Stable reason code when the state is not `enviado`. */
  motivo?: DeliveryReason | null;
  /** ISO-8601 instant of the last change. */
  actualizado?: string;
}

export type DeliveryChannels = Partial<Record<DeliveryChannel, DeliveryChannelStatus>>;

/** `IssueResult.entrega`. The token is a bearer secret for five minutes: keep it on your server. */
export interface DeliveryOffer {
  /** Absent for a contingency document. */
  token?: string;
  /** Issuance + 5 minutes. */
  venceEn?: string;
  canales: DeliveryChannels;
}

/** Answer of `GET /v1/dte/{code}/entrega`. Works after the token expired. */
export interface DeliveryStatus {
  codigoGeneracion?: string;
  canales: DeliveryChannels;
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
}

/** `waitForDelivery` result: the last status read, and whether every awaited channel is final. */
export interface WaitedDelivery extends DeliveryStatus {
  settled: boolean;
}
