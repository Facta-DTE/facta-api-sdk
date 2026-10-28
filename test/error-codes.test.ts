import { assert, assertEquals } from "jsr:@std/assert@1";

/**
 * The API contract (test/fixtures/openapi.yaml, a snapshot of the server's
 * openapi.yaml) lists every code the server can answer. A code the SDK type
 * lacks makes `error.code === "..."` fail to compile for integrators, so the
 * two lists are compared here.
 */
function contractCodes(yaml: string): string[] {
  const start = yaml.indexOf("\n    Error:\n");
  assert(start > 0, "Error schema not found in the contract");
  const enumStart = yaml.indexOf("enum:\n", start);
  const lines = yaml.slice(enumStart + "enum:\n".length).split("\n");
  const codes: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s+- ([a-z_]+)\s*$/);
    if (!match) break;
    codes.push(match[1]);
  }
  return codes;
}

function sdkCodes(source: string): string[] {
  const union = source.slice(
    source.indexOf("export type FactaErrorCode"),
    source.indexOf("export interface SpentCorrelative"),
  );
  return [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map(([, code]) => code);
}

Deno.test("every error code in the API contract is a FactaErrorCode", async () => {
  const contract = contractCodes(await Deno.readTextFile("test/fixtures/openapi.yaml"));
  const sdk = new Set(sdkCodes(await Deno.readTextFile("src/errors.ts")));
  assert(contract.length > 30, "Expected to read the contract's error enum");
  assertEquals(contract.filter((code) => !sdk.has(code)), []);
});

// Codes the SDK raises itself; the server never sends them.
const LOCAL_ONLY = ["archive_integrity_error", "network_error", "operation_outcome_unknown", "storage_contract_invalid"];

Deno.test("every FactaErrorCode is in the API contract or is a local-only code", async () => {
  const contract = new Set(contractCodes(await Deno.readTextFile("test/fixtures/openapi.yaml")));
  const sdk = sdkCodes(await Deno.readTextFile("src/errors.ts"));
  assertEquals(sdk.filter((code) => !contract.has(code) && !LOCAL_ONLY.includes(code)), []);
});

Deno.test("the retried set in the client is the one the errors guide documents (both languages)", async () => {
  const client = await Deno.readTextFile("src/client.ts");
  const block = /const RETRYABLE[^=]*= new Set\(\[([\s\S]*?)\]\);/.exec(client)?.[1] ?? "";
  const retried = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert(retried.length >= 6, "Expected to read RETRYABLE");
  for (const path of ["guides/errors.md", "guides/errors.es.md"]) {
    const guide = await Deno.readTextFile(path);
    const marked = [...guide.matchAll(/^\| `([a-z_]+)` \|(?:[^\n]*?\| \*{0,2}(?:yes|sí)\*{0,2} \|| \*{0,2}(?:yes|sí)\*{0,2} \|)/gm)].map((m) => m[1]).sort();
    assertEquals([...new Set(marked)], retried, `${path} marks a different retried set than src/client.ts`);
  }
});
