// The error the SDK throws, and the only thing a caller should switch on.
//
// Server error codes follow openapi.yaml; the SDK also adds local transport
// and archive-recovery codes. `message` is Spanish prose meant for a human
// reading a log and may be rewritten at any time. A client that branches on
// the message is a client that breaks on a typo fix.

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
  | "validation_failed"
  | "not_found"
  | "method_not_allowed"
  | "idempotency_key_required"
  | "idempotency_key_reuse"
  | "idempotency_in_flight"
  | "prepare_token_invalid"
  | "rate_limited"
  | "amount_limit"
  | "mh_rejected"
  | "mh_unreachable"
  | "correlative_unavailable"
  | "service_unavailable"
  | "no_storage_destination"
  | "storage_unsupported"
  | "storage_unavailable"
  | "storage_contract_invalid"
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

  /** What Hacienda said, word for word, when it refused. */
  get mhObservations(): string[] {
    const details = this.details as Record<string, unknown> | null | undefined;
    const raw = details?.["observaciones"];
    return Array.isArray(raw) ? raw.map(String) : [];
  }
}
