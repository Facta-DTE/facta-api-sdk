// E-mail delivery verdict for the staging live run. Pure: no I/O, no secrets,
// so the run and its tests share one definition.
//
// Running out of e-mail quota, or the mail provider being rate-limited or
// unavailable, is a WARNING. The test invoice is already sealed, delivery never
// changes the fiscal outcome, and a shared quota running dry is not a defect in
// this SDK. Every other delivery failure still fails the run: a rejected
// address or document, a 5xx from the API, a malformed answer, a message that
// went to the wrong recipient, or a channel that never reached a final state.

/** `motivo` codes of a `fallido` e-mail channel that only warn. */
export const EMAIL_LIMIT_REASONS = Object.freeze(["quota_exceeded", "provider_unavailable"]);

const CODE = /^[a-z0-9_]{1,64}$/;
const FINAL_PENDING = new Set(["pendiente", "en_proceso"]);
const MASK_RUN = /[•*]+/g;

/**
 * @typedef {{ outcome: "pass" | "warn" | "fail", code: string, state?: string, status?: number }} EmailDeliveryVerdict
 */

/**
 * Decide the e-mail delivery check from what the run observed.
 * @param {{ channel?: unknown, settled?: boolean, expectedRecipient?: string, error?: unknown }} observed
 *   `channel` is `canales.correo` from `waitForDelivery`, `settled` its flag,
 *   `expectedRecipient` the inbox the run asked for, `error` anything thrown
 *   while starting or reading delivery.
 * @returns {EmailDeliveryVerdict}
 */
export function emailDeliveryVerdict({ channel, settled, expectedRecipient, error } = {}) {
  if (error !== undefined && error !== null) {
    const code = typeof error?.code === "string" && CODE.test(error.code) ? error.code : "delivery_request_failed";
    return { outcome: "fail", code, ...(typeof error?.status === "number" ? { status: error.status } : {}) };
  }
  if (channel === undefined || channel === null) {
    return { outcome: "fail", code: settled === false ? "delivery_timeout" : "delivery_schema_invalid" };
  }
  if (!isRecord(channel) || typeof channel.estado !== "string" || !CODE.test(channel.estado) ||
    (channel.motivo !== undefined && channel.motivo !== null && (typeof channel.motivo !== "string" || !CODE.test(channel.motivo))) ||
    (channel.destino !== undefined && channel.destino !== null && typeof channel.destino !== "string")) {
    return { outcome: "fail", code: "delivery_schema_invalid" };
  }
  const state = channel.estado;
  const reason = typeof channel.motivo === "string" ? channel.motivo : null;
  // A recipient the server reports must be the one we asked for, whatever the state.
  if (expectedRecipient && typeof channel.destino === "string" && channel.destino !== "" &&
    !maskedRecipientMatches(channel.destino, expectedRecipient)) {
    return { outcome: "fail", code: "wrong_recipient", state };
  }
  if (FINAL_PENDING.has(state) || settled === false) return { outcome: "fail", code: "delivery_timeout", state };
  if (state === "enviado") {
    if (expectedRecipient && (typeof channel.destino !== "string" || channel.destino === "")) {
      return { outcome: "fail", code: "wrong_recipient", state };
    }
    return { outcome: "pass", code: "sent", state };
  }
  if (state === "fallido" && reason !== null && EMAIL_LIMIT_REASONS.includes(reason)) {
    return { outcome: "warn", code: reason, state };
  }
  return { outcome: "fail", code: reason ?? state, state };
}

/** The lines a warning prints: a readable one and a GitHub annotation. Codes only, never data. */
export function emailDeliveryWarningLines(verdict) {
  const what = verdict.code === "quota_exceeded"
    ? "the e-mail sending limit was reached (quota_exceeded)"
    : `the mail provider was unavailable or rate-limited (${verdict.code})`;
  const text = `E-mail delivery was not completed: ${what}. The test invoice is sealed; this does not fail the run.`;
  return [`WARNING: ${text}`, `::warning title=E-mail delivery limit::${text}`];
}

/** Report state for a verdict (the report publishes only allowlisted states). */
export function emailDeliveryReportState(verdict) {
  if (verdict.outcome === "pass") return "Passed (e-mail sent)";
  if (verdict.outcome === "warn") {
    return verdict.code === "quota_exceeded" ? "Warning (mail quota reached)" : "Warning (mail provider unavailable)";
  }
  return "Failed";
}

/**
 * Compare a server-masked recipient («m•••@ejemplo.com») with the address
 * asked for. Runs of `•` or `*` stand for any characters; the rest must match,
 * ignoring case.
 */
export function maskedRecipientMatches(masked, address) {
  if (typeof masked !== "string" || typeof address !== "string" || !masked || !address) return false;
  const pattern = masked.split(MASK_RUN).map(escapeRegExp).join(".*");
  return new RegExp(`^${pattern}$`, "i").test(address.trim());
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
