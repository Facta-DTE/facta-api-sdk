// The custom receiver, as data: which fields each document type reads, what it needs before the sale can be
// prepared, and the exact JSON the page sends (`receptor.custom`). No React in here, so it is unit-tested.
//
// The rules are the ones server/receptor.ts already enforces (it stays the authority; this file only mirrors them
// so the form can say what is missing BEFORE the visitor presses «Preparar la venta»):
//   01  a name is the only requirement; a document and an address are optional but must be complete if started.
//   03 05 06  contribuyente: name, NIT or DUI, NRC, activity (code + text), full address, e-mail.
//   11  foreign receiver: name, document, country (code + name), address abroad, tipo de persona, activity, e-mail.
//   14  excluded subject: name, document, full address; activity code and e-mail optional.

import { checkDocument, checkNrc, displayDocument, DOC } from "./identity.ts";

export type Typed = Record<string, string>;

const ALL_DOCS = [["13", "DUI"], ["36", "NIT"], ["37", "Otro documento"]] as const;
/** Document types each type accepts for a typed receiver (CAT-022). Same rules as the server's `identity()` calls. */
export const DOCS: Record<string, readonly (readonly [string, string])[]> = {
  "01": ALL_DOCS,
  "03": [["36", "NIT"], ["13", "DUI"]],
  "05": [["36", "NIT"], ["13", "DUI"]],
  "06": [["36", "NIT"], ["13", "DUI"]],
  "14": ALL_DOCS,
};
export const TAXPAYER = new Set(["03", "05", "06"]);

/** What the visitor sees when they have not chosen: NIT for a contribuyente, DUI for a supplier, nothing for a Factura. */
export const defaultDocType = (type: string): string => (TAXPAYER.has(type) ? DOC.NIT : type === "14" ? DOC.DUI : "");

/** The document type in force: the chosen one, else the type's default. */
export const docTypeOf = (type: string, f: Typed): string => (f.tipoDocumento ?? "") !== "" ? f.tipoDocumento! : defaultDocType(type);

/** The keys each type reads: anything else the visitor typed under another type is not sent. */
const KEYS: Record<string, readonly string[]> = {
  "01": ["nombre", "tipoDocumento", "numDocumento", "correo", "telefono"],
  "03": ["nombre", "tipoDocumento", "numDocumento", "nrc", "nombreComercial", "codActividad", "descActividad", "correo", "telefono"],
  "11": ["nombre", "numDocumento", "codPais", "nombrePais", "complemento", "descActividad", "correo", "telefono"],
  "14": ["nombre", "tipoDocumento", "numDocumento", "codActividad", "correo", "telefono"],
};
const keysOf = (type: string): readonly string[] => KEYS[TAXPAYER.has(type) ? "03" : type] ?? KEYS["01"]!;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+() -]{8,30}$/;
const clean = (value: string | undefined): string => (value ?? "").trim();

/** The wire value of one key: dashes out of DUI, NIT, NRC and phone. */
function wireOf(type: string, key: string, f: Typed): string {
  const value = clean(f[key]);
  if (value === "") return "";
  if (key === "numDocumento" && type !== "11") {
    const check = checkDocument(docTypeOf(type, f), value);
    return check.wire;
  }
  if (key === "nrc") return checkNrc(value).wire;
  if (key === "telefono") return value.replace(/[\s()-]/g, "");
  if (key === "codPais") return value.toUpperCase();
  return value;
}

/** The typed fields as the API wants them: empty strings dropped, the address grouped, dashes out of identifiers. */
export function typedReceptor(type: string, f: Typed): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keysOf(type)) {
    const value = wireOf(type, key, f);
    if (value !== "") out[key] = value;
  }
  // The document type travels with its number, including the one the form showed by default.
  if (type !== "11" && out.numDocumento !== undefined && out.tipoDocumento === undefined) out.tipoDocumento = docTypeOf(type, f);
  if (type === "11" && f.tipoPersona) out.tipoPersona = Number(f.tipoPersona);
  if (type !== "11" && [f.departamento, f.municipio, f.direccion].some((v) => clean(v) !== "")) {
    out.direccion = { departamento: clean(f.departamento), municipio: clean(f.municipio), complemento: clean(f.direccion) };
  }
  return out;
}

/** True when nothing the type reads has been typed. */
export const isEmptyForm = (type: string, f: Typed): boolean => Object.keys(typedReceptor(type, f)).length === 0;

export interface Requirement {
  id: string;
  label: string;
  /** Said next to a pending item. */
  hint?: string;
  ok: boolean;
}

export interface Checklist {
  /** «un crédito fiscal»: completes «Lo que pide …». */
  title: string;
  items: Requirement[];
  missing: number;
  /** Factura with nothing typed: it goes out to «Consumidor final». */
  consumerFinal: boolean;
}

const TITLES: Record<string, string> = {
  "01": "una factura",
  "03": "un crédito fiscal",
  "05": "una nota de crédito",
  "06": "una nota de débito",
  "11": "una factura de exportación",
  "14": "una factura de sujeto excluido",
};

/** What a type asks of its receiver, ticked against what was typed. */
export function receptorChecklist(type: string, f: Typed): Checklist {
  const has = (key: string) => clean(f[key]) !== "";
  const docType = docTypeOf(type, f);
  const doc = checkDocument(docType, clean(f.numDocumento));
  const addressStarted = has("departamento") || has("municipio") || has("direccion");
  const addressDone = has("departamento") && has("municipio") && has("direccion");
  const emailOk = EMAIL.test(clean(f.correo));
  const items: Requirement[] = [];
  const add = (id: string, label: string, ok: boolean, hint?: string) => items.push({ id, label, ok, ...(hint === undefined ? {} : { hint }) });
  const empty = isEmptyForm(type, f);

  if (type === "01") {
    add("nombre", "Nombre", empty || has("nombre"), "solo si da otros datos");
    add("documento", "Documento completo", !has("numDocumento") || doc.valid, "si lo escribe, que sea válido");
    add("direccion", "Dirección completa", !addressStarted || addressDone, "si empieza una, que esté entera");
    if (has("correo")) add("correo", "Correo con formato válido", emailOk);
  } else if (TAXPAYER.has(type)) {
    add("nombre", "Nombre", has("nombre"));
    add("documento", "NIT válido (o DUI de 9 dígitos)", doc.valid);
    add("nrc", "NRC", checkNrc(clean(f.nrc)).valid);
    add("actividad", "Actividad económica", has("codActividad") && has("descActividad"), "elija una de la lista");
    add("direccion", "Departamento, municipio y dirección", addressDone);
    add("correo", "Correo", emailOk);
  } else if (type === "11") {
    add("nombre", "Nombre", has("nombre"));
    add("documento", "Documento del receptor", doc.valid || (docType === "" && /^[A-Za-z0-9][A-Za-z0-9-]{2,19}$/.test(clean(f.numDocumento))));
    add("pais", "País", has("codPais") && has("nombrePais"), "elija uno de la lista");
    add("direccion", "Dirección en el extranjero", has("complemento"));
    add("persona", "Tipo de persona", f.tipoPersona === "1" || f.tipoPersona === "2");
    add("actividad", "Actividad económica", has("descActividad"));
    add("correo", "Correo", emailOk);
  } else {
    add("nombre", "Nombre", has("nombre"));
    add("documento", "Documento (DUI, NIT u otro)", doc.valid);
    add("direccion", "Departamento, municipio y dirección", addressDone);
    if (has("correo")) add("correo", "Correo con formato válido", emailOk);
  }
  if (has("telefono") && !PHONE.test(clean(f.telefono))) add("telefono", "Teléfono con formato válido", false, "de 8 a 30 dígitos, espacios o guiones");
  return { title: TITLES[type] ?? "este documento", items, missing: items.filter((i) => !i.ok).length, consumerFinal: type === "01" && empty };
}

/** «Falta 1 dato.» / «Faltan 3 datos.» */
export const missingText = (missing: number): string => (missing === 1 ? "Falta 1 dato." : `Faltan ${missing} datos.`);

/** One line of the JSON preview: a value, or a comment where something required is still missing. */
export interface PreviewLine {
  indent: number;
  key: string | null;
  value: string | null;
  comment?: string;
  /** `{` opens a nested object, `}` closes it. */
  brace?: "{" | "}";
  /** A trailing comma: another member follows at the same level. */
  comma?: boolean;
}

/**
 * The preview of `receptor.custom`, key by key, in the order the API documents them. A required key with no
 * value shows as «// falta» so the visitor sees what the checklist is asking for.
 */
export function previewLines(type: string, f: Typed): PreviewLine[] {
  const wire = typedReceptor(type, f);
  if (receptorChecklist(type, f).consumerFinal) return [{ indent: 0, key: null, value: null, comment: "// sin receptor: sale a nombre de «Consumidor final»" }];
  const requiredKeys: Record<string, string[]> = {
    "01": [],
    "03": ["nombre", "numDocumento", "nrc", "codActividad", "descActividad", "correo"],
    "11": ["nombre", "numDocumento", "codPais", "nombrePais", "complemento", "tipoPersona", "descActividad", "correo"],
    "14": ["nombre", "numDocumento"],
  };
  const required = new Set(requiredKeys[TAXPAYER.has(type) ? "03" : type] ?? []);
  if (type === "01" && wire.numDocumento !== undefined) required.add("numDocumento");
  const order = type === "11"
    ? ["nombre", "numDocumento", "codPais", "nombrePais", "complemento", "tipoPersona", "descActividad", "correo", "telefono"]
    : TAXPAYER.has(type)
      ? ["nombre", "tipoDocumento", "numDocumento", "nrc", "codActividad", "descActividad", "nombreComercial", "direccion", "correo", "telefono"]
      : ["nombre", "tipoDocumento", "numDocumento", "codActividad", "direccion", "correo", "telefono"];
  const lines: PreviewLine[] = [];
  const addressRequired = TAXPAYER.has(type) || type === "14";
  const show = (key: string) => (key === "direccion" ? wire.direccion !== undefined || addressRequired : wire[key] !== undefined || required.has(key));
  for (const key of order) {
    if (!show(key)) continue;
    if (key === "direccion") {
      const address = wire.direccion as { departamento: string; municipio: string; complemento: string } | undefined;
      lines.push({ indent: 1, key, value: null, brace: "{" });
      for (const part of ["departamento", "municipio", "complemento"] as const) {
        const value = address?.[part] ?? "";
        lines.push(value === "" ? { indent: 2, key: part, value: null, comment: "// falta" } : { indent: 2, key: part, value: JSON.stringify(value) });
      }
      lines.push({ indent: 1, key: null, value: null, brace: "}" });
      continue;
    }
    const value = wire[key];
    lines.push(value === undefined ? { indent: 1, key, value: null, comment: "// falta" } : { indent: 1, key, value: JSON.stringify(value) });
  }
  // A comma after every member (or closing brace) that another member of the same object follows.
  lines.forEach((line, index) => {
    const closes = line.brace === "}";
    if (line.comment !== undefined || line.brace === "{" || (line.key === null && !closes)) return;
    const level = line.indent;
    for (let i = index + 1; i < lines.length; i++) {
      const next = lines[i]!;
      if (next.indent < level) break;
      if (next.indent === level && (next.key !== null)) { line.comma = true; break; }
    }
  });
  return lines;
}

/** How a stored document number reads on screen: `0614-170892-101-1`. */
export const documentOnScreen = (type: string, f: Typed): string => displayDocument(docTypeOf(type, f), clean(f.numDocumento));
