// Non-taxed charge/credit lines (`noGravado`, Manual Funcional v2.0 §XII).
//
// A value that is not subject to tax goes as its OWN line: `descripcion`, `noGravado`
// (positive = charge, negative = credit) and `tipoItem`, plus an optional `codigo`.
// Facta adds it to `resumen.totalNoGravado` and `totalPagar` only; VAT, subtotal and
// discounts do not move. It needs at least one sale line with an amount.
import type { DteRequest, Facta } from "@facta-dte/api";

/**
 * CCF for a loan instalment: the interest is an exempt sale line, the repaid
 * capital is not a sale at all, so it travels as a non-taxed line.
 */
export const loanInstalmentCcf: DteRequest = {
  tipoDte: "03",
  receptor: { customerId: "REPLACE_WITH_CUSTOMER_ID" },
  items: [
    { descripcion: "Intereses de la cuota 7", cantidad: 1, precioUni: 1250, tipoItem: 2, tipoVenta: "exenta" },
    { descripcion: "Capital", noGravado: 50000, tipoItem: 2, codigo: "CAP" },
  ],
};

/**
 * Export (11): every good or service sold is a sale line, taxed at 0 %. Only a
 * charge that is NOT a sale, such as reimbursing a cost paid on the buyer's
 * behalf, goes as `noGravado`. Never put the exported goods themselves there.
 */
export const exportWithReimbursement: DteRequest = {
  tipoDte: "11",
  receptor: {
    nombre: "Overseas buyer LLC",
    numDocumento: "US-998877",
    codPais: "US",
    nombrePais: "United States",
    complemento: "Miami, Florida",
    tipoPersona: 2,
    descActividad: "Import and distribution",
    correo: "buyer@example.com",
  },
  exportacion: { tipoItemExpor: 2 },
  items: [
    { descripcion: "Software development, October", cantidad: 1, precioUni: 4800, tipoItem: 2 },
    { descripcion: "Reembolso de gastos de courier", noGravado: 35.4, tipoItem: 2 },
  ],
};

/** Issue one only when the API advertises the capability. */
export async function issueNonTaxed(facta: Facta, request: DteRequest, idempotencyKey: string) {
  const status = await facta.status();
  if (status.capabilities?.noGravado !== true) throw new Error("This API does not accept noGravado lines yet.");
  const result = await facta.issue(request, { idempotencyKey });
  if (result.estado !== "sellado") return null; // contingency: totals come with the seal
  // Already inside totalPagar: never add it again.
  return { totalPagar: result.totales.totalPagar, totalNoGravado: result.totales.totalNoGravado ?? 0 };
}
