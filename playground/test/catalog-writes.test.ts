import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG_WRITE_ACTIONS } from "../../src/server/capabilities.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { CATALOG_WRITE_CODE, CATALOG_WRITE_MESSAGE, CATALOG_WRITE_METHODS, CatalogWriteRefused, isCatalogWriteAction, refuseCatalogWrites } from "../server/catalog-writes.ts";
import { handleApi } from "../server/router.ts";
import { fakeQuotaNamespace, turnstileEnv } from "./helpers.ts";

const NOW = 1_800_000_000_000;

describe("the playground never writes the catalog", () => {
  it("recognises every write action the SDK handler knows, and nothing that reads", () => {
    for (const action of CATALOG_WRITE_ACTIONS) expect(isCatalogWriteAction(action), action).toBe(true);
    for (const action of ["catalog.customers.search", "catalog.customers.get", "catalog.products.search", "catalog.products.get", "documents.list", "issue", undefined, 7]) {
      expect(isCatalogWriteAction(action), String(action)).toBe(false);
    }
    // A write action a later SDK adds under catalog.* is refused before anyone updates this list.
    expect(isCatalogWriteAction("catalog.customers.delete")).toBe(true);
    expect(isCatalogWriteAction("catalog.products.import")).toBe(false);
  });

  it("answers 403 to each write action on /api/facta, with the visible message, and never calls the client", async () => {
    const calls: string[] = [];
    const facta = new Proxy({ environment: "00" } as unknown as FactaLike, {
      get: (target, prop) => (prop in target ? Reflect.get(target, prop) : (...args: unknown[]) => { calls.push(String(prop)); return Promise.resolve(args); }),
    });
    const env = turnstileEnv({ QUOTA: fakeQuotaNamespace(() => NOW), FACTA_UNLOCK_KEY: "factauk_unit-test-secret-00" });
    for (const action of CATALOG_WRITE_ACTIONS) {
      // Anonymous, with a body that would be valid for the SDK: the refusal does not depend on who asks.
      const response = await handleApi(new Request("https://playground.factadte.com/api/facta", {
        method: "POST",
        headers: { "content-type": "application/json", "x-facta-ui": "1" },
        body: JSON.stringify({ action, id: "c1", input: { name: "Cliente" } }),
      }), env, { facta, now: () => NOW });
      expect(response.status, action).toBe(403);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe(CATALOG_WRITE_CODE);
      expect(body.error.message).toBe("Disponible en el SDK; el playground no modifica el catálogo.");
    }
    expect(calls).toEqual([]);
  });

  it("wraps a client so its six write methods refuse and the reads still work", async () => {
    const inner = { listCustomers: async () => ["c1"], createCustomer: async () => "created", get tag() { return "ok"; } };
    const guarded = refuseCatalogWrites(inner as unknown as { listCustomers(): Promise<string[]>; createCustomer(): Promise<string> });
    await expect(guarded.listCustomers()).resolves.toEqual(["c1"]);
    for (const method of CATALOG_WRITE_METHODS) {
      const call = (guarded as unknown as Record<string, () => Promise<unknown>>)[method]!;
      await expect(call()).rejects.toBeInstanceOf(CatalogWriteRefused);
      await expect(call()).rejects.toThrow(CATALOG_WRITE_MESSAGE);
    }
    expect((guarded as unknown as { tag: string }).tag).toBe("ok");
  });

  it("lists the same six methods the SDK client exposes", () => {
    const client = readFileSync(resolve(import.meta.dirname, "../../src/client.ts"), "utf8");
    const written = [...client.matchAll(/async (create|update|deactivate)(Customer|Product)\(/g)].map((m) => `${m[1]}${m[2]}`).sort();
    expect([...CATALOG_WRITE_METHODS].sort()).toEqual(written);
  });

  it("keeps the handler capability at read and no recipe or server file calls a write method", () => {
    const root = resolve(import.meta.dirname, "..");
    expect(readFileSync(resolve(root, "server/facta.ts"), "utf8")).not.toMatch(/catalog: "write"/);
    const files = [...readdirSync(resolve(root, "server/recipes")).map((n) => `server/recipes/${n}`), ...readdirSync(resolve(root, "server")).filter((n) => n.endsWith(".ts")).map((n) => `server/${n}`)];
    for (const file of files) {
      if (file.endsWith("catalog-writes.ts")) continue;
      const text = readFileSync(resolve(root, file), "utf8");
      for (const method of CATALOG_WRITE_METHODS) expect(text.includes(`.${method}(`), `${file} calls ${method}`).toBe(false);
    }
  });
});
