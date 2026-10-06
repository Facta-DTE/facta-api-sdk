// Recipe 6 · Catalog references: issue with `customerId` / `productId`.
//
// When the key's owner enabled «Catálogo legible por la API» the server resolves
// the ids itself (`catalogMode: "readable"`). Otherwise the SDK resolves them from
// the encrypted catalog and needs the unlock key. Either way the request carries
// ids, never copied customer data.
import type { Facta, IssueResult } from "../../../mod.ts";

export interface Input {
  /** Omit both to only list the catalog. */
  customerId?: string;
  productId?: string;
  cantidad: number;
  idempotencyKey: string;
}

export async function run(facta: Facta, input: Input) {
  const { llave } = await facta.status();
  const customers = (await facta.listCustomers()).slice(0, 25).map((c) => ({ id: c.id, name: c.name ?? null }));
  const products = (await facta.listProducts()).slice(0, 25).map((p) => ({
    id: p.id,
    description: p.description ?? null,
    unitPrice: p.unit_price ?? null,
  }));
  const listing = { catalogMode: llave.catalogMode ?? "encrypted", customers, products };
  if (input.productId === undefined) return { ...listing, result: null as IssueResult | null };

  const result = await facta.issue({
    tipoDte: "01",
    ...(input.customerId === undefined ? {} : { receptor: { customerId: input.customerId } }),
    items: [{ productId: input.productId, cantidad: input.cantidad }],
  }, { idempotencyKey: input.idempotencyKey });
  return { ...listing, result: result as IssueResult | null };
}

export const sample: Input = { cantidad: 1, idempotencyKey: "erp-order-1045" };
