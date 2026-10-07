// Catalog writes: what the SDK checks before it sends, and how it reads what
// comes back. The server is the authority; every check here is one the server
// also makes, so a record the SDK refuses is a record the server would refuse.
// When in doubt a rule is left out: a false negative here would stop a
// legitimate record over a rule the server does not enforce.

import { FactaError } from "./errors.ts";
import type { CatalogCustomer, CatalogProduct, CustomerInput, ProductInput } from "./types.ts";

const WHERE = "Cuenta → API";
const WARNING = "Al activarlo, el catálogo de la empresa queda en texto plano y Facta DTE podrá leerlo.";

/** Spanish explanations for the two errors a catalog write can hit before anything is stored. */
export const CATALOG_WRITE_MESSAGES = {
  catalog_write_disabled:
    `Esta empresa no permite administrar clientes y productos desde el API. Para habilitarlo, abra Facta DTE, vaya a ${WHERE} y marque «Permitir administrar clientes y productos desde el API». ` +
    `La llave también necesita el alcance catalog:write. ${WARNING}`,
  catalog_encrypted:
    `El catálogo de esta empresa está cifrado, y el API solo puede modificarlo en texto plano. Para cambiarlo, abra Facta DTE, vaya a ${WHERE}, pase el catálogo a texto plano y marque «Permitir administrar clientes y productos desde el API». ` +
    `${WARNING} Mientras siga cifrado, el catálogo solo se puede leer con la clave de desbloqueo (unlockKey).`,
} as const;

function invalid(issues: string[]): never {
  throw new FactaError("validation_failed", `Datos de catálogo inválidos: ${issues.join(" ")}`, 422, { issues });
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableText(input: Record<string, unknown>, key: string, issues: string[], max = 250): void {
  const value = input[key];
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.length > max) issues.push(`${key} debe ser texto de hasta ${max} caracteres.`);
}

// The public API speaks the Ministry's field names (`nombre`, `numDocumento`,
// `precioUni`...), like every other route. The first catalog methods of this SDK
// used the stored names (`name`, `doc_number`, `unit_price`...), which are also
// what an encrypted snapshot holds. Both spellings still work: inputs are
// translated to the wire names before they are sent, and every record the SDK
// returns carries BOTH spellings, whichever way the catalog was read.

const CUSTOMER_ALIASES: ReadonlyArray<readonly [wire: string, stored: string]> = [
  ["nombre", "name"],
  ["tipoDocumento", "doc_type"],
  ["numDocumento", "doc_number"],
  ["nrc", "nrc"],
  ["codActividad", "activity_code"],
  ["direccion", "address"],
  ["telefono", "phone"],
  ["correo", "email"],
];
const PRODUCT_ALIASES: ReadonlyArray<readonly [wire: string, stored: string]> = [
  ["codigo", "code"],
  ["codigoBarras", "barcode"],
  ["descripcion", "description"],
  ["tipoItem", "item_type"],
  ["uniMedida", "unit_of_measure"],
  ["precioUni", "unit_price"],
  ["ivaIncluido", "vat_included"],
];
const SALE_TYPES = ["gravada", "exenta", "no_sujeta"] as const;

/** Both spellings of a field given: they must agree, or the caller gets told. */
function toWire(
  input: Record<string, unknown>,
  aliases: ReadonlyArray<readonly [string, string]>,
  issues: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const [wire, stored] of aliases) {
    if (wire === stored || !(stored in input)) continue;
    delete out[stored];
    if (wire in input && JSON.stringify(input[wire]) !== JSON.stringify(input[stored])) {
      issues.push(`${wire} y ${stored} son el mismo dato y traen valores distintos; use solo ${wire}.`);
    } else if (!(wire in input)) {
      out[wire] = input[stored];
    }
  }
  return out;
}

/** The customer fields the server expects: wire names, document and NRC as digits only. */
export function prepareCustomer(input: CustomerInput, mode: "create" | "update"): Record<string, unknown> {
  if (!isRecord(input)) invalid(["se esperaba un objeto con los datos del cliente."]);
  const issues: string[] = [];
  const out = toWire(input as Record<string, unknown>, CUSTOMER_ALIASES, issues);
  const nombre = out["nombre"];
  if (nombre === undefined) {
    if (mode === "create") issues.push("nombre es obligatorio.");
  } else if (typeof nombre !== "string" || nombre.trim() === "" || nombre.length > 250) {
    issues.push("nombre debe ser texto, no vacío, de hasta 250 caracteres.");
  }
  const docType = out["tipoDocumento"];
  const docNumber = out["numDocumento"];
  if (docType !== undefined && docType !== null && typeof docType !== "string") issues.push("tipoDocumento debe ser texto (por ejemplo «13» o «36»).");
  if (docNumber !== undefined && docNumber !== null) {
    if (typeof docNumber !== "string") issues.push("numDocumento debe ser texto.");
    else if (docType === "13" || docType === "36") {
      const clean = digits(docNumber);
      const want = docType === "13" ? 9 : 14;
      if (clean.length !== want) issues.push(`numDocumento de un ${docType === "13" ? "DUI" : "NIT"} lleva ${want} dígitos.`);
      else out["numDocumento"] = clean;
    }
  }
  const nrc = out["nrc"];
  if (nrc !== undefined && nrc !== null) {
    if (typeof nrc !== "string") issues.push("nrc debe ser texto.");
    else {
      const clean = digits(nrc);
      if (clean.length < 1 || clean.length > 8) issues.push("nrc lleva de 1 a 8 dígitos.");
      else out["nrc"] = clean;
    }
  }
  const direccion = out["direccion"];
  if (direccion !== undefined && direccion !== null) {
    if (!isRecord(direccion)) issues.push("direccion debe ser un objeto {departamento, municipio, distrito, complemento}.");
    else {
      if (typeof direccion["departamento"] !== "string" || !/^\d{2}$/.test(direccion["departamento"])) issues.push("direccion.departamento es un código de dos dígitos.");
      if (typeof direccion["municipio"] !== "string" || !/^\d{2}$/.test(direccion["municipio"])) issues.push("direccion.municipio es un código de dos dígitos.");
      if (typeof direccion["distrito"] !== "string" || direccion["distrito"].trim() === "") issues.push("direccion.distrito es obligatorio (código del distrito del departamento y municipio).");
      if (typeof direccion["complemento"] !== "string" || direccion["complemento"].trim() === "") issues.push("direccion.complemento es obligatorio.");
    }
  }
  const correo = out["correo"];
  if (correo !== undefined && correo !== null && (typeof correo !== "string" || !correo.includes("@") || correo.length > 250)) {
    issues.push("correo no parece una dirección de correo.");
  }
  nullableText(out, "codActividad", issues, 10);
  nullableText(out, "telefono", issues, 30);
  if (mode === "update" && Object.keys(out).length === 0) issues.push("indique al menos un campo para cambiar.");
  if (issues.length > 0) invalid(issues);
  return out;
}

/** The product fields to send. `tipoItem` is never defaulted: it decides the tax treatment. */
export function prepareProduct(input: ProductInput, mode: "create" | "update"): Record<string, unknown> {
  if (!isRecord(input)) invalid(["se esperaba un objeto con los datos del producto."]);
  const issues: string[] = [];
  const out = toWire(input as Record<string, unknown>, PRODUCT_ALIASES, issues);
  const descripcion = out["descripcion"];
  if (descripcion === undefined) {
    if (mode === "create") issues.push("descripcion es obligatorio.");
  } else if (typeof descripcion !== "string" || descripcion.trim() === "" || descripcion.length > 1500) {
    issues.push("descripcion debe ser texto, no vacío, de hasta 1500 caracteres.");
  }
  const tipoItem = out["tipoItem"];
  if (tipoItem === undefined) {
    if (mode === "create") issues.push("tipoItem es obligatorio: 1 bien, 2 servicio o 3 ambos. No se asume ninguno.");
  } else if (tipoItem !== 1 && tipoItem !== 2 && tipoItem !== 3) {
    issues.push("tipoItem debe ser 1 (bien), 2 (servicio) o 3 (ambos).");
  }
  const precio = out["precioUni"];
  if (precio === undefined) {
    if (mode === "create") issues.push("precioUni es obligatorio.");
  } else if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) {
    issues.push("precioUni debe ser un número mayor que cero.");
  }
  const unidad = out["uniMedida"];
  if (unidad !== undefined && (typeof unidad !== "number" || !Number.isInteger(unidad) || unidad < 1)) {
    issues.push("uniMedida debe ser un entero positivo.");
  }
  const iva = out["ivaIncluido"];
  if (iva !== undefined && typeof iva !== "boolean") issues.push("ivaIncluido debe ser verdadero o falso.");
  const venta = out["tipoVenta"];
  if (venta !== undefined && !(SALE_TYPES as readonly unknown[]).includes(venta)) {
    issues.push("tipoVenta debe ser «gravada», «exenta» o «no_sujeta».");
  }
  nullableText(out, "codigo", issues, 25);
  nullableText(out, "codigoBarras", issues, 100);
  if (mode === "update" && Object.keys(out).length === 0) issues.push("indique al menos un campo para cambiar.");
  if (issues.length > 0) invalid(issues);
  return out;
}

function withAliases(
  row: Record<string, unknown>,
  aliases: ReadonlyArray<readonly [string, string]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [wire, stored] of aliases) {
    if (wire in out && !(stored in out)) out[stored] = out[wire];
    else if (stored in out && !(wire in out)) out[wire] = out[stored];
    // The same fields exist in every mode: a field the source did not carry is null, never absent.
    if (!(wire in out)) {
      out[wire] = null;
      out[stored] = null;
    }
  }
  // `activo` (API) and `active` (stored) are the same flag; a record that does not say is active.
  const active = "activo" in out ? out["activo"] : "active" in out ? out["active"] : true;
  out["activo"] = active !== false;
  out["active"] = active !== false;
  return out;
}

const numberOrKeep = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
};

/**
 * A customer with both spellings and the same fields in every catalog mode (an
 * encrypted snapshot, a readable copy and the plain API all give the same record;
 * timestamps the snapshot never held are `null`).
 */
export function normalizeCustomer<T extends { id: string }>(row: T): T {
  const out = withAliases(row as Record<string, unknown>, CUSTOMER_ALIASES);
  for (const key of ["creadoEn", "actualizadoEn"]) if (!(key in out)) out[key] = null;
  return out as T;
}

/**
 * A product with both spellings and the same fields in every catalog mode.
 * `tipoVenta` (API spelling) and `sale_class` (stored spelling) are the VAT treatment;
 * a product that never chose one reads as taxed.
 */
export function normalizeProduct<T extends { id: string }>(row: T): T {
  const out = withAliases(row as Record<string, unknown>, PRODUCT_ALIASES);
  for (const key of ["tipoItem", "uniMedida", "precioUni"]) out[key] = numberOrKeep(out[key]);
  out["item_type"] = out["tipoItem"];
  out["unit_of_measure"] = out["uniMedida"];
  out["unit_price"] = out["precioUni"];
  const stored = out["sale_class"];
  const wire = out["tipoVenta"];
  const type = wire === "exenta" || wire === "no_sujeta" || wire === "gravada"
    ? wire
    : stored === "exenta" ? "exenta" : stored === "noSuj" ? "no_sujeta" : "gravada";
  out["tipoVenta"] = type;
  out["sale_class"] = type === "no_sujeta" ? "noSuj" : type;
  if (!("actualizadoEn" in out)) out["actualizadoEn"] = null;
  return out as T;
}

export function requireId(id: unknown, label: string): string {
  if (typeof id !== "string" || id.trim() === "" || id.length > 100) {
    throw new TypeError(`${label} id is required.`);
  }
  return id;
}

/** Rows of a list answer: a bare array, or an object holding the array under a known key. */
export function rowsOf<T extends { id: string }>(payload: unknown, keys: readonly string[]): T[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload)
    ? [...keys, "data", "items"].map((key) => payload[key]).find(Array.isArray)
    : undefined;
  if (!Array.isArray(list)) {
    throw new FactaError("internal_error", "La respuesta del catálogo no trae una lista de registros.", 502);
  }
  return list.filter((row): row is T => isRecord(row) && typeof row["id"] === "string");
}

/** The cursor of the next page, if any. */
export function nextCursor(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ["siguiente", "nextCursor", "next_cursor", "next"]) {
    const value = payload[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/** One record of a get/create/update answer, or null when the answer carries none. */
export function recordOf<T extends { id: string }>(payload: unknown, keys: readonly string[]): T | null {
  if (!isRecord(payload)) return null;
  for (const key of [...keys, "data", "item"]) {
    const value = payload[key];
    if (isRecord(value) && typeof value["id"] === "string") return value as T;
  }
  return typeof payload["id"] === "string" ? payload as T : null;
}

export type { CatalogCustomer, CatalogProduct };
