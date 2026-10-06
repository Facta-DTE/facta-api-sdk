import { describe, expect, it } from "vitest";
import { FixturesError, parseFixtures, publicFixtures } from "../server/fixtures.ts";
import { buildSale, MAX_TOTAL, SaleError } from "../server/sale.ts";

const fixtures = parseFixtures(JSON.stringify({
  customers: [{ id: "c1", label: "Cliente demo", receptor: { nombre: "Cliente Demo", numDocumento: "00000000-0" } }],
  products: [{ id: "p1", label: "Café", descripcion: "Café de altura", precioUni: 8.5 }],
}));

const fail = (input: unknown) => {
  try {
    buildSale(input, fixtures);
  } catch (error) {
    if (error instanceof SaleError) return error.code;
    throw error;
  }
  return "ok";
};

describe("sale builder", () => {
  it("builds a Factura from free lines", () => {
    const { sale, sendEmail } = buildSale({ tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 2, precioUni: 1.5 }] }, fixtures);
    expect(sale.request).toEqual({ tipoDte: "01", items: [{ descripcion: "Servicio", cantidad: 2, precioUni: 1.5 }] });
    expect(sale.total).toBe(3);
    expect(sendEmail).toBe(false);
  });

  it("uses a demo customer and demo products by id", () => {
    const { sale } = buildSale({ tipoDte: "01", customerId: "c1", sendEmail: true, lines: [{ productId: "p1", cantidad: 3 }] }, fixtures);
    expect(sale.request.receptor).toMatchObject({ nombre: "Cliente Demo" });
    expect(sale.request.items[0]).toMatchObject({ descripcion: "Café de altura", precioUni: 8.5 });
    expect(sale.total).toBe(25.5);
  });

  it("never copies unknown fields from the input into the request", () => {
    const { sale } = buildSale({ tipoDte: "01", ambiente: "01", receptor: { nombre: "x" }, lines: [{ descripcion: "a", cantidad: 1, precioUni: 1, ivaItem: 99 }] }, fixtures);
    expect(JSON.stringify(sale.request)).not.toContain("ambiente");
    expect(JSON.stringify(sale.request)).not.toContain("ivaItem");
    expect(sale.request.receptor).toBeUndefined();
  });

  it("refuses what it cannot build", () => {
    expect(fail(null)).toBe("sale_invalid");
    expect(fail({ tipoDte: "04", lines: [] })).toBe("type_unsupported");
    expect(fail({ tipoDte: "01" })).toBe("lines_invalid");
    expect(fail({ tipoDte: "01", lines: [] })).toBe("lines_invalid");
    expect(fail({ tipoDte: "01", lines: Array(11).fill({ descripcion: "a", cantidad: 1, precioUni: 1 }) })).toBe("lines_invalid");
    expect(fail({ tipoDte: "01", lines: [{ descripcion: "a", cantidad: 0, precioUni: 1 }] })).toBe("quantity_invalid");
    expect(fail({ tipoDte: "01", lines: [{ descripcion: "a", cantidad: 1.5, precioUni: 1 }] })).toBe("quantity_invalid");
    expect(fail({ tipoDte: "01", lines: [{ descripcion: "", cantidad: 1, precioUni: 1 }] })).toBe("description_invalid");
    expect(fail({ tipoDte: "01", lines: [{ descripcion: "a", cantidad: 1, precioUni: 0 }] })).toBe("price_invalid");
    expect(fail({ tipoDte: "01", lines: [{ productId: "nope", cantidad: 1 }] })).toBe("product_unknown");
    expect(fail({ tipoDte: "01", customerId: "nope", lines: [{ descripcion: "a", cantidad: 1, precioUni: 1 }] })).toBe("customer_unknown");
    expect(fail({ tipoDte: "01", lines: [{ descripcion: "a", cantidad: 1000, precioUni: MAX_TOTAL }] })).toBe("total_too_high");
  });
});

describe("fixtures", () => {
  it("never exposes receptor fields to the browser", () => {
    expect(JSON.stringify(publicFixtures(fixtures))).not.toContain("00000000-0");
  });

  it("accepts the live-test shape keyed by DTE type", () => {
    const parsed = parseFixtures(JSON.stringify({ "03": { tipoDte: "03", items: [] } }));
    expect(Object.keys(parsed.requests)).toEqual(["03"]);
  });

  it("rejects malformed data without echoing it", () => {
    for (const raw of ["{", "[]", JSON.stringify({ "03": { tipoDte: "01", items: [] } }), JSON.stringify({ products: [{ id: "x" }] })]) {
      expect(() => parseFixtures(raw)).toThrow(FixturesError);
    }
  });
});
