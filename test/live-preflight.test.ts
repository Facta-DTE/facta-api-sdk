import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { requireLiveSnapshots, validateLiveCatalogReads, validateLiveCatalogWriteGate } from "../scripts/live-preflight.mjs";
import { createValidationResults } from "../scripts/live-report.mjs";

Deno.test("full live gate opens the destinations snapshot before fiscal work", async () => {
  const calls: string[] = [];
  const checks = createValidationResults();
  await requireLiveSnapshots({
    syncDestinations: () => { calls.push("destinations"); return Promise.resolve({ credentials: "private" }); },
  }, checks, (check: string) => { calls.push(`check:${check}`); });
  calls.push("issue");
  assertEquals(calls, ["check:destinations", "destinations", "issue"]);
  assertEquals(checks.destinations, "Passed");
});

Deno.test("unavailable destinations block fiscal work and discard raw error details", async () => {
  const checks = createValidationResults();
  const calls: string[] = [];
  let currentCheck = "preflight";
  const error = await assertRejects(async () => {
    await requireLiveSnapshots({
      syncDestinations: () => { throw Object.assign(new Error("PRIVATE-RESPONSE-NIT"), { code: "no_storage_destination" }); },
    }, checks, (check: string) => { currentCheck = check; });
    calls.push("issue");
  }, Error);
  assertEquals(currentCheck, "destinations");
  assertEquals(checks.destinations, "Failed");
  assertEquals(calls.includes("issue"), false);
  assertEquals(error.message.includes("PRIVATE"), false);
  assertEquals((error as Error & { code: string }).code, "no_storage_destination");
});

Deno.test("positive managed-only capability makes the BYOS snapshot optional", async () => {
  const checks = createValidationResults();
  let destinations = 0;
  await requireLiveSnapshots({ syncDestinations: () => { destinations++; throw new Error("not configured"); } }, checks, () => {}, true);
  assertEquals(destinations, 0);
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
  await validateLiveCatalogReads(facta, checks);
  assertEquals(calls, ["customers:list", "products:list", "customers:get", "customers:search", "products:get", "products:search"]);
  assertEquals(checks["customer-catalog"], "Passed");
  assertEquals(checks["product-catalog"], "Passed");
  assertEquals(JSON.stringify(checks).includes("PRIVATE"), false);
});

const gate = async (outcome: { code?: string; status?: number } | "accepted") => {
  const checks = createValidationResults();
  const facta = {
    deactivateCustomer: () => outcome === "accepted" ? Promise.resolve({ id: "x" }) : Promise.reject(Object.assign(new Error("x"), outcome)),
  };
  const error = await validateLiveCatalogWriteGate(facta, checks).then(() => null, (cause) => cause as Error & { code: string });
  return { state: checks["catalog-write-gate"], code: error?.code ?? null };
};

Deno.test("catalog write gate passes when the encrypted CI company refuses writes", async () => {
  assertEquals((await gate({ code: "catalog_write_disabled", status: 403 })).state, "Passed (writes refused for the encrypted CI company)");
  assertEquals((await gate({ code: "catalog_encrypted", status: 409 })).code, null);
});

Deno.test("catalog write gate only warns before the routes are deployed or without the scope", async () => {
  assertEquals((await gate({ code: "not_found", status: 404 })).state, "Warning (catalog write routes not deployed on staging yet)");
  assertEquals((await gate({ code: "method_not_allowed", status: 405 })).code, null);
  assertEquals((await gate({ code: "forbidden_scope", status: 403 })).state, "Warning (key lacks catalog:write)");
});

Deno.test("catalog write gate fails on a success or an unexpected error", async () => {
  assertEquals(await gate("accepted"), { state: "Failed", code: "catalog_write_gate_failed" });
  assertEquals((await gate({ code: "internal_error", status: 500 })).code, "catalog_write_gate_failed");
});
