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

/** The customer fields as the server stores them: document and NRC as digits only. */
export function prepareCustomer(input: CustomerInput, mode: "create" | "update"): Record<string, unknown> {
  if (!isRecord(input)) invalid(["se esperaba un objeto con los datos del cliente."]);
  const issues: string[] = [];
  const out: Record<string, unknown> = { ...input };
  const name = input.name;
  if (name === undefined) {
    if (mode === "create") issues.push("name es obligatorio.");
  } else if (typeof name !== "string" || name.trim() === "" || name.length > 250) {
    issues.push("name debe ser texto, no vacío, de hasta 250 caracteres.");
  }
  const docType = input.doc_type;
  const docNumber = input.doc_number;
  if (docType !== undefined && docType !== null && typeof docType !== "string") issues.push("doc_type debe ser texto (por ejemplo «13» o «36»).");
  if (docNumber !== undefined && docNumber !== null) {
    if (typeof docNumber !== "string") issues.push("doc_number debe ser texto.");
    else if (docType === "13" || docType === "36") {
      const clean = digits(docNumber);
      const want = docType === "13" ? 9 : 14;
      if (clean.length !== want) issues.push(`doc_number de un ${docType === "13" ? "DUI" : "NIT"} lleva ${want} dígitos.`);
      else out["doc_number"] = clean;
    }
  }
  const nrc = input.nrc;
  if (nrc !== undefined && nrc !== null) {
    if (typeof nrc !== "string") issues.push("nrc debe ser texto.");
    else {
      const clean = digits(nrc);
      if (clean.length < 1 || clean.length > 8) issues.push("nrc lleva de 1 a 8 dígitos.");
      else out["nrc"] = clean;
    }
  }
  const address = input.address;
  if (address !== undefined && address !== null) {
    if (!isRecord(address)) issues.push("address debe ser un objeto {departamento, municipio, complemento}.");
    else {
      if (typeof address["departamento"] !== "string" || !/^\d{2}$/.test(address["departamento"])) issues.push("address.departamento es un código de dos dígitos.");
      if (typeof address["municipio"] !== "string" || !/^\d{2}$/.test(address["municipio"])) issues.push("address.municipio es un código de dos dígitos.");
      if (typeof address["complemento"] !== "string" || address["complemento"].trim() === "") issues.push("address.complemento es obligatorio.");
    }
  }
  const email = input.email;
  if (email !== undefined && email !== null && (typeof email !== "string" || !email.includes("@") || email.length > 250)) {
    issues.push("email no parece una dirección de correo.");
  }
  nullableText(input as Record<string, unknown>, "activity_code", issues, 10);
  nullableText(input as Record<string, unknown>, "phone", issues, 30);
  if (mode === "update" && Object.keys(input).length === 0) issues.push("indique al menos un campo para cambiar.");
  if (issues.length > 0) invalid(issues);
  return out;
}

/** The product fields to send. `item_type` is never defaulted: it decides the tax treatment. */
export function prepareProduct(input: ProductInput, mode: "create" | "update"): Record<string, unknown> {
  if (!isRecord(input)) invalid(["se esperaba un objeto con los datos del producto."]);
  const issues: string[] = [];
  const description = input.description;
  if (description === undefined) {
    if (mode === "create") issues.push("description es obligatorio.");
  } else if (typeof description !== "string" || description.trim() === "" || description.length > 1000) {
    issues.push("description debe ser texto, no vacío, de hasta 1000 caracteres.");
  }
  const itemType = input.item_type;
  if (itemType === undefined) {
    if (mode === "create") issues.push("item_type es obligatorio: 1 bien, 2 servicio o 3 ambos. No se asume ninguno.");
  } else if (itemType !== 1 && itemType !== 2 && itemType !== 3) {
    issues.push("item_type debe ser 1 (bien), 2 (servicio) o 3 (ambos).");
  }
  const price = input.unit_price;
  if (price === undefined) {
    if (mode === "create") issues.push("unit_price es obligatorio.");
  } else if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    issues.push("unit_price debe ser un número no negativo.");
  }
  const unit = input.unit_of_measure;
  if (unit !== undefined && (typeof unit !== "number" || !Number.isInteger(unit) || unit < 1)) {
    issues.push("unit_of_measure debe ser un entero positivo.");
  }
  const vat = input.vat_included;
  if (vat !== undefined && typeof vat !== "boolean") issues.push("vat_included debe ser verdadero o falso.");
  nullableText(input as Record<string, unknown>, "code", issues, 100);
  nullableText(input as Record<string, unknown>, "barcode", issues, 100);
  if (mode === "update" && Object.keys(input).length === 0) issues.push("indique al menos un campo para cambiar.");
  if (issues.length > 0) invalid(issues);
  return { ...input };
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
