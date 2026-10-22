// Confirms, on the Worker, that every catalog id a sale names exists in THIS key's
// catalog before a session is sealed. The browser's ids are never trusted: a forged
// or stale `customerId` / `productId` is refused here with a clear message instead of
// reaching Hacienda as a rejection.
//
// `getCustomer` / `getProduct` read the key's decrypted snapshot, which needs the unlock
// key (the same condition as the React pickers, `capabilities.catalog`). The ids still
// travel in the session and the SDK resolves them at issue time: server-side for a key
// whose owner enabled «Catálogo legible por la API», from the snapshot otherwise.

import type { FactaLike } from "../../src/server/handler.ts";
import { FactaError } from "../../src/errors.ts";
import { collectCatalogRefs, EMPTY_CATALOG, isCatalogId, SaleError, type CatalogLookup } from "./sale.ts";

export async function loadCatalogLookup(raw: unknown, facta: FactaLike, catalogAvailable: boolean): Promise<CatalogLookup> {
  const refs = collectCatalogRefs(raw);
  if (refs.customerId === null && refs.productIds.length === 0) return EMPTY_CATALOG;
  if (!catalogAvailable || typeof facta.getCustomer !== "function" || typeof facta.getProduct !== "function") {
    throw new SaleError("catalog_unavailable", "Este playground no puede leer el catálogo de la llave. Use datos de demostración o escriba los datos.");
  }
  const lookup: CatalogLookup = { customers: new Map(), products: new Map() };
  try {
    if (refs.customerId !== null) {
      const customer = isCatalogId(refs.customerId) ? await facta.getCustomer(refs.customerId) : null;
      if (customer) lookup.customers.set(refs.customerId, customer);
    }
    for (const id of refs.productIds) {
      const product = isCatalogId(id) ? await facta.getProduct(id) : null;
      if (product) lookup.products.set(id, product);
    }
  } catch (error) {
    // Never echo the SDK's detail: it can carry catalog metadata.
    if (error instanceof FactaError) throw new SaleError("catalog_unreadable", "No se pudo leer el catálogo de la llave. Intente de nuevo en un momento.");
    throw error;
  }
  return lookup;
}
