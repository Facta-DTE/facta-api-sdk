// Check digits of the Salvadoran identity numbers, so a typo is caught while the visitor still holds the card.
//
// PORTED (not imported) from the Facta DTE application: `packages/dte-core/src/identity.ts`
// (`duiCheckDigit`, `nitCheckDigit`, `documentProblem`), which cites its sources: the foro publicesvfoxpro
// thread «rutina del dígito verificador NIT y NRC», svcommunity.org, Batressc.SLVDocsValidator and
// guru-soft.com. Verified there against real numbers (`00016297-5`, NITs `…-102-9` and `…-101-6`) and against
// a NIT the Ministry itself called «VALOR NO VALIDO».
//
// The NRC has NO published check-digit algorithm: only its shape is checked (2–8 digits, never all zeros).
// This is a convenience of the form, not a fiscal rule: Hacienda's verdict decides, and is shown as it comes.

/** Everything that is not a digit, gone. */
export const digitsOnly = (value: string): string => value.replace(/[^0-9]/g, "");

/** The check digit a nine-digit DUI must end in: weights 9..2 over the first eight, `(10 - sum mod 10) mod 10`. */
export function duiCheckDigit(value: string): number | null {
  const digits = digitsOnly(value);
  if (digits.length !== 9) return null;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (9 - i);
  return (10 - (sum % 10)) % 10;
}

/**
 * The check digit a fourteen-digit NIT must end in. Two branches chosen by the correlativo (digits 11–13):
 * up to 100 the weight of position i is 15 − i and a 10 is written 0; above 100 the weights are
 * 2,7,6,5,4,3,2,7,6,5,4,3,2 and `dv = r > 1 ? 11 − r : 0`.
 */
export function nitCheckDigit(value: string): number | null {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return null;
  const d = digits.split("").map(Number);
  const correlativo = Number(digits.slice(10, 13));
  let sum = 0;
  if (correlativo <= 100) {
    for (let i = 1; i <= 13; i++) sum += d[i - 1]! * (15 - i);
    const r = sum % 11;
    return r === 10 ? 0 : r;
  }
  for (let i = 1; i <= 13; i++) sum += d[i - 1]! * (3 + 6 * Math.floor((i + 4) / 6) - i);
  const r = sum % 11;
  return r > 1 ? 11 - r : 0;
}

/** CAT-022 codes the form offers. */
export const DOC = { NIT: "36", DUI: "13", OTHER: "37" } as const;

export interface DocumentCheck {
  /** `null` while there is nothing to judge (empty) or the value is fine. */
  problem: string | null;
  /** True when the value is a complete, well-formed document of that type. */
  valid: boolean;
  /** What travels: digits only for a DUI or NIT; the text as typed for «otro». */
  wire: string;
  /** «14 dígitos. Se envía sin guiones: …» — only when valid. */
  note: string | null;
}

/** Judges a typed document number for its CAT-022 type. A typed dash is accepted and removed on the wire. */
export function checkDocument(type: string, raw: string): DocumentCheck {
  const typed = raw.trim();
  if (typed === "") return { problem: null, valid: false, wire: "", note: null };
  const digits = digitsOnly(typed);
  if (type === DOC.DUI || type === DOC.NIT) {
    if (/[^0-9-]/.test(typed)) return { problem: "Use solo dígitos; los guiones se quitan al enviar.", valid: false, wire: digits, note: null };
    if (type === DOC.DUI) {
      if (digits.length !== 9) return { problem: `El DUI debe tener 9 dígitos. Escribió ${digits.length}.`, valid: false, wire: digits, note: null };
      const expected = duiCheckDigit(digits);
      if (expected !== Number(digits[8])) return { problem: `El dígito verificador de este DUI debería ser ${expected}. Revise el número.`, valid: false, wire: digits, note: null };
      return { problem: null, valid: true, wire: digits, note: `9 dígitos. Se envía sin guion: ${digits}` };
    }
    // A NIT homologated with the holder's DUI (nine digits) is checked as a DUI, and travels as nine digits.
    if (digits.length === 9) {
      const expected = duiCheckDigit(digits);
      if (expected !== Number(digits[8])) return { problem: `El dígito verificador de este NIT homologado debería ser ${expected}. Revise el número.`, valid: false, wire: digits, note: null };
      return { problem: null, valid: true, wire: digits, note: `9 dígitos (NIT homologado con el DUI). Se envía sin guion: ${digits}` };
    }
    if (digits.length !== 14) return { problem: `El NIT debe tener 14 dígitos, o 9 si está homologado con el DUI. Escribió ${digits.length}.`, valid: false, wire: digits, note: null };
    const expected = nitCheckDigit(digits);
    if (expected !== Number(digits[13])) return { problem: `El dígito verificador de este NIT debería ser ${expected}. Revise el número.`, valid: false, wire: digits, note: null };
    return { problem: null, valid: true, wire: digits, note: `14 dígitos. Se envía sin guiones: ${digits}` };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(typed)) {
    return { problem: "Entre 3 y 20 letras, números o guiones.", valid: false, wire: typed, note: null };
  }
  return { problem: null, valid: true, wire: typed, note: null };
}

/** NRC: dashes removed, 2–8 digits, never all zeros (the same rule as the server's `normalizeNrc`). */
export function checkNrc(raw: string): { valid: boolean; wire: string; problem: string | null } {
  const typed = raw.trim();
  if (typed === "") return { valid: false, wire: "", problem: null };
  const wire = typed.replace(/-/g, "");
  if (!/^\d{2,8}$/.test(wire) || (typed !== wire && !/^\d{1,7}-\d$/.test(typed))) return { valid: false, wire, problem: "El NRC son de 2 a 8 dígitos (un guion antes del último es opcional)." };
  if (/^0+$/.test(wire)) return { valid: false, wire, problem: "El NRC no puede ser todo ceros." };
  return { valid: true, wire, problem: null };
}

/** Typed dashes read like the card: `0614-170892-101-4`, `05308546-5`; anything else as typed. */
export function displayDocument(type: string, wire: string): string {
  const digits = digitsOnly(wire);
  if (type === DOC.NIT && digits.length === 14) return `${digits.slice(0, 4)}-${digits.slice(4, 10)}-${digits.slice(10, 13)}-${digits.slice(13)}`;
  if ((type === DOC.DUI || type === DOC.NIT) && digits.length === 9) return `${digits.slice(0, 8)}-${digits.slice(8)}`;
  return wire;
}

/** Builds a DUI with a valid check digit from its first eight digits. For presets and tests only. */
export const makeDui = (eight: string): string => `${eight}${duiCheckDigit(`${eight}0`)}`;

/** Builds a NIT with a valid check digit from its first thirteen digits. For presets and tests only. */
export const makeNit = (thirteen: string): string => `${thirteen}${nitCheckDigit(`${thirteen}0`)}`;
