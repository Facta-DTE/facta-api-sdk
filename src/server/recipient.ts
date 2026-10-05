// Light shape checks for what the browser may supply (docs/react-signing-ui.md §3.3).
//
// The API is the fiscal authority. This file only refuses input that cannot be
// right (a DUI with eight digits) so the person learns it before a correlative
// is reserved. It never computes an amount.

import type { DteType, Recipient } from "../types.ts";
import type { FactaRecipientPolicy, FactaSessionAllow } from "./session.ts";

export type RecipientFieldErrorCode = "required" | "invalid" | "too_long" | "not_allowed" | "unsupported";

export interface RecipientFieldError {
  field: string;
  code: RecipientFieldErrorCode;
}

/** The only fields that ever travel from the browser into the fiscal request. */
export interface NormalizedRecipient {
  nombre?: string;
  tipoDocumento?: "13" | "36";
  numDocumento?: string;
  nrc?: string;
  codActividad?: string;
  descActividad?: string;
  correo?: string;
}

export type RecipientResult =
  | { ok: true; recipient: NormalizedRecipient | null }
  | { ok: false; errors: RecipientFieldError[] };

export type TipoDteResult =
  | { ok: true; tipoDte: DteType }
  | { ok: false; errors: RecipientFieldError[] };

const DTE_TYPES: readonly string[] = ["01", "03", "05", "06", "11", "14"];
/** Types whose `receptor` is the plain {@link Recipient} the window edits. */
const EDITABLE_TYPES: readonly string[] = ["01", "03", "05", "06"];

function text(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null; // present but the wrong type
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalise the browser-supplied recipient.
 *
 * `base` is the receptor already in the session request (it may carry a
 * `customerId`, which stands in for every field a credit invoice requires).
 */
export function validateRecipient(
  input: unknown,
  ctx: { tipoDte: DteType; policy: FactaRecipientPolicy; base?: Recipient | null },
): RecipientResult {
  const absent = input === undefined || input === null;
  if (ctx.policy === "none") {
    return absent ? { ok: true, recipient: null } : { ok: false, errors: [{ field: "recipient", code: "not_allowed" }] };
  }
  if (!EDITABLE_TYPES.includes(ctx.tipoDte)) {
    return absent ? { ok: true, recipient: null } : { ok: false, errors: [{ field: "recipient", code: "unsupported" }] };
  }
  if (!absent && (typeof input !== "object" || Array.isArray(input))) {
    return { ok: false, errors: [{ field: "recipient", code: "invalid" }] };
  }
  const raw = (absent ? {} : input) as Record<string, unknown>;
  const errors: RecipientFieldError[] = [];
  const out: NormalizedRecipient = {};
  const credit = ctx.tipoDte === "03";
  const catalogued = typeof ctx.base?.customerId === "string";
  const inBase = (field: keyof Recipient): boolean => {
    const v = ctx.base?.[field];
    return typeof v === "string" && v.trim() !== "";
  };

  const nombre = text(raw.nombre);
  if (nombre === null) errors.push({ field: "nombre", code: "invalid" });
  else if (nombre !== undefined) {
    if (nombre.length > 200) errors.push({ field: "nombre", code: "too_long" });
    else out.nombre = nombre;
  }

  const tipoRaw = text(raw.tipoDocumento);
  const numRaw = text(raw.numDocumento);
  if (tipoRaw === null) errors.push({ field: "tipoDocumento", code: "invalid" });
  else if (tipoRaw !== undefined && tipoRaw !== "13" && tipoRaw !== "36") {
    errors.push({ field: "tipoDocumento", code: "invalid" });
  }
  if (numRaw === null) errors.push({ field: "numDocumento", code: "invalid" });
  if (numRaw !== undefined && numRaw !== null && tipoRaw === undefined) {
    errors.push({ field: "tipoDocumento", code: "required" });
  } else if (tipoRaw === "13" || tipoRaw === "36") {
    if (numRaw === undefined) errors.push({ field: "numDocumento", code: "required" });
    else if (numRaw !== null) {
      const digits = numRaw.replace(/[\s-]/g, "");
      const ok = tipoRaw === "13" ? /^\d{9}$/.test(digits) : /^\d{14}$/.test(digits);
      if (ok) {
        out.tipoDocumento = tipoRaw;
        out.numDocumento = digits;
      } else errors.push({ field: "numDocumento", code: "invalid" });
    }
  }

  const correo = text(raw.correo);
  if (correo === null) errors.push({ field: "correo", code: "invalid" });
  else if (correo !== undefined) {
    if (correo.length > 100) errors.push({ field: "correo", code: "too_long" });
    else if (!EMAIL.test(correo)) errors.push({ field: "correo", code: "invalid" });
    else out.correo = correo;
  }

  // Credit-invoice-only fields: ignored for any other type, never forwarded.
  if (credit) {
    const nrcRaw = text(raw.nrc);
    if (nrcRaw === null) errors.push({ field: "nrc", code: "invalid" });
    else if (nrcRaw !== undefined) {
      const digits = nrcRaw.replace(/[\s-]/g, "");
      if (/^\d{1,8}$/.test(digits)) out.nrc = digits;
      else errors.push({ field: "nrc", code: "invalid" });
    }
    const cod = text(raw.codActividad);
    if (cod === null) errors.push({ field: "codActividad", code: "invalid" });
    else if (cod !== undefined) {
      if (/^\d{4,6}$/.test(cod)) out.codActividad = cod;
      else errors.push({ field: "codActividad", code: "invalid" });
    }
    const desc = text(raw.descActividad);
    if (desc === null) errors.push({ field: "descActividad", code: "invalid" });
    else if (desc !== undefined) {
      if (desc.length > 150) errors.push({ field: "descActividad", code: "too_long" });
      else out.descActividad = desc;
    }
  }

  const supplied = Object.keys(out).length > 0;
  const needName = ctx.policy === "required" || supplied || credit;
  if (needName && out.nombre === undefined && !inBase("nombre") && !errors.some((e) => e.field === "nombre") && !(catalogued && !supplied)) {
    errors.push({ field: "nombre", code: "required" });
  }
  if (credit && !catalogued) {
    for (const field of ["tipoDocumento", "numDocumento", "nrc", "codActividad", "descActividad", "correo"] as const) {
      if (out[field] === undefined && !inBase(field) && !errors.some((e) => e.field === field)) {
        errors.push({ field, code: "required" });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, recipient: supplied ? out : null };
}

/** Decide the document type: the browser's choice only if the session allows it. */
export function resolveTipoDte(input: unknown, allow: FactaSessionAllow, sessionTipo: DteType): TipoDteResult {
  if (input === undefined || input === null) return { ok: true, tipoDte: sessionTipo };
  if (typeof input !== "string" || !DTE_TYPES.includes(input)) {
    return { ok: false, errors: [{ field: "tipoDte", code: "invalid" }] };
  }
  if (input === sessionTipo) return { ok: true, tipoDte: sessionTipo };
  if (!allow.types?.includes(input as DteType)) {
    return { ok: false, errors: [{ field: "tipoDte", code: "not_allowed" }] };
  }
  return { ok: true, tipoDte: input as DteType };
}

/** Browser fields win over the session's own receptor, field by field. */
export function mergeRecipient(base: Recipient | null | undefined, recipient: NormalizedRecipient | null): Recipient | null | undefined {
  if (recipient === null) return base;
  return { ...(base ?? {}), ...recipient };
}
