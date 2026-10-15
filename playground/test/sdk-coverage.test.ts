import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { COVERAGE, GROUPS, GUIDES, keysCoveredBy, type CoverageEntry } from "../shared/sdk-coverage.ts";
import { RECIPE_SPECS } from "../server/recipes/specs.ts";
import { SOURCES } from "../site/shown-files.ts";
import { enumerateSurface } from "./sdk-surface.ts";

const root = resolve(import.meta.dirname, "../..");
let keys: string[] = [];

beforeAll(() => {
  keys = enumerateSurface().keys;
}, 60_000);

describe("SDK coverage list", () => {
  it("covers every public export, client method, option, error code and handler action", () => {
    const covered = new Set(COVERAGE.flatMap((entry) => keysCoveredBy(entry, keys)));
    const missing = keys.filter((key) => !covered.has(key));
    expect(missing, `Add these to playground/shared/sdk-coverage.ts (a demo or a documented-only reason, and its guide):\n${missing.join("\n")}`).toEqual([]);
  });

  it("has no stale pattern: every entry of `covers` matches something the SDK really has", () => {
    const stale: string[] = [];
    for (const entry of COVERAGE) {
      for (const pattern of entry.covers) {
        const only: CoverageEntry = { ...entry, covers: [pattern] };
        if (keysCoveredBy(only, keys).length === 0) stale.push(`${entry.id}: ${pattern}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("finds the surface it is meant to check (a guard against checking nothing)", () => {
    expect(keys.length).toBeGreaterThan(450);
    for (const probe of ["Facta#issue", "Facta#registerReturn", "Facta#region", "Facta#catalogState", "mod:archivoDteOf", "mod:createReferenceClock", "server:createFactaHandler", "browser:createIssueFlow", "react:FactaInvoiceDialog", "error:not_sealed", "action:issue", "FactaRuntimeConfigV1.emergencyStore"]) {
      expect(keys, probe).toContain(probe);
    }
  });

  it("has unique ids, known groups, a paragraph of explanation and no empty group", () => {
    const ids = COVERAGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const entry of COVERAGE) {
      expect(groups.has(entry.group), entry.id).toBe(true);
      expect(entry.summary.length, entry.id).toBeGreaterThan(120);
      expect(entry.title.length, entry.id).toBeGreaterThan(5);
    }
    for (const group of GROUPS) expect(COVERAGE.some((e) => e.group === group.id), group.id).toBe(true);
  });

  it("points every runnable demo at a recipe that exists, and every shown file at a file the page imports", () => {
    const recipes = new Set(RECIPE_SPECS.map((s) => s.id));
    for (const entry of COVERAGE) {
      if (entry.demo.kind === "recipe" || entry.demo.kind === "simulated") expect(recipes.has(entry.demo.recipe), `${entry.id} → ${entry.demo.recipe}`).toBe(true);
      if (entry.code.kind === "file") expect(Object.hasOwn(SOURCES, entry.code.path), `${entry.id} shows ${entry.code.path}`).toBe(true);
    }
  });

  it("asks every documented-only entry for a reason and every snippet for an «Ilustrativo» label", () => {
    for (const entry of COVERAGE) {
      if (entry.demo.kind === "documented") {
        expect(entry.demo.reason.length, entry.id).toBeGreaterThan(40);
        expect(entry.code.kind, `${entry.id}: a documented-only entry shows an illustrative snippet`).toBe("snippet");
      }
      if (entry.demo.kind === "simulated") expect(entry.demo.note, entry.id).toMatch(/simulad|no /i);
      if (entry.code.kind === "snippet") expect(entry.code.label, entry.id).toMatch(/^Ilustrativo/);
      if (entry.code.kind === "snippet") expect(entry.code.text.length, entry.id).toBeGreaterThan(40);
    }
  });

  it("links existing guides (English, and Spanish where it claims to have one) and existing source files", () => {
    for (const entry of COVERAGE) {
      expect(entry.guides.length, entry.id).toBeGreaterThan(0);
      for (const stem of entry.guides) {
        const guide = GUIDES[stem];
        expect(guide, `${entry.id}: unknown guide ${stem}`).toBeDefined();
      }
      for (const file of entry.sources) expect(existsSync(resolve(root, file)), `${entry.id}: ${file}`).toBe(true);
    }
    for (const [stem, guide] of Object.entries(GUIDES)) {
      expect(existsSync(resolve(root, `guides/${stem}.md`)), `guides/${stem}.md`).toBe(true);
      if (guide.es) expect(existsSync(resolve(root, `guides/${stem}.es.md`)), `guides/${stem}.es.md`).toBe(true);
    }
  });

  it("names the playground's own limits: every catalog write is documented-only and says so", () => {
    for (const id of ["catalog-write-customers", "catalog-write-products"]) {
      const entry = COVERAGE.find((e) => e.id === id)!;
      expect(entry.demo.kind).toBe("documented");
      expect(entry.demo.kind === "documented" ? entry.demo.reason : "").toContain("Disponible en el SDK; el playground no modifica el catálogo.");
    }
    const writes = keys.filter((k) => /^Facta#(create|update|deactivate)(Customer|Product)$/.test(k));
    expect(writes).toHaveLength(6);
    for (const key of writes) {
      const entry = COVERAGE.find((e) => keysCoveredBy(e, [key]).length > 0)!;
      expect(entry.demo.kind, key).toBe("documented");
    }
  });

  it("keeps the source listing of shown files in step with what the coverage list shows", () => {
    // A runnable recipe must be reachable from the list: every recipe is the demo of some entry.
    const used = new Set(COVERAGE.flatMap((e) => (e.demo.kind === "recipe" || e.demo.kind === "simulated" ? [e.demo.recipe] : [])));
    const unreferenced = RECIPE_SPECS.map((s) => s.id).filter((id) => !used.has(id));
    expect(unreferenced).toEqual([]);
    expect(readFileSync(resolve(root, "playground/shared/sdk-coverage.ts"), "utf8")).not.toMatch(/facta_(test|live)_[A-Za-z0-9]{6,}\./);
  });
});
