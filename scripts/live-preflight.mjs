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
