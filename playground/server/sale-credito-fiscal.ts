// Comprobante de crédito fiscal (03) for the «¿Necesita crédito fiscal?» example.
//
// Batch B owns BUILDERS in `sale.ts`; `buildSale` looks a type up there FIRST and
// falls back to this one, so when B adds its own "03" it wins and this file can go.

import type { DteRequest } from "../../src/types.ts";
import type { PlaygroundFixtures } from "./fixtures.ts";
import { SaleError, type BuiltSale, type SaleInput } from "./sale.ts";

/** A CCF needs a receiver who is a taxpayer: an NRC on file. */
export const isContributor = (receptor: { nrc?: string }): boolean => typeof receptor.nrc === "string" && receptor.nrc.trim() !== "";

export function buildCreditoFiscal(
  input: SaleInput,
  fixtures: PlaygroundFixtures,
  lines: (input: unknown[], fixtures: PlaygroundFixtures) => { items: DteRequest["items"]; total: number },
): BuiltSale {
  if (input.customerId === undefined) throw new SaleError("customer_required", "El crédito fiscal necesita un cliente contribuyente.");
  const customer = fixtures.customers.find((c) => c.id === input.customerId);
  if (!customer) throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
  if (!isContributor(customer.receptor)) {
    throw new SaleError("customer_not_contributor", "Ese cliente no tiene NRC: elija un contribuyente para el crédito fiscal.");
  }
  const { items, total } = lines(input.lines, fixtures);
  return { request: { tipoDte: "03", receptor: customer.receptor, items }, total, title: "Crédito fiscal de prueba" };
}
