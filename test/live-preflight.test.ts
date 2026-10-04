import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { requireLiveSnapshots, validateLiveCatalogReads } from "../scripts/live-preflight.mjs";
import { createValidationResults } from "../scripts/live-report.mjs";

Deno.test("full live gate opens both snapshots before fiscal work", async () => {
  const calls: string[] = [];
  const checks = createValidationResults();
  await requireLiveSnapshots({
    syncCatalog: () => { calls.push("catalog"); return Promise.resolve({ customers: ["private"] }); },
    syncDestinations: () => { calls.push("destinations"); return Promise.resolve({ credentials: "private" }); },
  }, checks, (check: string) => { calls.push(`check:${check}`); });
  calls.push("issue");
  assertEquals(calls, ["check:catalog", "catalog", "check:destinations", "destinations", "issue"]);
  assertEquals(checks.catalog, "Passed");
  assertEquals(checks.destinations, "Passed");
});

for (const failingCheck of ["catalog", "destinations"]) {
  Deno.test(`unavailable ${failingCheck} blocks fiscal work and discards raw error details`, async () => {
    const checks = createValidationResults();
    const calls: string[] = [];
    let currentCheck = "preflight";
    const open = (check: string) => {
      calls.push(check);
      if (check === failingCheck) throw Object.assign(new Error("PRIVATE-RESPONSE-NIT"), { code: "no_storage_destination" });
      return Promise.resolve({ private: "PRIVATE-RESPONSE-NIT" });
    };
    const error = await assertRejects(async () => {
      await requireLiveSnapshots({
        syncCatalog: () => open("catalog"),
        syncDestinations: () => open("destinations"),
      }, checks, (check: string) => { currentCheck = check; });
      calls.push("issue");
    }, Error);
    assertEquals(currentCheck, failingCheck);
    assertEquals(checks[failingCheck], "Failed");
    assertEquals(calls.includes("issue"), false);
    assertEquals(error.message.includes("PRIVATE"), false);
    assertEquals((error as Error & { code: string }).code, "no_storage_destination");
  });
}

Deno.test("positive managed-only capability makes BYOS snapshot optional while retaining catalog verification", async () => {
  const checks = createValidationResults();
  let destinations = 0;
  await requireLiveSnapshots({ syncCatalog: () => Promise.resolve({}), syncDestinations: () => { destinations++; throw new Error("not configured"); } }, checks, () => {}, true);
  assertEquals(destinations, 0);
  assertEquals(checks.catalog, "Passed");
  assertEquals(checks.destinations, "Not applicable (managed only)");
});

Deno.test("catalog live checks exercise list, get, and search without returning private fields", async () => {
  const snapshot = {
    version: 1,
    customers: [{ id: "customer-private-id", name: "PRIVATE CUSTOMER NAME", doc_number: "PRIVATE-DOC" }],
    products: [{ id: "product-private-id", description: "PRIVATE PRODUCT DESCRIPTION", active: true }],
  };
  const checks = createValidationResults();
  const calls: string[] = [];
  const facta = {
    listCustomers: () => { calls.push("customers:list"); return Promise.resolve(snapshot.customers); },
    getCustomer: (id: string) => { calls.push("customers:get"); return Promise.resolve(snapshot.customers.find((row) => row.id === id)); },
    searchCustomers: (query: string) => { calls.push("customers:search"); return Promise.resolve(snapshot.customers.filter((row) => row.name.includes(query))); },
    listProducts: () => { calls.push("products:list"); return Promise.resolve(snapshot.products); },
    getProduct: (id: string) => { calls.push("products:get"); return Promise.resolve(snapshot.products.find((row) => row.id === id)); },
    searchProducts: (query: string) => { calls.push("products:search"); return Promise.resolve(snapshot.products.filter((row) => row.description.includes(query))); },
  };
  await validateLiveCatalogReads(facta, snapshot, checks);
  assertEquals(calls, ["customers:list", "products:list", "customers:get", "customers:search", "products:get", "products:search"]);
  assertEquals(checks["customer-catalog"], "Passed");
  assertEquals(checks["product-catalog"], "Passed");
  assertEquals(JSON.stringify(checks).includes("PRIVATE"), false);
});
