// The playground never writes the key's catalog. The SDK can (createCustomer, updateCustomer,
// deactivateCustomer and the three product equivalents) and the page documents them, but this
// Worker refuses every attempt, in three places so that none of them is the only fence:
//
//   1. `POST /api/facta` answers 403 to any catalog write action before the SDK handler sees it;
//   2. the Facta clients the Worker builds (the handler's and the recipes') are wrapped so that
//      calling a write method throws instead of reaching the network;
//   3. the handler's `capabilities.catalog` stays `"read"`, so the SDK itself would refuse as well.
//
// Marvin, 7-Oct-2026: «No hablo de agregar clientes y productos porque eso todavía no quiero que
// se haga desde el playground ... El mismo playground desde el servidor va a evitar que se haga
// ese tipo de cosas.»

import { CATALOG_WRITE_ACTIONS } from "../../src/server/capabilities.ts";

export const CATALOG_WRITE_MESSAGE = "Disponible en el SDK; el playground no modifica el catálogo.";
export const CATALOG_WRITE_CODE = "catalog_write_not_allowed";

/** The `Facta` methods that change the catalog. */
export const CATALOG_WRITE_METHODS = [
  "createCustomer",
  "updateCustomer",
  "deactivateCustomer",
  "createProduct",
  "updateProduct",
  "deactivateProduct",
] as const;

const WRITE_ACTIONS: ReadonlySet<string> = new Set(CATALOG_WRITE_ACTIONS);
const WRITE_METHODS: ReadonlySet<string | symbol> = new Set(CATALOG_WRITE_METHODS);

/** True for the six handler actions that mutate the catalog, and for any other `catalog.*` action that is not a read. */
export function isCatalogWriteAction(action: unknown): boolean {
  if (typeof action !== "string") return false;
  if (WRITE_ACTIONS.has(action)) return true;
  return action.startsWith("catalog.") && /\.(create|update|deactivate|delete|remove|write|set|put|patch)/.test(action);
}

export class CatalogWriteRefused extends Error {
  override readonly name = "CatalogWriteRefused";
  readonly code = CATALOG_WRITE_CODE;
  constructor() {
    super(CATALOG_WRITE_MESSAGE);
  }
}

/** The same client with its six catalog write methods replaced by a refusal. Everything else is untouched. */
export function refuseCatalogWrites<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop) {
      if (WRITE_METHODS.has(prop)) {
        return () => Promise.reject(new CatalogWriteRefused());
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
