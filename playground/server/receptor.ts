// Typed receivers («Personalizado» in the sale builder): validation and the exact wire
// shapes of src/types.ts. The browser sends loose strings; this module is the only place
// that turns them into a `Recipient`, `ExportRecipient` or `ExcludedSubjectRecipient`.
//
// Rules come from what the SDK documents (docs/react-signing-ui.md §3: «DUI 9 digits, NIT
// 14 digits, NRC digits») and from the CAT-022 labels the SDK ships (`documentTypeLabel`).
// Nothing here knows a fiscal code list: department, municipality, activity and country
// codes are typed by the visitor and Hacienda's verdict decides; the playground shows the
// rejection as it comes. No value is invented or defaulted.

import type { Address, ExcludedSubjectRecipient, ExportRecipient, Recipient } from "../../src/types.ts";

export class ReceptorError extends Error {
  override readonly name = "ReceptorError";
  constructor(readonly code: string, message: string, readonly field?: string) {
    super(message);
  }
}

/** CAT-022 codes the SDK itself labels (`documentTypeLabel`): NIT, DUI and «otro». */
export const DOCUMENT_TYPES = { NIT: "36", DUI: "13", OTHER: "37" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bad(code: string, message: string, field: string): never {
  throw new ReceptorError(code, message, field);
}

/** Trimmed text of a field, or "" when absent. Refuses non-strings and control characters. */
function text(raw: Record<string, unknown>, field: string, label: string, max: number): string {
  const value = raw[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") bad("receptor_invalid", `${label} no es válido.`, field);
  const trimmed = value.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) bad("receptor_invalid", `${label} tiene caracteres que no se aceptan.`, field);
  if (trimmed.length > max) bad("receptor_invalid", `${label} admite hasta ${max} caracteres.`, field);
  return trimmed;
}

function required(raw: Record<string, unknown>, field: string, label: string, max: number): string {
  const value = text(raw, field, label, max);
  if (value === "") bad("receptor_field_required", `${label} es obligatorio para este documento.`, field);
  return value;
}

/** DUI: 9 digits on the wire. A typed dash (`04829316-5`) is accepted and removed. */
export function normalizeDui(value: string): string | null {
  const digits = value.replace(/-/g, "");
  return /^\d{9}$/.test(digits) && (value === digits || /^\d{8}-\d$/.test(value)) ? digits : null;
}

/** NIT: 14 digits on the wire. Typed dashes (`0614-210389-102-4`) are accepted and removed. */
export function normalizeNit(value: string): string | null {
  const digits = value.replace(/-/g, "");
  return /^\d{14}$/.test(digits) && (value === digits || /^\d{4}-\d{6}-\d{3}-\d$/.test(value)) ? digits : null;
}

/** NRC: 2–8 digits, never all zeros. */
export function normalizeNrc(value: string): string | null {
  const digits = value.replace(/-/g, "");
  if (!/^\d{2,8}$/.test(digits) || (value !== digits && !/^\d{1,7}-\d$/.test(value))) return null;
  return /^0+$/.test(digits) ? null : digits;
}

/** The identity document: its type decides the format. Returns the pair as it travels. */
function identity(raw: Record<string, unknown>, allowed: readonly string[], label: string): { tipoDocumento: string; numDocumento: string } {
  const tipoDocumento = required(raw, "tipoDocumento", "El tipo de documento", 2);
  if (!allowed.includes(tipoDocumento)) bad("document_type_invalid", "Elija DUI, NIT u otro documento de la lista.", "tipoDocumento");
  const given = required(raw, "numDocumento", label, 40);
  if (tipoDocumento === DOCUMENT_TYPES.DUI) {
    const dui = normalizeDui(given);
    if (dui === null) bad("dui_invalid", "El DUI debe tener 9 dígitos (se envía sin guion).", "numDocumento");
    return { tipoDocumento, numDocumento: dui };
  }
  if (tipoDocumento === DOCUMENT_TYPES.NIT) {
    const nit = normalizeNit(given);
    if (nit === null) bad("nit_invalid", "El NIT debe tener 14 dígitos.", "numDocumento");
    return { tipoDocumento, numDocumento: nit };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(given)) bad("document_invalid", "El documento debe tener entre 3 y 20 letras, números o guiones.", "numDocumento");
  return { tipoDocumento, numDocumento: given };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(raw: Record<string, unknown>, mandatory: boolean): string | undefined {
  const value = mandatory ? required(raw, "correo", "El correo", 100) : text(raw, "correo", "El correo", 100);
  if (value === "") return undefined;
  if (!EMAIL.test(value)) bad("email_invalid", "El correo no tiene un formato válido.", "correo");
  return value;
}

function phone(raw: Record<string, unknown>): string | undefined {
  const value = text(raw, "telefono", "El teléfono", 30);
  if (value === "") return undefined;
  if (!/^[0-9+() -]{8,30}$/.test(value)) bad("phone_invalid", "El teléfono debe tener entre 8 y 30 dígitos, espacios o guiones.", "telefono");
  return value;
}

function activityCode(raw: Record<string, unknown>, mandatory: boolean): string | undefined {
  const value = mandatory ? required(raw, "codActividad", "El código de actividad", 6) : text(raw, "codActividad", "El código de actividad", 6);
  if (value === "") return undefined;
  if (!/^\d{2,6}$/.test(value)) bad("activity_invalid", "El código de actividad son solo dígitos (de 2 a 6).", "codActividad");
  return value;
}

/** Department and municipality are typed as their two-digit codes; Hacienda validates the pair. */
function address(raw: Record<string, unknown>, mandatory: boolean): Address | undefined {
  const source = isRecord(raw.direccion) ? raw.direccion : {};
  const departamento = text(source, "departamento", "El departamento", 2);
  const municipio = text(source, "municipio", "El municipio", 2);
  const complemento = text(source, "complemento", "La dirección", 200);
  if (departamento === "" && municipio === "" && complemento === "") {
    if (mandatory) bad("receptor_field_required", "La dirección es obligatoria para este documento.", "direccion");
    return undefined;
  }
  if (!/^\d{2}$/.test(departamento)) bad("address_invalid", "El departamento se escribe con su código de 2 dígitos.", "direccion.departamento");
  if (!/^\d{2}$/.test(municipio)) bad("address_invalid", "El municipio se escribe con su código de 2 dígitos.", "direccion.municipio");
  if (complemento === "") bad("address_invalid", "Escriba la dirección (calle, colonia, número).", "direccion.complemento");
  return { departamento, municipio, complemento };
}

/** Removes `undefined` so the signed session carries only what the visitor typed. */
function compact<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Factura (01): a name is the only requirement; a document and an address are optional. */
function factura(raw: Record<string, unknown>): Recipient {
  const nombre = required(raw, "nombre", "El nombre", 100);
  const hasDocument = text(raw, "tipoDocumento", "El tipo de documento", 2) !== "" || text(raw, "numDocumento", "El documento", 40) !== "";
  const document = hasDocument ? identity(raw, [DOCUMENT_TYPES.DUI, DOCUMENT_TYPES.NIT, DOCUMENT_TYPES.OTHER], "El número de documento") : undefined;
  return compact<Recipient>({ nombre, ...document, direccion: address(raw, false), correo: email(raw, false), telefono: phone(raw) });
}

/** CCF (03) and notes (05/06): a contribuyente, with every identity field. */
function taxpayer(raw: Record<string, unknown>): Recipient {
  const nombre = required(raw, "nombre", "El nombre", 100);
  const document = identity(raw, [DOCUMENT_TYPES.NIT, DOCUMENT_TYPES.DUI], "El NIT o DUI");
  const nrcText = required(raw, "nrc", "El NRC", 10);
  const nrc = normalizeNrc(nrcText);
  if (nrc === null) bad("nrc_invalid", "El NRC debe tener de 2 a 8 dígitos y no puede ser solo ceros.", "nrc");
  const codActividad = activityCode(raw, true);
  const descActividad = required(raw, "descActividad", "La descripción de la actividad", 150);
  return compact<Recipient>({
    nombre,
    ...document,
    nrc,
    codActividad,
    descActividad,
    direccion: address(raw, true),
    correo: email(raw, true),
    telefono: phone(raw),
    nombreComercial: text(raw, "nombreComercial", "El nombre comercial", 150) || undefined,
  });
}

/** Factura de exportación (11): the foreign receiver's own fields. */
function exportReceiver(raw: Record<string, unknown>): ExportRecipient {
  const nombre = required(raw, "nombre", "El nombre", 100);
  const numDocumento = required(raw, "numDocumento", "El documento", 20);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(numDocumento)) bad("document_invalid", "El documento debe tener entre 3 y 20 letras, números o guiones.", "numDocumento");
  const codPais = required(raw, "codPais", "El código de país", 10).toUpperCase();
  if (!/^[A-Z]{2}$/.test(codPais)) bad("country_invalid", "El código de país son 2 letras (por ejemplo US).", "codPais");
  const nombrePais = required(raw, "nombrePais", "El nombre del país", 60);
  const complemento = required(raw, "complemento", "La dirección", 200);
  const tipoPersona = raw.tipoPersona;
  if (tipoPersona !== 1 && tipoPersona !== 2) bad("receptor_field_required", "Elija si el receptor es persona natural o jurídica.", "tipoPersona");
  const descActividad = required(raw, "descActividad", "La actividad económica", 150);
  const correo = email(raw, true)!;
  const telefono = phone(raw);
  return compact<ExportRecipient>({
    nombre,
    numDocumento,
    codPais,
    nombrePais,
    complemento,
    tipoPersona,
    descActividad,
    correo,
    ...(telefono === undefined ? {} : { telefono }),
  });
}

/** Factura de sujeto excluido (14): the supplier, who is not a contribuyente (no NRC). */
function excludedSubject(raw: Record<string, unknown>): ExcludedSubjectRecipient {
  const nombre = required(raw, "nombre", "El nombre", 100);
  const document = identity(raw, [DOCUMENT_TYPES.NIT, DOCUMENT_TYPES.DUI, DOCUMENT_TYPES.OTHER], "El número de documento");
  const direccion = address(raw, true)!;
  return compact<ExcludedSubjectRecipient>({
    ...document,
    nombre,
    direccion,
    codActividad: activityCode(raw, false),
    correo: email(raw, false),
    telefono: phone(raw),
  });
}

/** Build the receiver a visitor typed for `type`. Throws `ReceptorError`. */
export function buildCustomReceptor(type: string, raw: unknown): Recipient | ExportRecipient | ExcludedSubjectRecipient {
  if (!isRecord(raw)) throw new ReceptorError("receptor_invalid", "El receptor no es válido.");
  switch (type) {
    case "01": return factura(raw);
    case "03":
    case "05":
    case "06": return taxpayer(raw);
    case "11": return exportReceiver(raw);
    case "14": return excludedSubject(raw);
    default: throw new ReceptorError("type_unsupported", "Ese tipo de documento todavía no está disponible en el playground.");
  }
}
