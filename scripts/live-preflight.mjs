import { safeFailureCode } from "./live-report.mjs";

/** Full live validation requires the owner-published destinations snapshot before fiscal work (BYOS only). */
export async function requireLiveSnapshots(facta, checks, onCheck = (_check) => {}, managedOnlyReady = false) {
  const snapshots = { destinations: null };
  if (managedOnlyReady) { checks.destinations = "Not applicable (managed only)"; return snapshots; }
  onCheck("destinations");
  try {
    // Discard decrypted contents; only the capability result may be reported.
    snapshots.destinations = await facta.syncDestinations();
    checks.destinations = "Passed";
  } catch (cause) {
    checks.destinations = "Failed";
    const error = new Error("Required snapshot is unavailable for full live validation.");
    error.code = safeFailureCode(cause);
    throw error;
  }
  return snapshots;
}

/** Exercise the catalogue reads the server answers (since 0.6 there is no local snapshot to compare with). */
export async function validateLiveCatalogReads(facta, checks, onCheck = (_check) => {}) {
  const fail = () => { throw Object.assign(new Error("Catalog read validation failed."), { code: "catalog_read_failed" }); };

  const [customers, products] = await Promise.all([
    facta.listCustomers(),
    facta.listProducts({ includeInactive: true }),
  ]);
  if (!Array.isArray(customers) || !Array.isArray(products)) fail();
  onCheck("customer-catalog");
  if (customers.length === 0) {
    if ((await facta.searchCustomers("", { limit: 1 })).length !== 0) fail();
    checks["customer-catalog"] = "Not applicable (empty authorized catalog)";
  } else {
    const customer = customers[0];
    const loaded = await facta.getCustomer(customer.id);
    if (!loaded || loaded.id !== customer.id) fail();
    const query = [customer.name, customer.doc_number, customer.nrc, customer.email]
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (query && !(await facta.searchCustomers(query, { limit: 500 })).some((row) => row.id === customer.id)) fail();
    checks["customer-catalog"] = "Passed";
  }
  onCheck("product-catalog");
  if (products.length === 0) {
    if ((await facta.searchProducts("", { limit: 1 })).length !== 0) fail();
    checks["product-catalog"] = "Not applicable (empty authorized catalog)";
  } else {
    const product = products.find((row) => row.active !== false) ?? products[0];
    const loaded = await facta.getProduct(product.id);
    if (product.active === false ? loaded !== null : !loaded || loaded.id !== product.id) fail();
    const query = [product.description, product.code, product.barcode]
      .find((value) => typeof value === "string" && value.trim().length > 0);
    if (query && product.active !== false && !(await facta.searchProducts(query, { limit: 500 })).some((row) => row.id === product.id)) fail();
    checks["product-catalog"] = "Passed";
  }
}

const PROBE_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The CI key's company either keeps its catalog encrypted (the write routes must refuse) or has writes
 * enabled (an unknown id answers 404 `not_found`; `status().llave.catalogoEscritura` tells which). The
 * probe deactivates an id that does not exist: even if a server wrongly allowed the write, nothing
 * real is touched. Plain mode is never switched on for a real company.
 *
 * Until the routes are deployed (404/405/501) or while the key lacks the scope, the check only
 * warns; any other outcome, including a success, fails the run.
 */
export async function validateLiveCatalogWriteGate(facta, checks, onCheck = (_check) => {}) {
  onCheck("catalog-write-gate");
  // Since the shared data key the CI company may keep a plain catalogue with writes enabled: then an
  // unknown id answers 404 not_found and that IS the gate being open. The key says which state to expect.
  const writable = typeof facta.status === "function" ? (await facta.status()).llave?.catalogoEscritura === true : false;
  try {
    await facta.deactivateCustomer(PROBE_ID);
  } catch (cause) {
    const code = cause?.code;
    if (code === "catalog_write_disabled" || code === "catalog_encrypted") {
      checks["catalog-write-gate"] = "Passed (writes refused for the encrypted CI company)";
      return;
    }
    if (code === "forbidden_scope") {
      checks["catalog-write-gate"] = "Warning (key lacks catalog:write)";
      return;
    }
    if (writable && cause?.status === 404 && code === "not_found") {
      checks["catalog-write-gate"] = "Passed (writes enabled; an unknown id answers not_found)";
      return;
    }
    if (cause?.status === 404 || cause?.status === 405 || cause?.status === 501 || code === "not_found" || code === "method_not_allowed") {
      checks["catalog-write-gate"] = "Warning (catalog write routes not deployed on staging yet)";
      return;
    }
    checks["catalog-write-gate"] = "Failed";
    throw Object.assign(new Error("Catalog write gate answered unexpectedly."), { code: "catalog_write_gate_failed" });
  }
  checks["catalog-write-gate"] = "Failed";
  throw Object.assign(new Error("Catalog write was accepted for the encrypted CI company."), { code: "catalog_write_gate_failed" });
}

/**
 * Read-only exercise of the change feed and the webhook list (scope `catalog:read`): the feed starts at
 * revision 0 with its shape, a cursor ahead of the head is `catalog_cursor_expired` with `cabeza`, and the
 * key's webhooks list without secrets. Writes nothing, so it is safe on any company.
 */
export async function validateLiveCatalogChanges(facta, checks, onCheck = (_check) => {}) {
  onCheck("catalog-changes");
  const fail = () => { throw Object.assign(new Error("Catalog change feed validation failed."), { code: "catalog_changes_failed" }); };
  try {
    const page = await facta.listCatalogChanges({ since: 0, limit: 1 });
    if (!Array.isArray(page.changes) || typeof page.head !== "number" || typeof page.hasMore !== "boolean" || typeof page.next !== "number") fail();
    const ahead = await facta.listCatalogChanges({ since: page.head + 1_000_000 }).then(() => null, (cause) => cause);
    if (ahead?.code !== "catalog_cursor_expired" || typeof ahead.details?.cabeza !== "number") fail();
    const hooks = await facta.listWebhooks();
    if (!Array.isArray(hooks) || hooks.some((hook) => "secret" in hook)) fail();
  } catch (cause) {
    if (cause?.code === "forbidden_scope") { checks["catalog-changes"] = "Not applicable (empty authorized catalog)"; return; }
    checks["catalog-changes"] = "Failed";
    throw cause?.code === "catalog_changes_failed" ? cause : Object.assign(new Error("Catalog change feed validation failed."), { code: safeFailureCode(cause) });
  }
  checks["catalog-changes"] = "Passed (change feed and webhook list)";
}
