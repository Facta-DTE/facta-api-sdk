// The integrator's side of the temporary encrypted copy.
//
// Facta keeps an encrypted temporary copy of every sealed document. It is a
// safety net, not the archive: it is deleted 2 days after the document is
// marked as stored, or 30 days after sealing if nobody marked it (the company
// owner is mailed from day one, with a table of what will be deleted and when).
// A document is marked when Facta verified a copy of its own (Facta Storage, or
// a destination Facta wrote), when the SDK reported a copy it wrote to a synced
// destination, or when you call `confirmDocumentStorage`.
//
// This module holds the types and the pure helpers; the HTTP calls are methods
// of `Facta` (`listUnconfirmedDocuments`, `confirmDocumentStorage`,
// `storeAndConfirmUnconfirmed`).

/** Who marked the document as stored. `facta_*` were checked by Facta; `*_report` are claims. */
export type ConfirmedBy = "facta_managed" | "facta_byos" | "sdk_report" | "api_report" | "app_report" | "admin";

/** A sealed document that still depends on Facta's temporary encrypted copy. */
export interface UnconfirmedDocument {
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: string;
  fecEmi: string | null;
  selladoEn: string;
  /** When the temporary copy is deleted if nobody confirms. */
  borradoEl: string;
  /** Whole days until `borradoEl`, rounded up, never negative. */
  diasRestantes: number;
  copias: {
    /** State of the JSON in Facta Storage. `stored` already counts as stored, so it rarely shows up here. */
    facta: "stored" | "pending" | "none";
    /** Copies reported (not verified) in your own destinations. */
    byos: number;
  };
}

/** One page of `GET /v1/storage/unconfirmed`. Oldest deletion date first. */
export interface UnconfirmedPage {
  capabilityVersion: 1;
  documentos: UnconfirmedDocument[];
  /** Every document still waiting, not only this page. */
  total: number;
  /** Pass it as `cursor` for the next page; `null` when there is none. */
  siguiente: string | null;
}

export interface ListUnconfirmedOptions {
  /** 1 to 100; the server default is 50. */
  limit?: number;
  /** The `siguiente` of the previous page. */
  cursor?: string;
  signal?: AbortSignal;
}

/**
 * What you tell Facta about the copy you stored. Give the SHA-256 (64 hex
 * characters) of the JSON bytes you stored, or the bytes themselves and the SDK
 * hashes them.
 */
export type StorageConfirmationInput =
  & { where: string }
  & ({ sha256: string; bytes?: never } | { bytes: Uint8Array | string; sha256?: never });

/** The answer of `POST /v1/dte/{cg}/storage-confirmation`. */
export interface StorageConfirmation {
  codigoGeneracion: string;
  confirmado: true;
  /** The FIRST source that marked the document; it is kept. */
  por: ConfirmedBy;
  /** True when the document was already marked before this call. */
  yaConfirmado: boolean;
  /** True only when Facta compared your hash with the JSON it can rebuild (documents issued by the API). */
  verificado: boolean;
  /** True when Facta could not check your claim (an app-issued document, or the temporary copy was already deleted). */
  informado: boolean;
  /** When the temporary copy is deleted; `null` when it already was. */
  borradoEl: string | null;
}

/** The files handed to your `store` function. */
export interface UnconfirmedFiles {
  codigoGeneracion: string;
  /** The receiver's Archivo DTE, exactly as downloaded. Store these bytes; the SDK hashes them. */
  json: Uint8Array;
  /** The PDF, or `null` when it could not be downloaded (the JSON alone confirms). */
  pdf: Uint8Array | null;
  /** SHA-256 (lower-case hex) of `json`. */
  sha256: string;
}

/**
 * Your storage. Write the files somewhere you own and RESOLVE only when they are
 * durably there; throw if you could not. Return a short name of the place
 * (`"s3://contabilidad"`, never a secret) or nothing to use `where`.
 */
export type StoreUnconfirmedFn = (files: UnconfirmedFiles, document: UnconfirmedDocument) => Promise<string | void>;

export interface StoreAndConfirmOptions {
  store: StoreUnconfirmedFn;
  /** The most documents one run handles; default 200, at most 1000. A run that hits it says `stopped: "limit"`. */
  limit?: number;
  /** Documents per list page, 1 to 100; default 50. */
  pageSize?: number;
  /** Name sent as `donde` when `store` returns nothing; default `"store"`. */
  where?: string;
  /** Also download the PDF and pass it to `store`; default `true`. */
  includePdf?: boolean;
  /** Stop the run after this many failed documents; default 5. */
  maxFailures?: number;
  signal?: AbortSignal;
}

export type StoreAndConfirmStep = "list" | "download" | "store" | "confirm";

export interface StoreAndConfirmDocumentResult {
  codigoGeneracion: string;
  state: "confirmed" | "failed";
  by?: ConfirmedBy;
  alreadyConfirmed?: boolean;
  verificado?: boolean;
  informado?: boolean;
  /** Where the copy was stored, as the caller named it. */
  where?: string;
  /** True when the PDF could not be downloaded (the JSON was still stored and confirmed). */
  pdfMissing?: boolean;
  borradoEl?: string | null;
  /** On failure: the step that failed, the FactaError code (or `store_failed`) and a short message. */
  step?: StoreAndConfirmStep;
  code?: string;
  message?: string;
}

export interface StoreAndConfirmReport {
  /** Documents looked at in this run. */
  listed: number;
  confirmed: number;
  failed: number;
  /** One row per document handled, in order. */
  results: StoreAndConfirmDocumentResult[];
  /** Documents still waiting after the run (from the server count minus this run's confirmations), when known. */
  remaining: number | null;
  /** The earliest deletion date among the documents the run did NOT confirm; `null` when none or unknown. */
  firstDeletionAt: string | null;
  /**
   * Why the run ended. `complete`: the list was exhausted. `limit`: `limit` documents were handled.
   * `too_many_failures`: `maxFailures` reached. `aborted`: your signal. `fatal`: an error that
   * affects every document (see `error`). `list_failed`: the list call failed (see `error`).
   */
  stopped: "complete" | "limit" | "too_many_failures" | "aborted" | "fatal" | "list_failed";
  error?: { code: string; message: string };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** SHA-256 of text (UTF-8) or bytes, as lower-case hex. */
export async function sha256OfBytes(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The validated `{ donde, sha256 }` body of a confirmation. Throws `TypeError` on bad input. */
export async function confirmationBody(input: StorageConfirmationInput): Promise<{ donde: string; sha256: string }> {
  const where = typeof input.where === "string" ? input.where.trim() : "";
  if (where === "" || where.length > 200) {
    throw new TypeError("where is a short name (1 to 200 characters) of the place you stored the document; never a secret.");
  }
  const hasHash = input.sha256 !== undefined;
  const hasBytes = input.bytes !== undefined;
  if (hasHash === hasBytes) throw new TypeError("Give exactly one of sha256 or bytes.");
  const sha256 = hasHash ? String(input.sha256).trim().toLowerCase() : await sha256OfBytes(input.bytes as Uint8Array | string);
  if (!SHA256_PATTERN.test(sha256)) throw new TypeError("sha256 must be 64 hexadecimal characters.");
  return { donde: where, sha256 };
}

const CONFIRMED_BY = new Set<string>(["facta_managed", "facta_byos", "sdk_report", "api_report", "app_report", "admin"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUnconfirmedPage(value: unknown): value is UnconfirmedPage {
  if (!isRecord(value) || value.capabilityVersion !== 1 || !Array.isArray(value.documentos)) return false;
  if (typeof value.total !== "number" || !(value.siguiente === null || typeof value.siguiente === "string")) return false;
  return value.documentos.every((doc) =>
    isRecord(doc) && typeof doc.codigoGeneracion === "string" && UUID.test(doc.codigoGeneracion) &&
    typeof doc.numeroControl === "string" && typeof doc.tipoDte === "string" &&
    (doc.fecEmi === null || typeof doc.fecEmi === "string") && typeof doc.selladoEn === "string" &&
    typeof doc.borradoEl === "string" && typeof doc.diasRestantes === "number" &&
    isRecord(doc.copias) && ["stored", "pending", "none"].includes(String(doc.copias.facta)) && typeof doc.copias.byos === "number"
  );
}

export function isStorageConfirmation(value: unknown): value is StorageConfirmation {
  return isRecord(value) && typeof value.codigoGeneracion === "string" && value.confirmado === true &&
    CONFIRMED_BY.has(String(value.por)) && typeof value.yaConfirmado === "boolean" &&
    typeof value.verificado === "boolean" && typeof value.informado === "boolean" &&
    (value.borradoEl === null || typeof value.borradoEl === "string");
}
