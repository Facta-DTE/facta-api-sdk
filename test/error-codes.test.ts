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
