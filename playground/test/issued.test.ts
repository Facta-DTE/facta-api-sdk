import { describe, expect, it } from "vitest";
import { addIssued, ISSUED_MAX, ISSUED_RETENTION_MS, listIssued, ownsDocument, recordIssued, tagOfKey, type IssuedEntry } from "../server/issued.ts";
import { visitorTag } from "../server/hash.ts";
import { fakeQuotaNamespace } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const OTHER = "11111111-2222-4333-8444-555555555555";

describe("issued ledger (pure)", () => {
  it("adds newest first, upper-cases codes and refreshes a repeat", () => {
    const first = addIssued([], { codigoGeneracion: CODE.toLowerCase(), tipoDte: "01", at: NOW }, NOW);
    expect(first[0]?.codigoGeneracion).toBe(CODE);
    const second = addIssued(first, { codigoGeneracion: OTHER, tipoDte: "03", at: NOW + 1 }, NOW + 1);
    expect(second.map((e) => e.codigoGeneracion)).toEqual([OTHER, CODE]);
    const again = addIssued(second, { codigoGeneracion: CODE, tipoDte: "01", at: NOW + 2 }, NOW + 2);
    expect(again.map((e) => e.codigoGeneracion)).toEqual([CODE, OTHER]);
  });

  it("forgets old entries and caps the size", () => {
    const old: IssuedEntry = { codigoGeneracion: OTHER, tipoDte: "01", at: NOW - ISSUED_RETENTION_MS - 1 };
    expect(addIssued([old], { codigoGeneracion: CODE, tipoDte: "01", at: NOW }, NOW)).toHaveLength(1);
    let entries: IssuedEntry[] = [];
    for (let i = 0; i < ISSUED_MAX + 20; i++) {
      const code = `${String(i).padStart(8, "0")}-2222-4333-8444-555555555555`;
      entries = addIssued(entries, { codigoGeneracion: code, tipoDte: "01", at: NOW }, NOW);
    }
    expect(entries).toHaveLength(ISSUED_MAX);
  });

  it("reads the visitor tag out of an idempotency key", () => {
    expect(tagOfKey("0123456789abcdef.some-uuid")).toBe("0123456789abcdef");
    expect(tagOfKey("invalidate:ABC")).toBeNull();
    expect(tagOfKey("zzzz.abc")).toBeNull();
  });
});

describe("issued ledger (through the Durable Object)", () => {
  it("is per visitor and answers ownership", async () => {
    const quota = fakeQuotaNamespace(() => NOW);
    const ana = await visitorTag("ana@example.com");
    await recordIssued(quota, ana, { codigoGeneracion: CODE, tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000001" });
    expect((await listIssued(quota, "Ana@Example.com")).map((e) => e.codigoGeneracion)).toEqual([CODE]);
    expect(await ownsDocument(quota, "ana@example.com", CODE.toLowerCase())).toBe(true);
    expect(await ownsDocument(quota, "beto@example.com", CODE)).toBe(false);
  });

  it("refuses a malformed entry and never throws on the Worker side", async () => {
    const quota = fakeQuotaNamespace(() => NOW);
    const ana = await visitorTag("ana@example.com");
    await recordIssued(quota, ana, { codigoGeneracion: "not-a-uuid", tipoDte: "01" });
    expect(await listIssued(quota, "ana@example.com")).toEqual([]);
    await expect(recordIssued(undefined, ana, { codigoGeneracion: CODE, tipoDte: "01" })).resolves.toBeUndefined();
    expect(await listIssued(undefined, "ana@example.com")).toEqual([]);
  });

  it("keeps the quota counter and the ledger apart", async () => {
    const quota = fakeQuotaNamespace(() => NOW);
    const ana = await visitorTag("ana@example.com");
    await recordIssued(quota, ana, { codigoGeneracion: CODE, tipoDte: "01" });
    const stub = quota.get(quota.idFromName("ana@example.com"));
    const peek = await (await stub.fetch(new Request("https://quota/peek"))).json() as { remainingHour: number };
    expect(peek.remainingHour).toBe(20);
  });
});
