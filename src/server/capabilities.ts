// Capabilities and projections of the data actions (docs/react-signing-ui.md §11).
//
// Every browser read is a projection built field by field: nothing the API
// returns reaches the browser unless it is named here. Personal data (the
// receiver of a document, a customer's document number) is masked unless the
// host opted in with `exposeRecipient`.

import type {
  CatalogCustomer,
  CatalogProduct,
  DocumentStatus,
  DtePage,
  HoldingPage,
  ListedDte,
  ManagedDocumentCopy,
  ManagedStorageReceipt,
  ManagedStorageStatus,
} from "../types.ts";

export type FactaDownloadKind = "pdf" | "json" | "ticket";

/** What the browser may ask this handler for, beyond the issuing actions. Default: nothing. */
export interface FactaCapabilities {
  /** `documents.list`, `documents.get`, `documents.copies`, `documents.holding`. */
  documents?: "read";
  /** `documents.download`: `true` allows PDF, JSON and ticket; an array narrows it. */
  downloads?: boolean | FactaDownloadKind[];
  /** `catalog.customers.*` and `catalog.products.*` (needs `unlockKey` on the server). */
  catalog?: "read";
  /** `service.status`. */
  status?: boolean;
  /** `storage.status`. */
  storage?: "read";
  /** `documents.retryStorage` (idempotent). */
  retryStorage?: boolean;
  /** `invalidate.describe` and `invalidate`, only with a session from `createFactaInvalidationSession`. */
  invalidate?: "session";
}

export const READ_ACTIONS = [
  "documents.list",
  "documents.get",
  "documents.download",
  "documents.copies",
  "documents.retryStorage",
  "documents.holding",
  "catalog.customers.search",
  "catalog.customers.get",
  "catalog.products.search",
  "catalog.products.get",
  "service.status",
  "storage.status",
] as const;

export const INVALIDATION_ACTIONS = ["invalidate.describe", "invalidate"] as const;

export type FactaReadAction = typeof READ_ACTIONS[number];
export type FactaInvalidationAction = typeof INVALIDATION_ACTIONS[number];
export type FactaIssuingAction = "session.describe" | "issue" | "status";
export type FactaAction = FactaIssuingAction | FactaReadAction | FactaInvalidationAction;

/** The capability that unlocks each non-issuing action. */
export function allows(capabilities: FactaCapabilities, action: FactaReadAction | FactaInvalidationAction): boolean {
  switch (action) {
    case "documents.list":
    case "documents.get":
    case "documents.copies":
    case "documents.holding":
      return capabilities.documents === "read";
    case "documents.download":
      return capabilities.downloads === true || (Array.isArray(capabilities.downloads) && capabilities.downloads.length > 0);
    case "documents.retryStorage":
      return capabilities.retryStorage === true;
    case "catalog.customers.search":
    case "catalog.customers.get":
    case "catalog.products.search":
    case "catalog.products.get":
      return capabilities.catalog === "read";
    case "service.status":
      return capabilities.status === true;
    case "storage.status":
      return capabilities.storage === "read";
    case "invalidate.describe":
    case "invalidate":
      return capabilities.invalidate === "session";
  }
}

export function allowedDownloadKinds(capabilities: FactaCapabilities): FactaDownloadKind[] {
  if (capabilities.downloads === true) return ["pdf", "json", "ticket"];
  return Array.isArray(capabilities.downloads) ? capabilities.downloads : [];
}

export function validateCapabilities(value: unknown): FactaCapabilities {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("capabilities must be an object.");
  }
  const c = value as Record<string, unknown>;
  const known = ["documents", "downloads", "catalog", "status", "storage", "retryStorage", "invalidate"];
  for (const key of Object.keys(c)) {
    if (!known.includes(key)) throw new TypeError(`Unknown capability "${key}".`);
  }
  if (c.documents !== undefined && c.documents !== "read") throw new TypeError('capabilities.documents must be "read".');
  if (c.catalog !== undefined && c.catalog !== "read") throw new TypeError('capabilities.catalog must be "read".');
  if (c.storage !== undefined && c.storage !== "read") throw new TypeError('capabilities.storage must be "read".');
  if (c.invalidate !== undefined && c.invalidate !== "session") throw new TypeError('capabilities.invalidate must be "session".');
  for (const key of ["status", "retryStorage"]) {
    if (c[key] !== undefined && typeof c[key] !== "boolean") throw new TypeError(`capabilities.${key} must be a boolean.`);
  }
  if (c.downloads !== undefined) {
    const d = c.downloads;
    const ok = typeof d === "boolean" ||
      (Array.isArray(d) && d.every((k) => k === "pdf" || k === "json" || k === "ticket"));
    if (!ok) throw new TypeError('capabilities.downloads must be a boolean or a list of "pdf" | "json" | "ticket".');
  }
  return c as FactaCapabilities;
}

// --- Masking -------------------------------------------------------------------

/** `05308546-5` → `0530 ••••• 5`. Short values are fully hidden. */
export function maskDocumentNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[^0-9A-Za-z]/g, "");
  if (clean.length < 6) return clean === "" ? null : "•••••";
  return `${clean.slice(0, 4)} ••••• ${clean.slice(-1)}`;
}

/** CAT-022 labels for the codes the catalog stores; anything else is shown as the code. */
export function documentTypeLabel(code: unknown): string | null {
  if (typeof code !== "string" || code === "") return null;
  const labels: Record<string, string> = { "36": "NIT", "13": "DUI", "37": "Otro", "03": "Pasaporte", "02": "Carnet de residente" };
  return labels[code] ?? code;
}

/** `06142103891024` → `0614-210389-102-4`; DUI `048293165` → `04829316-5`. */
export function formatDocumentNumber(code: unknown, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (code === "36" && digits.length === 14) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 10)}-${digits.slice(10, 13)}-${digits.slice(13)}`;
  }
  if (code === "13" && digits.length === 9) return `${digits.slice(0, 8)}-${digits.slice(8)}`;
  return value === "" ? null : value;
}

// --- Projections ---------------------------------------------------------------

const TOTAL_KEYS = [
  "totalNoSuj",
  "totalExenta",
  "totalGravada",
  "totalDescu",
  "totalIva",
  "montoTotalOperacion",
  "totalPagar",
] as const;

function pickTotals(totals: unknown): Record<string, number | string> | undefined {
  if (typeof totals !== "object" || totals === null) return undefined;
  const out: Record<string, number | string> = {};
  for (const key of TOTAL_KEYS) {
    const v = (totals as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  const words = (totals as Record<string, unknown>).totalLetras;
  if (typeof words === "string" && words.length <= 300) out.totalLetras = words;
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface ProjectionOptions {
  exposeRecipient: boolean;
}

function recipientView(value: unknown, options: ProjectionOptions): { nombre: string | null; numDocumento: string | null } | undefined {
  if (!options.exposeRecipient || typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  return {
    nombre: typeof r.nombre === "string" ? r.nombre.slice(0, 200) : null,
    numDocumento: maskDocumentNumber(r.numDocumento),
  };
}

export function projectListed(doc: ListedDte, options: ProjectionOptions): Record<string, unknown> {
  const receptor = recipientView(doc.receptor, options);
  return {
    estado: doc.estado,
    codigoGeneracion: doc.codigoGeneracion,
    numeroControl: doc.numeroControl,
    tipoDte: doc.tipoDte,
    fecEmi: doc.fecEmi,
    horEmi: doc.horEmi ?? null,
    selloRecibido: doc.selloRecibido ?? null,
    totales: pickTotals(doc.totales) ?? null,
    ...(options.exposeRecipient ? { receptor: receptor ?? null } : {}),
  };
}

export function projectPage(page: DtePage, options: ProjectionOptions): Record<string, unknown> {
  return {
    documentos: (Array.isArray(page.documentos) ? page.documentos : []).map((d) => projectListed(d, options)),
    siguiente: typeof page.siguiente === "string" ? page.siguiente : null,
  };
}

export function projectDocument(status: DocumentStatus, options: ProjectionOptions): Record<string, unknown> {
  const receptor = recipientView(status.receptor, options);
  return {
    estado: status.estado,
    codigoGeneracion: status.codigoGeneracion,
    numeroControl: status.numeroControl,
    tipoDte: status.tipoDte,
    ambiente: status.ambiente,
    fecEmi: status.fecEmi,
    horEmi: status.horEmi ?? null,
    selloRecibido: status.selloRecibido ?? null,
    observaciones: Array.isArray(status.observaciones) ? status.observaciones.filter((o) => typeof o === "string") : [],
    totales: pickTotals(status.totales) ?? null,
    ...(options.exposeRecipient ? { receptor: receptor ?? null } : {}),
  };
}

export function projectCopies(copies: ManagedDocumentCopy[]): Record<string, unknown> {
  return {
    copies: copies.map((c) => ({
      kind: c.kind,
      state: c.state,
      bytes: c.bytes,
      storedAt: c.storedAt,
      environment: c.environment,
    })),
  };
}

export function projectRetry(receipt: ManagedStorageReceipt): Record<string, unknown> {
  return {
    storage: {
      json: receipt.json?.state ?? null,
      pdf: receipt.pdf?.state ?? null,
    },
  };
}

export function projectHolding(page: HoldingPage): Record<string, unknown> {
  return {
    documentos: (Array.isArray(page.documentos) ? page.documentos : []).map((d) => ({
      codigoGeneracion: d.codigoGeneracion,
      ambiente: d.ambiente,
      whereLanded: d.whereLanded,
      gaveUp: d.gaveUp,
      attempts: d.attempts,
      expiresAt: d.expiresAt,
    })),
  };
}

export function projectCustomer(c: CatalogCustomer, options: ProjectionOptions): Record<string, unknown> {
  const full = options.exposeRecipient;
  return {
    id: c.id,
    name: typeof c.name === "string" ? c.name : null,
    docType: documentTypeLabel(c.doc_type),
    docNumber: full ? formatDocumentNumber(c.doc_type, c.doc_number) : maskDocumentNumber(c.doc_number),
    nrc: typeof c.nrc === "string" && c.nrc !== "" ? (full ? c.nrc : maskDocumentNumber(c.nrc)) : null,
  };
}

export function projectProduct(p: CatalogProduct): Record<string, unknown> {
  return {
    id: p.id,
    code: typeof p.code === "string" ? p.code : null,
    description: typeof p.description === "string" ? p.description : null,
    price: typeof p.unit_price === "number" && Number.isFinite(p.unit_price) ? p.unit_price : null,
    vatIncluded: typeof p.vat_included === "boolean" ? p.vat_included : null,
  };
}

export function projectStorageStatus(status: ManagedStorageStatus): Record<string, unknown> {
  const m = status.managed;
  return {
    configured: m.configured === true,
    ready: m.ready === true,
    state: typeof m.state === "string" ? m.state : "unknown",
    quotaBytes: m.quotaBytes,
    usedBytes: m.usedBytes,
    reservedBytes: m.reservedBytes,
    coveredUntil: m.coveredUntil,
    byosReady: status.byos?.ready === true,
  };
}

export type FactaServiceState = "online" | "contingency" | "degraded" | "offline";
