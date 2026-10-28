// Drafts: an invoice a program leaves for a person of the company to review and issue (scope `draft`).
//
// Facta validates the draft exactly like an emission up to the point where a control number would
// be reserved (none is spent), resolves `customerId` / `productId`, seals it to the company's public
// draft-box key and keeps no plaintext. Anybody of the company who may issue that document type
// opens it in the app. It expires after 30 days; a company holds at most 500.

import { FactaError } from "./errors.ts";

/** The states a draft can be in; `pendiente` as a filter means «everything not resolved yet». */
export const DRAFT_STATES = [
  "pendiente",
  "en_revision",
  "emitiendo",
  "emitido",
  "descartado",
  "cancelado",
  "vencido",
  "aplicado",
  "aplicado_parcial",
  "rechazado",
] as const;
export type DraftState = (typeof DRAFT_STATES)[number];

/** A draft as the API reports it. Issued, it carries the document it became. */
export interface Draft {
  /** The draft id (`borradorId`). */
  id: string;
  /** One of {@link DRAFT_STATES} (kept as text so a newer server state never breaks a read). */
  state: string;
  /** Pass it as `version` to `issueDraft` and as `ifMatch` to `updateDraft`. */
  version: number;
  /** The server-computed totals, when the response carries them. */
  totals?: Record<string, unknown>;
  /** Present once the draft became a document. */
  generationCode?: string;
  controlNumber?: string;
  documentState?: string | null;
  /** True when Hacienda sealed it. */
  sealed?: boolean;
  /** `app` when a person issued it from the app, `api` when a key did. */
  issuedBy?: "app" | "api";
  /** True when a person changed it in the app before issuing. */
  edited?: boolean;
  /** Legacy envelope of a draft sealed by the caller (`inbox-v1`); null otherwise. */
  envelope?: Record<string, unknown> | null;
  /** The resolved request, only when this key can open the company data key (`include: "contenido"` or a single read). */
  content?: Record<string, unknown>;
}

/** The body of a draft: the same request as `issue`, plus an optional id and your own reference. */
export type DraftInput = Record<string, unknown> & {
  /** Your UUID v4 for the draft; Facta picks one when omitted. */
  id?: string;
  /** Up to 64 characters, yours, no personal data. Filters `listDrafts`. */
  reference?: string;
};

export interface ListDraftsOptions {
  state?: DraftState;
  /** Your own `reference`. */
  reference?: string;
  limit?: number;
  cursor?: string;
  /** `contenido` adds each draft's resolved request (max 50 per page); `envelope` the legacy envelope. */
  include?: "contenido" | "envelope";
  signal?: AbortSignal;
}

export interface DraftPage {
  drafts: Draft[];
  /** Pass it as `cursor` for the next page; null on the last. */
  next: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The wire body of a draft: `reference` travels as `referencia`; everything else is the issue request. */
export function draftBody(input: DraftInput): Record<string, unknown> {
  if (!isObject(input)) throw new TypeError("A draft needs a request object.");
  const { reference, ...rest } = input;
  if (reference !== undefined) {
    if (typeof reference !== "string" || reference.length === 0 || reference.length > 64) {
      throw new TypeError("reference must be a text of 1 to 64 characters.");
    }
    return { ...rest, referencia: reference };
  }
  return rest;
}

export function draftOf(payload: unknown): Draft {
  const r = isObject(payload) && isObject(payload["borrador"]) ? payload["borrador"] : payload;
  if (!isObject(r) || typeof r["borradorId"] !== "string" || typeof r["version"] !== "number") {
    throw new FactaError("internal_error", "La respuesta del borrador no trae su id y su versión.", 502);
  }
  const draft: Draft = { id: r["borradorId"], state: String(r["estado"] ?? ""), version: r["version"] };
  if (isObject(r["totales"])) draft.totals = r["totales"];
  if (typeof r["codigoGeneracion"] === "string") draft.generationCode = r["codigoGeneracion"];
  if (typeof r["numeroControl"] === "string") draft.controlNumber = r["numeroControl"];
  if (r["estadoDocumento"] !== undefined) draft.documentState = typeof r["estadoDocumento"] === "string" ? r["estadoDocumento"] : null;
  if (typeof r["selloRecibido"] === "boolean") draft.sealed = r["selloRecibido"];
  if (r["emitidoPor"] === "app" || r["emitidoPor"] === "api") draft.issuedBy = r["emitidoPor"];
  if (typeof r["editado"] === "boolean") draft.edited = r["editado"];
  if (r["sobre"] !== undefined) draft.envelope = isObject(r["sobre"]) ? r["sobre"] : null;
  if (isObject(r["contenido"])) draft.content = r["contenido"];
  return draft;
}

export function draftPageOf(payload: unknown): DraftPage {
  const rows = isObject(payload) && Array.isArray(payload["borradores"]) ? payload["borradores"] : [];
  const next = isObject(payload) && typeof payload["siguiente"] === "string" ? payload["siguiente"] : null;
  return { drafts: rows.map(draftOf), next };
}

/** `If-Match` of a draft is its integer version, unquoted or quoted. */
export function draftVersion(version: unknown): number {
  const n = typeof version === "string" && /^\s*"?\d+"?\s*$/.test(version) ? Number(version.replace(/[^\d]/g, "")) : version;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new TypeError("version must be the draft's version number read from the draft (for example 3).");
  }
  return n;
}

/** The `Idempotency-Key` a draft was created with (the API accepts up to 200 characters). */
export function draftKey(key: unknown): string {
  if (typeof key !== "string" || key.trim() === "" || key.length > 200) throw new TypeError("The draft's idempotency key is required (up to 200 characters).");
  return key;
}
