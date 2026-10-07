import type {
  InvalidationResult,
  IssueResult,
  InvalidationRequest,
  DteRequest,
  ManagedStorageReceipt,
} from "./types.ts";

/** Durable journal record. It intentionally contains no API or vault secret. */
export interface ArchiveOperation {
  id: string;
  /** Public identity of the authenticated API context; never contains credentials. */
  identity?: ArchiveOperationIdentity;
  idempotencyKey: string;
  requestSha256: string;
  /** Immutable catalog-resolved request snapshot, protected by the archive implementation. */
  request?: DteRequest;
  createdAt: string;
  state: "started" | "issued" | "complete" | "needs_attention";
  /** Width used for the separately archived receipt PDF; absent on older journals. */
  ticketPaperWidthMm?: number;
  codigoGeneracion?: string;
  detail?: string;
  /** Latest outcome for every remote destination/artifact pair. */
  remoteCopies?: RemoteCopyRecord[];
  /** Latest Facta-managed JSON/PDF receipt; absent on older API responses. */
  managedStorage?: ManagedStorageReceipt;
  storageErrorCode?: "storage_contract_invalid";
}

export interface ArchiveOperationIdentity {
  version: 1;
  endpoint: string;
  keyId: string;
  issuerNit: string;
  environment: "00" | "01";
}

/** Safe operation summary; unlike the archive journal, it omits the fiscal request. */
export type PendingArchiveOperation = Pick<
  ArchiveOperation,
  "id" | "createdAt" | "state" | "codigoGeneracion"
> & {
  remoteCopies?: Array<Pick<RemoteCopyRecord, "destinationId" | "kind" | "state" | "sha256" | "updatedAt">>;
  managedStorage?: ManagedStorageReceipt;
  storageErrorCode?: "storage_contract_invalid";
};

export interface ArchiveArtifact {
  codigoGeneracion: string;
  kind: "json" | "pdf" | "jws" | "ticket";
  filename: string | null;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}

export type RemoteCopyState = "stored" | "unknown" | "failed" | "unavailable";

export interface RemoteCopyRecord {
  destinationId: string;
  kind: ArchiveArtifact["kind"];
  label: string;
  state: RemoteCopyState;
  sha256: string;
  updatedAt: string;
  detail?: string;
  /**
   * Whether Facta was told about this BYOS copy. Only set on the JSON record of a
   * destination that has `canonicalCopy`; `failed` keeps the operation pending so
   * `recoverOperation` retries the report.
   */
  report?: "reported" | "failed";
}

/** Runtime-specific writer supplied by the integrator for one synced destination. */
export interface RemoteArtifactDestination {
  id: string;
  kind: string;
  label: string;
  /** Artifact kinds this destination receives; defaults to every archived kind. */
  kinds?: readonly ArchiveArtifact["kind"][];
  /**
   * Set only when the destination writes to Facta's canonical archive layout
   * (`DTE/…/YYYY/MM/<numeroControl>.json|pdf`). Such copies are reported to Facta
   * after a verified write so the app can see them. `secretId` is the `id` of the
   * entry in the synced destinations snapshot.
   */
  canonicalCopy?: { secretId: string; jsonPath: string; pdfPath: string };
  /** Repeating the same artifact/hash MUST replace or confirm identical bytes at a stable location. */
  write(artifact: ArchiveArtifact, options?: { signal?: AbortSignal }): Promise<RemoteCopyState>;
  /** Read-only check. Resolve an ambiguous write without modifying remote data. */
  check?(artifact: ArchiveArtifact, options?: { signal?: AbortSignal }): Promise<"stored" | "missing" | "unknown">;
}

/**
 * Runtime adapters implement this port. `begin` must durably commit before it
 * resolves; `saveArtifact` must be idempotent for the same SHA-256 and reject
 * different bytes for the same document/kind. Implementations should use
 * atomic replacement and report unhealthy storage from `assertReady`.
 */
export interface InvoiceArchive {
  assertReady(): Promise<void>;
  /** Return false for an existing, matching operation; reject ID/key/hash conflicts. */
  begin(operation: ArchiveOperation): Promise<boolean>;
  find(operationId: string): Promise<ArchiveOperation | null>;
  /** Operations needing local archive completion or remote-copy reconciliation. */
  pending(): Promise<ArchiveOperation[]>;
  markIssued(operationId: string, result: IssueResult): Promise<void>;
  saveArtifact(artifact: ArchiveArtifact): Promise<void>;
  getArtifact(
    generationCode: string,
    kind: "json" | "pdf" | "jws" | "ticket",
  ): Promise<ArchiveArtifact | null>;
  finish(operationId: string): Promise<void>;
  markNeedsAttention(operationId: string, detail: string): Promise<void>;
  /** Persist one remote-copy result atomically with the encrypted operation journal. */
  recordRemoteCopy(operationId: string, record: RemoteCopyRecord): Promise<void>;
  /** Persist managed storage repair outcomes when the archive supports the additive contract. */
  recordManagedStorage?(operationId: string, receipt: ManagedStorageReceipt): Promise<void>;
}

/** Durable record for one irreversible invalidation event. */
export interface InvalidationOperation {
  id: string;
  /** Missing only in legacy journals that cannot be replayed automatically. */
  identity?: ArchiveOperationIdentity;
  targetCodigoGeneracion: string;
  idempotencyKey: string;
  requestSha256: string;
  request: InvalidationRequest;
  createdAt: string;
  state: "started" | "complete" | "needs_attention";
  result?: InvalidationResult;
  eventJwsSha256?: string;
  detail?: string;
}

/** Additional archive port required by `invalidateAndArchive`. */
export interface InvalidationArchive extends InvoiceArchive {
  beginInvalidation(operation: InvalidationOperation): Promise<boolean>;
  findInvalidation(operationId: string): Promise<InvalidationOperation | null>;
  pendingInvalidations(): Promise<InvalidationOperation[]>;
  completeInvalidation(operationId: string, result: InvalidationResult): Promise<void>;
  markInvalidationNeedsAttention(
    operationId: string,
    detail: string,
    result?: InvalidationResult,
  ): Promise<void>;
}

export interface InvalidationArchiveResult {
  /** Omitted when recovered from an existing encrypted event journal. */
  invalidation?: InvalidationResult;
  archive: {
    state: "complete" | "needs_attention";
    operationId: string;
    eventJwsSha256?: string;
    detail?: string;
  };
}

/** Non-fatal problem after a document was sealed. The sealed document is never affected. */
export interface ArchiveWarning {
  code: "byos_not_replicated" | "copy_report_failed" | "emergency_saved" | "emergency_failed";
  /** Destination the warning is about; absent when the destinations could not be resolved at all. */
  destinationId?: string;
  /** Safe, credential-free explanation. */
  detail: string;
}

export interface ArchiveEmissionResult {
  /** Present only when the emergency safeguard ran (see `runtime.emergencyStore`). */
  emergency?: import("./emergency.ts").EmergencyReport;
  /** Typed, non-throwing problems with BYOS replication or reporting; retry with `recoverOperation`. */
  warnings?: ArchiveWarning[];
  /** Omitted when restart recovery finds the existing DTE by generation code. */
  emission?: IssueResult;
  managedStorage?: ManagedStorageReceipt;
  storageErrorCode?: "storage_contract_invalid";
  archive: {
    state: "complete" | "needs_attention";
    operationId: string;
    artifacts: Array<{ kind: "json" | "pdf" | "jws" | "ticket"; sha256: string }>;
    remoteCopies?: RemoteCopyRecord[];
    detail?: string;
  };
}

export interface ArchiveEmissionOptions {
  archive: InvoiceArchive;
  /** Stable application order ID. Reuse it when resuming this operation. */
  operationId: string;
  /** Stable across process restarts; the API keeps idempotency claims for 24 h. */
  idempotencyKey: string;
  /** Include a regenerated ticket in the archive; defaults to true. */
  includeTicket?: boolean;
  /** Ticket width to archive with each new issue; defaults to 80 mm. Valid range: 40–120 mm. */
  ticketPaperWidthMm?: number;
  signal?: AbortSignal;
  /** Optional writes to destinations resolved locally by the integrator. */
  remoteDestinations?: readonly RemoteArtifactDestination[];
  /**
   * Set `false` to opt out of the default replication to the destinations synced
   * from the Facta app (used only when `remoteDestinations` is not supplied).
   */
  replicate?: boolean;
}

export interface RemoteReplicationReport {
  operationId: string;
  outcomes: RemoteCopyRecord[];
}

export type RemoteDestinationProbeState = "stored" | "missing" | "unknown" | "unsupported";

export interface RemoteDestinationProbeResult {
  destinationId: string;
  kind: string;
  label: string;
  artifact: ArchiveArtifact["kind"];
  state: RemoteDestinationProbeState;
  expectedSha256: string;
}

/** Read-only checks against real, locally archived artifacts. A stored result
 * confirms read access and matching bytes; it does not prove write access. */
export interface RemoteDestinationProbeReport {
  operationId: string;
  results: RemoteDestinationProbeResult[];
}

export type ArchiveRequestFingerprint = (
  request: DteRequest,
) => Promise<string>;
