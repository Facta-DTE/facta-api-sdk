import { describe, expect, it } from "vitest";
import { Facta } from "../../src/client.ts";
import { parseFixtures, publicFixtures } from "../server/fixtures.ts";
import { buildSale, customerFits, SaleError, SUPPORTED_SALE_TYPES } from "../server/sale.ts";

const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const business = { nombre: "Comercial Demo", tipoDocumento: "36", numDocumento: "06141234567890", nrc: "123456", codActividad: "46510", descActividad: "Venta", direccion: { departamento: "06", municipio: "20", complemento: "Centro" } };
const foreign = { nombre: "Buyer LLC", numDocumento: "US-1", codPais: "US", nombrePais: "United States", complemento: "Miami", tipoPersona: 2, descActividad: "Import", correo: "b@example.com" };
const excluded = { numDocumento: "00000000-0", nombre: "Persona Demo", direccion: { departamento: "06", municipio: "20", complemento: "Centro" } };

const fixtures = parseFixtures(JSON.stringify({
  customers: [
    { id: "biz", label: "Comercial", receptor: business },
    { id: "abroad", label: "Extranjero", receptor: foreign },
    { id: "person", label: "Persona", receptor: { nombre: "Ana", numDocumento: "00000000-0" } },
    { id: "excl", label: "Excluido", receptor: excluded },
  ],
  products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 10 }],
}));
const lines = [{ productId: "p1", cantidad: 2 }];
const asOwned = (codes: string[], tipoDte = "03") => codes.map((codigoGeneracion) => ({ codigoGeneracion, tipoDte }));
const build = (sale: Record<string, unknown>, ownedCodes: string[] = [], tipoDte = "03") => buildSale({ lines, ...sale }, fixtures, { owned: asOwned(ownedCodes, tipoDte) });
const code = (sale: Record<string, unknown>, ownedCodes: string[] = [], tipoDte = "03") => {
  try {
    build(sale, ownedCodes, tipoDte);
  } catch (error) {
    if (error instanceof SaleError) return error.code;
    throw error;
  }
  return "ok";
};

describe("sale builder · every type the API v1 supports", () => {
  it("offers exactly the six types of the SDK", () => {
    expect(SUPPORTED_SALE_TYPES.sort()).toEqual(["01", "03", "05", "06", "11", "14"]);
  });

  it("03 needs a contribuyente and keeps the price without VAT", () => {
    const { sale } = build({ tipoDte: "03", customerId: "biz" });
    expect(sale.request).toMatchObject({ tipoDte: "03", receptor: { nrc: "123456" }, items: [{ cantidad: 2, precioUni: 10 }] });
    expect(sale.total).toBe(20);
    expect(code({ tipoDte: "03" })).toBe("customer_required");
    expect(code({ tipoDte: "03", customerId: "person" })).toBe("customer_not_contributor");
  });

  it("05 and 06 only relate documents the visitor issued here", () => {
    const { sale } = build({ tipoDte: "05", customerId: "biz", relatedCode: CODE.toLowerCase() }, [CODE]);
    expect(sale.request).toMatchObject({ tipoDte: "05", documentosRelacionados: [{ codigoGeneracion: CODE }] });
    expect(build({ tipoDte: "06", customerId: "biz", relatedCode: CODE }, [CODE]).sale.request.tipoDte).toBe("06");
    expect(code({ tipoDte: "05", customerId: "biz", relatedCode: CODE }, [])).toBe("related_not_owned");
    expect(code({ tipoDte: "06", customerId: "biz" }, [CODE])).toBe("related_required");
  });

  it("05 and 06 may only correct a Crédito fiscal (03), never a Factura or any other type", () => {
    for (const note of ["05", "06"]) {
      for (const type of ["01", "11", "14", "05", "06"]) {
        expect(code({ tipoDte: note, customerId: "biz", relatedCode: CODE }, [CODE], type), `${note} over ${type}`).toBe("related_not_ccf");
      }
      expect(code({ tipoDte: note, customerId: "biz", relatedCode: CODE }, [CODE], "03")).toBe("ok");
    }
  });

  it("11 needs a foreign receiver and carries the SDK example's export block", () => {
    const { sale } = build({ tipoDte: "11", customerId: "abroad" });
    expect(sale.request).toMatchObject({ tipoDte: "11", receptor: { codPais: "US" }, exportacion: { tipoItemExpor: 1 } });
    expect(sale.request).not.toHaveProperty("exportacion.incoterms");
    expect(code({ tipoDte: "11", customerId: "biz" })).toBe("customer_unfit");
    expect(code({ tipoDte: "11" })).toBe("customer_required");
  });

  it("the built Exportación goes through the SDK's own issue path without an Incoterm", async () => {
    const { sale } = build({ tipoDte: "11", customerId: "abroad" });
    const bodies: unknown[] = [];
    const facta = new Facta({
      apiKey: "facta_test_unit.unit-test-secret",
      signKey: "factask_unit-test-secret-0000",
      baseUrl: "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/status")) return Response.json({ ok: true, version: "x", ambiente: "00", emisor: null, llave: { keyId: "k", label: null, modo: "custodian", alcances: ["issue"], tiposDte: ["11"] } });
        if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
        return Response.json({ estado: "sellado", codigoGeneracion: CODE, numeroControl: "DTE-11-M001P001-000000000000001", tipoDte: "11", ambiente: "00", fecEmi: "2026-10-06", selloRecibido: "S", totales: {}, observaciones: [] });
      }) as typeof fetch,
    });
    const result = await facta.issue(sale.request, { idempotencyKey: "unit-fex" });
    expect(result.estado).toBe("sellado");
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies[0])).not.toContain("incoterms");
    expect(bodies[0]).toMatchObject({ exportacion: { tipoItemExpor: 1 } });
  });

  it("14 needs document and address and never withholds income tax on its own", () => {
    const { sale } = build({ tipoDte: "14", customerId: "excl" });
    expect(sale.request).toMatchObject({ tipoDte: "14", aplicarReteRenta: false });
    expect(code({ tipoDte: "14", customerId: "person" })).toBe("customer_unfit");
  });

  it("falls back to the receiver of a fixture request when no customer is chosen", () => {
    const withFallback = parseFixtures(JSON.stringify({ "03": { tipoDte: "03", items: [], receptor: business } }));
    const { sale } = buildSale({ tipoDte: "03", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 5, tipoItem: 2 }] }, withFallback);
    expect(sale.request).toMatchObject({ receptor: { nrc: "123456" } });
    expect(publicFixtures(withFallback).builtInReceivers).toEqual(["03"]);
  });

  it("tells the page which customers fit which type, without exposing the receiver", () => {
    expect(customerFits(business)).toEqual(["01", "03", "05", "06"]);
    expect(customerFits(foreign)).toEqual(["01", "11"]);
    expect(customerFits(excluded)).toEqual(["01", "14"]);
    const shown = publicFixtures(fixtures);
    expect(shown.customers.find((c) => c.id === "abroad")?.fits).toEqual(["01", "11"]);
    expect(JSON.stringify(shown)).not.toContain("06141234567890");
  });

  it("does not let a prototype key pass for a type", () => {
    expect(code({ tipoDte: "constructor" })).toBe("type_unsupported");
    expect(code({ tipoDte: "__proto__" })).toBe("type_unsupported");
  });
});

describe("typed receiver name (Factura only)", () => {
  it("accepts a name and nothing else about the receiver", () => {
    const { sale } = build({ tipoDte: "01", receptorNombre: "  María Prueba ", correo: "x@example.com", numDocumento: "1" });
    expect(sale.request.receptor).toEqual({ nombre: "María Prueba" });
  });

  it("refuses an empty or long name, and both a name and a customer", () => {
    expect(code({ tipoDte: "01", receptorNombre: "  " })).toBe("receptor_field_required");
    expect(code({ tipoDte: "01", receptorNombre: "x".repeat(101) })).toBe("receptor_invalid");
    expect(code({ tipoDte: "01", receptorNombre: "Ana", customerId: "biz" })).toBe("customer_ambiguous");
  });

  it("a typed name alone is not a taxpayer", () => {
    expect(code({ tipoDte: "03", receptorNombre: "Ana" })).toBe("receptor_field_required");
  });
});
