import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import { SKILL_ZIP_FILE, skillZipBytes, skillZipPlugin } from "../skill-zip-plugin.ts";
import { REPO_URL, SKILL_GITHUB_BRANCH, SKILL_GITHUB_URL, SKILL_ZIP_URL } from "../site/source-links.ts";

const root = resolve(import.meta.dirname, "../..");

/** Entry names of a stored (uncompressed) zip, read from its central directory. */
function entryNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const count = view.getUint16(zip.length - 22 + 10, true);
  let at = view.getUint32(zip.length - 22 + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    names.push(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)));
    at += 46 + nameLength + extra;
  }
  return names;
}

describe("the agent-skill download", () => {
  it("builds a zip of skills/facta-dte-api with SKILL.md at its root folder", () => {
    const zip = skillZipBytes();
    expect(zip[0]).toBe(0x50); // "PK"
    expect(zip[1]).toBe(0x4b);
    const names = entryNames(zip);
    expect(names).toContain("facta-dte-api/SKILL.md");
    expect(names.some((n) => n.startsWith("facta-dte-api/references/"))).toBe(true);
    expect(names.some((n) => n.startsWith("facta-dte-api/templates/"))).toBe(true);
  });

  it("writes the zip into the build output directory at the URL the page links to", () => {
    const plugin = skillZipPlugin() as Plugin & { writeBundle: (options: { dir: string }) => void };
    const dir = mkdtempSync(join(tmpdir(), "playground-dist-"));
    plugin.writeBundle({ dir });
    expect(SKILL_ZIP_URL).toBe(`/${SKILL_ZIP_FILE}`);
    const file = join(dir, SKILL_ZIP_FILE);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).length).toBe(skillZipBytes().length);
  });

  it("links to the skill's folder on GitHub, on the branch constant", () => {
    expect(SKILL_GITHUB_URL).toBe(`${REPO_URL}/tree/${SKILL_GITHUB_BRANCH}/skills/facta-dte-api`);
    expect(existsSync(resolve(root, "skills/facta-dte-api/SKILL.md"))).toBe(true);
  });
});
