// Recipe 6 · Catalog references: issue with `customerId` / `productId`.
//
// The request carries ids, never copied customer data. `issue` decides who resolves them:
// `Facta` reads `/v1/status`, and when the key's owner enabled «Catálogo legible por la API»
// (`llave.catalogMode: "readable"`) the ids go to the API unchanged and the server resolves them;
// otherwise the SDK resolves them from the key's decrypted snapshot and needs `unlockKey`.
// Listing the catalog (below) always reads that snapshot, so this recipe needs the unlock key.
// Receivers: `customerId` exists on the 01/03/05/06 receiver only; 11 and 14 have none.
// The playground's sale builder does the same and, before sealing a session, checks on the Worker
// that every id exists in the catalog (`getCustomer` / `getProduct`).
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
  // The WHOLE records the key's snapshot carries: every customer and product field, not a name and a price.
  // The playground masks the personal data of its real catalog on the Worker before the page sees it;
  // in your server the SDK hands you these records complete.
  const customers = (await facta.listCustomers()).slice(0, 25);
  const products = (await facta.listProducts()).slice(0, 25);
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
