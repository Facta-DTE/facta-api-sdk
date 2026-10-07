import { safeFailureCode } from "./live-report.mjs";

/** Full live validation requires owner-published snapshots before fiscal work. */
export async function requireLiveSnapshots(facta, checks, onCheck = (_check) => {}, managedOnlyReady = false) {
  const snapshots = { catalog: null, destinations: null };
  for (const [check, method] of [["catalog", "syncCatalog"], ["destinations", "syncDestinations"]]) {
    if (check === "destinations" && managedOnlyReady) { checks[check] = "Not applicable (managed only)"; continue; }
    onCheck(check);
    try {
      // Discard decrypted contents; only the capability result may be reported.
      snapshots[check] = await facta[method]();
      checks[check] = "Passed";
    } catch (cause) {
      checks[check] = "Failed";
      const error = new Error("Required snapshot is unavailable for full live validation.");
      error.code = safeFailureCode(cause);
      throw error;
    }
  }
  return snapshots;
}

/** Exercise only local reads against the explicitly opened encrypted catalog. */
export async function validateLiveCatalogReads(facta, snapshot, checks, onCheck = (_check) => {}) {
  const fail = () => { throw Object.assign(new Error("Catalog read validation failed."), { code: "catalog_read_failed" }); };
  if (!snapshot || !Array.isArray(snapshot.customers) || !Array.isArray(snapshot.products)) fail();

  const [customers, products] = await Promise.all([
    facta.listCustomers(),
    facta.listProducts({ includeInactive: true }),
  ]);
  if (customers.length !== snapshot.customers.length || products.length !== snapshot.products.length) fail();
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
 * The CI key's company keeps its catalog encrypted, so the catalog write routes must refuse. The
 * probe deactivates an id that does not exist: even if a server wrongly allowed the write, nothing
 * real is touched. Plain mode is never switched on for a real company.
 *
 * Until the routes are deployed (404/405/501) or while the key lacks the scope, the check only
 * warns; any other outcome, including a success, fails the run.
 */
export async function validateLiveCatalogWriteGate(facta, checks, onCheck = (_check) => {}) {
  onCheck("catalog-write-gate");
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
