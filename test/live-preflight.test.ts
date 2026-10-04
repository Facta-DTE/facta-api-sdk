import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { requireLiveSnapshots } from "../scripts/live-preflight.mjs";
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
