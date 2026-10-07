import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECIPE_SPECS } from "../server/recipes/specs.ts";
import { RECIPE_GUIDES } from "../site/sections/server/guides.ts";
import { PAGE_GUIDES } from "../site/sections/guides/page-guides.ts";
import { ITEMS } from "../site/sections/screens/catalog.ts";
import {
  readPageGuideOpen, readRecipeTab, RECIPE_TAB_KEY, writePageGuideOpen, writeRecipeTab,
} from "../site/sections/guides/storage.ts";
import type { PageGuide, RecipeGuide } from "../site/sections/guides/types.ts";

// The guides are claims about the SDK and the API, so each one is checked against the source that makes it
// true: the Facta client's methods, its routes, the error codes, the exported components.

const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const client = read("src/client.ts");
const errorsSource = read("src/errors.ts");
const typesSource = read("src/types.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sdkSources = walk(join(ROOT, "src")).map((file) => readFileSync(file, "utf8")).join("\n");

/** Public methods and getters of the `Facta` class (two-space indentation, not `#private`). */
const FACTA_MEMBERS = new Set(
  [...client.matchAll(/^ {2}(?:async |get )?([A-Za-z]\w*)\s*(?:<[^>]*>)?\(/gm)].map((m) => m[1]!),
);

const ERROR_CODES = new Set(
  [...(/export type FactaErrorCode =([\s\S]*?);/.exec(errorsSource)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
);
const DELIVERY_STATES = new Set(
  [...(/export type DeliveryChannelState =([\s\S]*?);/.exec(typesSource)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
);

const normalizeRoute = (path: string) =>
  path.replace(/\/\$\{[^}]+\}/g, "/{}").replace(/\$\{[^}]*\}?/g, "").replace(/\{[^}]*\}/g, "{}");
const CLIENT_ROUTES = [...client.matchAll(/["'`](\/v1\/[A-Za-z0-9_{}$/().\-]*)/g)].map((m) => normalizeRoute(m[1]!).split("/"));
const routeKnown = (path: string) => {
  const wanted = normalizeRoute(path).split("/");
  return CLIENT_ROUTES.some((known) => known.length === wanted.length && known.every((seg, i) => seg === "{}" || wanted[i] === "{}" || seg === wanted[i]));
};

/** Every string in a guide, so one pass checks all of it. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const recipeGuides = Object.entries(RECIPE_GUIDES) as [string, RecipeGuide][];
const pageGuides = Object.entries(PAGE_GUIDES) as [string, PageGuide][];
const allGuides: [string, RecipeGuide | PageGuide][] = [...recipeGuides, ...pageGuides];

describe("every page has its guide", () => {
  it.each(RECIPE_SPECS.map((spec) => spec.id))("recipe %s has a guide", (id) => {
    const guide = RECIPE_GUIDES[id];
    expect(guide, `server/guides.ts has no entry for the recipe «${id}»`).toBeDefined();
    expect(guide!.steps.length).toBeGreaterThan(0);
    expect(guide!.errors.length).toBeGreaterThan(0);
    expect(guide!.use.length).toBeGreaterThan(0);
  });

  it.each(ITEMS.map((item) => item.id))("screen %s has a guide", (id) => {
    expect(PAGE_GUIDES[id], `guides/page-guides.ts has no entry for the screen «${id}»`).toBeDefined();
  });

  it.each(["headless", "registro"])("page %s has a guide", (id) => {
    expect(PAGE_GUIDES[id]).toBeDefined();
  });

  it("has no guide for a recipe or screen that does not exist", () => {
    const known = new Set([...RECIPE_SPECS.map((s) => s.id)]);
    for (const [id] of recipeGuides) expect(known.has(id), `guide for a missing recipe «${id}»`).toBe(true);
    const pages = new Set([...ITEMS.map((i) => i.id), "headless", "registro"]);
    for (const [id] of pageGuides) expect(pages.has(id), `guide for a missing page «${id}»`).toBe(true);
  });
});

describe("what the guides claim is real", () => {
  it("reads the client's members, codes and routes (the parsers find something)", () => {
    expect(FACTA_MEMBERS.has("issue")).toBe(true);
    expect(FACTA_MEMBERS.has("getDocumentStatus")).toBe(true);
    expect(ERROR_CODES.has("network_error")).toBe(true);
    expect(DELIVERY_STATES.has("en_proceso")).toBe(true);
    expect(routeKnown("/v1/dte/{codigo}/invalidate")).toBe(true);
    expect(routeKnown("/v1/nope")).toBe(false);
  });

  it("every `facta.method` exists on the Facta client", () => {
    for (const [id, guide] of allGuides) {
      for (const text of strings(guide)) {
        for (const [, name] of text.matchAll(/\bfacta\.([A-Za-z_]\w*)/g)) {
          expect(FACTA_MEMBERS.has(name!), `${id}: facta.${name} is not a member of Facta in src/client.ts`).toBe(true);
        }
      }
    }
  });

  it("every error code of a recipe exists in src/errors.ts", () => {
    for (const [id, guide] of recipeGuides) {
      for (const error of guide.errors) expect(ERROR_CODES.has(error.code), `${id}: ${error.code} is not a FactaErrorCode`).toBe(true);
    }
  });

  it("a snake_case token in code font is a real error code or delivery state", () => {
    for (const [id, guide] of allGuides) {
      for (const text of strings(guide)) {
        for (const [, token] of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
          expect(ERROR_CODES.has(token!) || DELIVERY_STATES.has(token!), `${id}: \`${token}\` is neither an error code nor a delivery state`).toBe(true);
        }
      }
    }
  });

  it("every HTTP route behind a step is one the client calls", () => {
    for (const [id, guide] of recipeGuides) {
      for (const step of guide.steps) {
        for (const route of step.http ?? []) {
          const match = /^(GET|POST) (\/v1\/\S+)$/.exec(route);
          expect(match, `${id}: «${route}» is not «GET|POST /v1/...»`).not.toBeNull();
          expect(routeKnown(match![2]!), `${id}: ${route} is not a route in src/client.ts`).toBe(true);
        }
      }
    }
  });

  it("every SDK component or hook named by a page is exported by the SDK", () => {
    for (const [id, guide] of pageGuides) {
      for (const name of guide.sdk ?? []) {
        const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${name}\\b`).test(sdkSources);
        expect(exported, `${id}: ${name} is not exported under src/`).toBe(true);
      }
    }
  });

  it("every in-playground link points at a real recipe or section", () => {
    const recipes = new Set(RECIPE_SPECS.map((s) => s.id));
    for (const [id, guide] of allGuides) {
      for (const link of guide.more) {
        expect(link.to !== undefined || link.href !== undefined, `${id}: link «${link.label}» goes nowhere`).toBe(true);
        if (link.to !== undefined) {
          const recipe = /^\/servidor\?receta=([a-z-]+)$/.exec(link.to)?.[1];
          expect(recipe !== undefined && recipes.has(recipe), `${id}: ${link.to} is not a recipe route`).toBe(true);
        }
        if (link.href !== undefined) expect(link.href.startsWith("https://"), `${id}: ${link.href}`).toBe(true);
      }
    }
  });
});

describe("the copy keeps the project's voice", () => {
  const VOSEO = /\b(vos|tenés|podés|querés|sabés|elegí|mirá|usá|hacé|pulsá|fijate|sos)\b/i;
  it("addresses the reader as «usted» and never voseo", () => {
    for (const [id, guide] of allGuides) {
      for (const text of strings(guide)) expect(VOSEO.test(text), `${id}: voseo in «${text.slice(0, 60)}»`).toBe(false);
    }
  });

  it("uses the inline markup the renderer understands and nothing else", () => {
    for (const [id, guide] of allGuides) {
      for (const text of strings(guide)) {
        expect((text.match(/`/g) ?? []).length % 2, `${id}: unbalanced backtick in «${text.slice(0, 60)}»`).toBe(0);
        expect((text.match(/\*\*/g) ?? []).length % 2, `${id}: unbalanced ** in «${text.slice(0, 60)}»`).toBe(0);
        expect(/<[a-z/]/i.test(text), `${id}: HTML in a guide`).toBe(false);
      }
    }
  });

  it("states the figures the sources state", () => {
    const status = strings(RECIPE_GUIDES["status-recovery"]).join(" ");
    expect(status).toContain("250 ms");
    expect(status).toContain("5 intentos");
    expect(status).toContain("2 s");
    expect(read("playground/server/recipes/status-recovery.ts")).toContain("attempt <= 5");
    expect(read("playground/server/recipes/status-recovery.ts")).toContain("sleep(2_000)");
    expect(read("playground/server/recipes/specs.ts")).toContain("250 ms");
    expect(read("src/client.ts")).toContain("?? config?.maxRetries ?? 3");
  });
});

describe("what the visitor's browser remembers", () => {
  const fake = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

  it("opens «Cómo funciona» on the first visit and then the last tab used", () => {
    const store = fake();
    expect(readRecipeTab(store)).toBe("guia");
    writeRecipeTab("codigo", store);
    expect(readRecipeTab(store)).toBe("codigo");
    store.setItem(RECIPE_TAB_KEY, "something-old");
    expect(readRecipeTab(store)).toBe("guia");
  });

  it("opens a page card on the first visit, collapses it afterwards and remembers the choice", () => {
    const store = fake();
    expect(readPageGuideOpen("registro", store)).toBe(true);
    expect(readPageGuideOpen("registro", store)).toBe(false);
    expect(readPageGuideOpen("dialog", store)).toBe(true);
    writePageGuideOpen("registro", true, store);
    expect(readPageGuideOpen("registro", store)).toBe(true);
  });

  it("works with a store that throws", () => {
    expect(readRecipeTab(broken)).toBe("guia");
    expect(readPageGuideOpen("registro", broken)).toBe(true);
    expect(() => writeRecipeTab("probar", broken)).not.toThrow();
    expect(() => writePageGuideOpen("registro", false, broken)).not.toThrow();
    expect(readRecipeTab(null)).toBe("guia");
  });
});
