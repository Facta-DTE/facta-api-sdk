// The error the SDK throws, and the only thing a caller should switch on.
//
// Server error codes follow openapi.yaml; the SDK also adds local transport
// and archive-recovery codes. `message` is Spanish prose meant for a human
// reading a log and may be rewritten at any time. A client that branches on
// the message is a client that breaks on a typo fix.

import { unknownFieldWarnings } from "./warnings.ts";
import type { UnknownFieldWarning } from "./types.ts";

export type FactaErrorCode =
  | "unauthorized"
  | "invalid_api_key"
  | "key_revoked"
  | "key_expired"
  | "key_inactive"
  | "forbidden_scope"
  | "dte_type_not_allowed"
  | "ip_not_allowed"
  | "environment_not_allowed"
  // The second factor: the password that opens the signing vault.
  | "sign_key_required"
  | "sign_key_invalid"
  | "sign_vault_locked"
  | "sign_vault_missing"
  | "invalid_request"
  /** `listDocuments({ include: ["dte"] })` asked for more than 25 rows (HTTP 400). `details.maximo` is the cap. */
  | "include_limit_exceeded"
  | "validation_failed"
  /** `aplicarReteRenta` on a document with an `exenta` or `no_sujeta` line (HTTP 422). Nothing was signed and no number spent. */
  | "retention_mixed_class_unsupported"
  | "not_found"
  | "method_not_allowed"
  /** JSON download of a document that has no Hacienda seal yet, e.g. contingency (HTTP 409). Retry with `raw: true` for the original. */
  | "not_sealed"
  /** The company did not enable «Permitir administrar clientes y productos desde el API» (HTTP 403). */
  | "catalog_write_disabled"
  /** The company catalog is still encrypted, so the API cannot write it (HTTP 409). */
  | "catalog_encrypted"
  /** A customer with that document, or a product with that code, already exists (HTTP 409). */
  | "catalog_duplicate"
  /** The record changed since `If-Match` (HTTP 409); `details.revisionActual` carries the current revision. */
  | "catalog_revision_conflict"
  /** An edit of an inactive record without `activo: true` (HTTP 409). */
  | "catalog_record_inactive"
  /** A `buscar` over more rows than the server searches in memory (HTTP 422); use the document filter. */
  | "catalog_search_too_broad"
  /** A catalogue cursor that expired (HTTP 410); read from the start. */
  | "catalog_cursor_expired"
  /** The shared data grant could not be opened by the server (HTTP 503); retry later. */
  | "data_grant_unavailable"
  /** The key's data grant was revoked (HTTP 403). */
  | "data_grant_revoked"
  /** The company's data key is rotating (HTTP 503); retry shortly. */
  | "data_epoch_stale"
  /** The key already holds the most webhooks it may (5) (HTTP 409). */
  | "webhook_limit_reached"
  /** A webhook with that URL already exists on this key (HTTP 409). */
  | "webhook_duplicate"
  /** The sealed catalogue inbox routes were retired (HTTP 410). Write the catalogue with `createCustomer` and friends. */
  | "inbox_retired"
  /** A test key tried to write the catalogue after the company went live (HTTP 403). */
  | "catalog_write_test_key"
  /** An extra company of a Multiempresa owner on a free or trial plan, issuing in production (HTTP 402). */
  | "paid_plan_required"
  /** Hacienda answered the login and refused the company's API credentials (HTTP 424); the owner fixes them, retrying cannot. */
  | "mh_auth_failed"
  // Google Drive token broker (`GET`/`POST /v1/destinations/{id}/drive-token`).
  | "drive_not_configured"
  | "drive_reauthorization_required"
  | "drive_token_failed"
  /** Drive does not count as API storage (HTTP 403); use Facta Storage or another destination. */
  | "drive_not_available_for_api"
  // Drafts (scope `draft`).
  /** The company has no draft-box key yet (HTTP 409): its owner opens Facta with their vault once, then it works. */
  | "drafts_not_ready"
  /** The plaintext of a legacy sealed draft did not hash to `contentHash` (HTTP 422). */
  | "content_hash_mismatch"
  /** That draft id is already taken by another item (HTTP 409). */
  | "id_conflict"
  /** The draft is already resolved (HTTP 409). */
  | "item_final"
  /** A person of the company has the draft open (HTTP 409); nothing was spent. */
  | "draft_claimed"
  /** The draft is being issued right now (HTTP 409); nothing was spent. */
  | "draft_issuing"
  /** The draft was already issued (HTTP 409). */
  | "draft_issued"
  /** The draft cannot be issued in its state (HTTP 409). */
  | "draft_not_issuable"
  /** The `version` sent is not the draft's current one (HTTP 409); read it again. */
  | "version_mismatch"
  /** A per-key or per-company cap of drafts (HTTP 429). */
  | "inbox_cap_reached"
  | "idempotency_key_required"
  | "idempotency_key_reuse"
  | "idempotency_in_flight"
  /** `retryDocument()` on a document the API cannot finish (HTTP 409); `details.motivo` says why. */
  | "document_not_retryable"
  /** Another retry of the same document is running (HTTP 409); wait `retryAfterSeconds`. */
  | "retry_in_progress"
  | "prepare_token_invalid"
  // Returns (Evento de Retorno). `details.lineas` names each offending line, from 1.
  | "return_exceeds_available"
  | "return_window_closed"
  | "return_type_not_allowed"
  | "return_pdf_unavailable"
  /** `invalidate` on a document that already has returns (HTTP 409). */
  | "has_return_events"
  | "rate_limited"
  | "amount_limit"
  | "mh_rejected"
  | "mh_unreachable"
  | "correlative_unavailable"
  | "service_unavailable"
  | "no_storage_destination"
  | "storage_unsupported"
  /** The temporary encrypted copy was deleted (HTTP 410): 2 days after the document was marked stored, or 30 days after sealing. Look in your own storage. */
  | "temporary_copy_expired"
  /** `retryDocumentStorage` after the temporary copy was deleted (HTTP 409): Facta has nothing left to rewrite from. */
  | "nothing_to_repair_from"
  /** The `sha256` of a storage confirmation is not the one of that document's JSON (HTTP 422); nothing was recorded. */
  | "storage_hash_mismatch"
  | "storage_unavailable"
  | "storage_contract_invalid"
  // Delivery by e-mail / WhatsApp (docs/api-delivery-tokens.md §3.3).
  /** The five-minute delivery token expired (HTTP 410). The channel state becomes `vencido`. */
  | "entrega_vencida"
  | "entrega_token_invalido"
  /** The issue request did not mark this channel. */
  | "canal_no_marcado"
  | "internal_error"
  /** A fiscal invalidation may have completed, but its signed event was not recoverable. */
  | "operation_outcome_unknown"
  /** Local encrypted archive data failed an identity or digest check. */
  | "archive_integrity_error"
  /** Not from the server: the request never got an answer. */
  | "network_error";

export interface SpentCorrelative {
  codigoGeneracion: string;
  numeroControl: string;
}

export class FactaError extends Error {
  override readonly name = "FactaError";
  readonly code: FactaErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: FactaErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * True when Hacienda READ the document and refused it — as opposed to the
   * request never getting there. The difference decides what to do next: a
   * rejection is fixed by changing the data, an outage by waiting.
   */
  get isRejection(): boolean {
    return this.code === "mh_rejected";
  }

  /**
   * The correlative this failure already burned, when there is one.
   *
   * Only a rejection has it. It matters because §167 of the normativa lets the
   * corrected document reuse that same number and generation code — so the
   * integrator has to be able to read it off the error.
   */
  get spent(): SpentCorrelative | null {
    const details = this.details as Record<string, unknown> | null | undefined;
    const cg = details?.["codigoGeneracion"];
    const nc = details?.["numeroControl"];
    if (typeof cg !== "string" || typeof nc !== "string") return null;
    return { codigoGeneracion: cg, numeroControl: nc };
  }

  /**
   * The `campo_desconocido` warnings the server attached to this failure (`details.advertencias`): request
   * fields Facta DTE ignored. Empty when there are none. Unknown fields are warnings, never errors.
   */
  get unknownFields(): UnknownFieldWarning[] {
    return unknownFieldWarnings(this.details);
  }

  /** Seconds the server asks you to wait (`details.retryAfterSeconds`, the `Retry-After` header's twin), or null. */
  get retryAfterSeconds(): number | null {
    const details = this.details as Record<string, unknown> | null | undefined;
    const raw = details?.["retryAfterSeconds"];
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  /** What Hacienda said, word for word, when it refused. */
  get mhObservations(): string[] {
    const details = this.details as Record<string, unknown> | null | undefined;
    const raw = details?.["observaciones"];
    return Array.isArray(raw) ? raw.map(String) : [];
  }
}
