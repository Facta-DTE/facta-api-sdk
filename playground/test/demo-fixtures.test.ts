import { describe, expect, it } from "vitest";
import demo from "../fixtures/demo.json";
import { DEMO_FIXTURES, loadFixturesOf, parseFixtures, publicFixtures } from "../server/fixtures.ts";
import { buildSale } from "../server/sale.ts";

// Check digits as the Facta application computes them (the SDK itself only checks lengths):
// DUI weights 9..2 over eight digits; NIT with two branches chosen by the correlativo.
const digits = (value: string) => value.replace(/\D/g, "");
function duiOk(value: string): boolean {
  const d = digits(value);
  if (d.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * (9 - i);
  return (10 - (sum % 10)) % 10 === Number(d[8]);
}
function nitOk(value: string): boolean {
  const d = digits(value);
  if (d.length !== 14) return false;
  const n = d.split("").map(Number);
  let sum = 0;
  if (Number(d.slice(10, 13)) <= 100) {
    for (let i = 1; i <= 13; i++) sum += n[i - 1]! * (15 - i);
    const r = sum % 11;
    return (r === 10 ? 0 : r) === n[13];
  }
  for (let i = 1; i <= 13; i++) sum += n[i - 1]! * (3 + 6 * Math.floor((i + 4) / 6) - i);
  const r = sum % 11;
  return (r > 1 ? 11 - r : 0) === n[13];
}

describe("committed demo fixtures", () => {
  it("are the default when the secret is unset or empty, and a secret replaces them completely", () => {
    expect(loadFixturesOf(undefined)).toBe(DEMO_FIXTURES);
    expect(loadFixturesOf("  ")).toBe(DEMO_FIXTURES);
    const custom = loadFixturesOf(JSON.stringify({ products: [{ id: "p", label: "P", descripcion: "P", precioUni: 1 }] }));
    expect(custom.customers).toEqual([]);
    expect(custom.products.map((p) => p.id)).toEqual(["p"]);
  });

  it("parse with the production parser and carry every kind of party the blocked flows need", () => {
    const parsed = parseFixtures(JSON.stringify(demo));
    expect(parsed.invalidation).not.toBeNull();
    const pub = publicFixtures(parsed);
    expect(pub.canInvalidate).toBe(true);
    const fits = new Set(pub.customers.flatMap((c) => c.fits));
    for (const type of ["01", "03", "05", "06", "11", "14"]) expect(fits.has(type), type).toBe(true);
  });

  it("use fictitious identities whose DUI and NIT pass their check digits", () => {
    const people = [...demo.customers.map((c) => c.receptor as Record<string, unknown>), demo.invalidation.responsable, demo.invalidation.solicita];
    let checked = 0;
    for (const person of people) {
      const doc = String(person.numDocumento);
      if (person.tipoDocumento === "13") { expect(duiOk(doc), doc).toBe(true); checked++; }
      if (person.tipoDocumento === "36") { expect(nitOk(doc), doc).toBe(true); checked++; }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    // NRC: shape only (2 to 8 digits, never all zeros).
    for (const c of demo.customers) {
      const nrc = (c.receptor as { nrc?: string }).nrc;
      if (nrc !== undefined) expect(/^\d{2,8}$/.test(nrc) && !/^0+$/.test(nrc)).toBe(true);
    }
  });

  it("name nobody real: invented companies, example domains, no company of the playground owner", () => {
    const text = JSON.stringify(demo);
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email.endsWith(".example"), email).toBe(true);
    for (const forbidden of [/facta/i, /quevedo/i, /marvin/i, /osiel/i]) expect(text).not.toMatch(forbidden);
    expect(demo.customers.some((c) => /Demo/.test(c.label))).toBe(true);
  });

  it("build a sale for every type the playground can issue without anything typed", () => {
    const owned = [{ codigoGeneracion: "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D", tipoDte: "03" }];
    const line = { source: "demo", productId: "cafe", cantidad: 1 };
    const cases: Array<[string, string | undefined]> = [["01", "demo-persona"], ["03", "demo-comercial"], ["05", "demo-comercial"], ["06", "demo-servicios"], ["11", "demo-extranjero"], ["14", "demo-proveedor"]];
    for (const [type, customerId] of cases) {
      const note = type === "05" || type === "06";
      const { sale } = buildSale({
        tipoDte: type,
        receptor: { source: "demo", customerId },
        lines: [line],
        ...(note ? { relatedCode: owned[0]!.codigoGeneracion } : {}),
      }, DEMO_FIXTURES, { owned });
      expect(sale.request.tipoDte).toBe(type);
    }
  });
});
