import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("packaging", () => {
  it("never ships the playground in the npm tarball", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };
    expect(pkg.files.some((entry) => entry.startsWith("playground"))).toBe(false);
  });

  it("keeps the playground out of the Deno suite", () => {
    expect(readFileSync("deno.json", "utf8")).toContain('"playground"');
  });
});
