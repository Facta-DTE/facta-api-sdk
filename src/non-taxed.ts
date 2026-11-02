// Non-taxed charge/credit lines (`items[].noGravado`, Manual Funcional v2.0 §XII).
//
// The SDK does not compute anything about them: the server places the line,
// sums `totalNoGravado` and moves `totalPagar`. What the SDK does is refuse,
// before a request leaves, the shapes the server would refuse anyway — so a
// mistyped line never reaches the correlative reservation. Every refusal
// uses the server's own error code with status 0 and `details.local: true`.
//
// A request without any `noGravado` line is not inspected at all.

import { FactaError } from "./errors.ts";
import type { NonTaxedLine } from "./types.ts";

/** Document types whose official schema has `noGravado` (the API's own list). */
export const NON_TAXED_DTE_TYPES = ["01", "03", "05", "06", "11"] as const;

/** Fields a non-taxed line cannot carry: Facta fills them as the Manual says. */
const EXCLUSIVE_FIELDS = ["cantidad", "precioUni", "montoDescu", "tipoVenta", "productId", "applyIncomeWithholding"] as const;

/** `true` when the line is a non-taxed charge or credit (it carries `noGravado`). */
export function isNonTaxedLine(line: unknown): line is NonTaxedLine {
  return typeof line === "object" && line !== null && !Array.isArray(line) &&
    (line as Record<string, unknown>)["noGravado"] !== undefined;
}

function refuse(code: "invalid_request" | "non_taxed_not_supported" | "non_taxed_requires_sale_line", message: string, details: Record<string, unknown>): never {
  throw new FactaError(code, message, 0, { ...details, local: true });
}

/** At most 8 decimals, read on the number's own text (no arithmetic on the amount). */
function decimalsOk(value: number): boolean {
  const [mantissa = "", exponent] = String(Math.abs(value)).toLowerCase().split("e");
  const dot = mantissa.indexOf(".");
  const places = (dot < 0 ? 0 : mantissa.length - dot - 1) - Number(exponent ?? 0);
  return places <= 8;
}

/**
 * Check the non-taxed lines of a DTE request (or a draft body) before it is sent. Does nothing when no line
 * carries `noGravado`. Throws {@link FactaError} with the server's code: `non_taxed_not_supported` (type 14,
 * 07, 15 or any type outside 01/03/05/06/11), `invalid_request` (a forbidden or missing field, `details.field`
 * names it) and `non_taxed_requires_sale_line` (no sale line left).
 */
export function assertNonTaxedLines(request: unknown): void {
  if (typeof request !== "object" || request === null) return;
  const items = (request as Record<string, unknown>)["items"];
  if (!Array.isArray(items) || !items.some(isNonTaxedLine)) return;
  const tipoDte = (request as Record<string, unknown>)["tipoDte"];
  const first = `items[${items.findIndex(isNonTaxedLine)}].noGravado`;
  if (typeof tipoDte === "string" && !(NON_TAXED_DTE_TYPES as readonly string[]).includes(tipoDte)) {
    refuse("non_taxed_not_supported", `El tipo ${tipoDte} no admite líneas no gravadas (noGravado).`, {
      field: first, tipoDte, supported: [...NON_TAXED_DTE_TYPES],
    });
  }
  const isNote = tipoDte === "05" || tipoDte === "06";
  let saleLines = 0;
  for (const [index, item] of items.entries()) {
    const label = `items[${index}]`;
    if (!isNonTaxedLine(item)) {
      if (isSaleLineWithAmount(item)) saleLines++;
      continue;
    }
    const line = item as unknown as Record<string, unknown>;
    // Same checks, same order and same `details.field` as the server's `nonTaxedWireProblem`.
    const amount = line["noGravado"];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) >= 1e11 || !decimalsOk(amount)) {
      refuse("invalid_request", `${label}.noGravado tiene que ser un número distinto de cero, menor que 100 000 000 000 en valor absoluto y con 8 decimales como máximo.`, { field: `${label}.noGravado` });
    }
    for (const field of EXCLUSIVE_FIELDS) {
      if (line[field] !== undefined) {
        refuse("invalid_request", `${label}.${field} no va en una línea no gravada: lleve solo descripcion, noGravado, tipoItem y codigo.`, { field: `${label}.${field}` });
      }
    }
    if (line["uniMedida"] !== undefined && line["uniMedida"] !== 99) {
      refuse("invalid_request", `${label}.uniMedida de una línea no gravada es siempre 99 (u omítala).`, { field: `${label}.uniMedida` });
    }
    if (typeof line["descripcion"] !== "string" || line["descripcion"].trim() === "") {
      refuse("invalid_request", `${label}.descripcion es obligatoria en una línea no gravada.`, { field: `${label}.descripcion` });
    }
    if (line["tipoItem"] !== 1 && line["tipoItem"] !== 2 && line["tipoItem"] !== 3) {
      refuse("invalid_request", `${label}.tipoItem es obligatorio en una línea no gravada: 1 (bien), 2 (servicio) o 3 (ambos).`, { field: `${label}.tipoItem` });
    }
    const codigo = line["codigo"];
    if (codigo !== undefined && codigo !== null && typeof codigo !== "string") {
      refuse("invalid_request", `${label}.codigo tiene que ser un texto.`, { field: `${label}.codigo` });
    }
    const numeroDocumento = line["numeroDocumento"];
    if (numeroDocumento !== undefined && (!isNote || typeof numeroDocumento !== "string" || numeroDocumento.trim() === "")) {
      refuse("invalid_request", `${label}.numeroDocumento solo va en una nota (05/06), como texto.`, { field: `${label}.numeroDocumento` });
    }
  }
  if (saleLines === 0) {
    refuse("non_taxed_requires_sale_line", "Una línea no gravada necesita al menos una línea de venta (gravada, exenta o no sujeta) con valor mayor que cero.", { field: first });
  }
}

/**
 * A sale line that may carry an amount: the server's rule is `cantidad × precioUni − montoDescu > 0`. It is
 * applied locally only when both numbers are on the line; a `productId` line without a price is resolved by
 * the server, which decides.
 */
function isSaleLineWithAmount(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const line = item as Record<string, unknown>;
  const cantidad = line["cantidad"];
  const precioUni = line["precioUni"];
  if (typeof cantidad !== "number" || typeof precioUni !== "number") return line["cantidad"] !== 0 && line["precioUni"] !== 0;
  const descuento = typeof line["montoDescu"] === "number" ? line["montoDescu"] : 0;
  return cantidad * precioUni - descuento > 0;
}
