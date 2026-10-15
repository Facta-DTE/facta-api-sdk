import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEMS } from "../site/sections/screens/catalog.ts";
import { recipePath } from "../site/sections/server/sources.ts";
import { RECIPE_SPECS } from "../server/recipes/specs.ts";
import { SOURCES, sourceUrl } from "../site/shown-files.ts";
import { githubFileUrl, REPO_URL } from "../site/source-links.ts";

const root = resolve(import.meta.dirname, "../..");

describe("source links", () => {
  it("maps every file the page shows to a path that exists, holding exactly the text shown", () => {
    for (const [path, shown] of Object.entries(SOURCES)) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
      expect(readFileSync(resolve(root, path), "utf8"), path).toBe(shown);
    }
  });

  it("builds blob links on main of the public repository", () => {
    expect(REPO_URL).toBe("https://github.com/Facta-DTE/facta-api-sdk");
    expect(githubFileUrl("playground/server/sale.ts")).toBe("https://github.com/Facta-DTE/facta-api-sdk/blob/main/playground/server/sale.ts");
    for (const path of Object.keys(SOURCES)) expect(sourceUrl(path as keyof typeof SOURCES)).toBe(`${REPO_URL}/blob/main/${path}`);
  });

  it("links every workbench item, extra tab and recipe to a shown file", () => {
    const known = new Set(Object.keys(SOURCES));
    for (const item of ITEMS) {
      expect(known.has(item.source.path), item.id).toBe(true);
      expect(known.has(item.server.path), item.id).toBe(true);
      for (const tab of item.extra ?? []) expect(known.has(tab.file.path), tab.id).toBe(true);
    }
    for (const spec of RECIPE_SPECS) {
      expect(known.has(recipePath(spec.file)), spec.id).toBe(true);
      expect(existsSync(resolve(root, recipePath(spec.file))), spec.id).toBe(true);
    }
  });

  it("every ?raw import of the site goes through shown-files.ts", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = resolve(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
    const offenders = walk(resolve(root, "playground/site"))
      .filter((file) => !file.endsWith("shown-files.ts") && /from "[^"]+\.(ts|tsx)\?raw"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
