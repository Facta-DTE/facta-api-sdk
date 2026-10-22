import { describe, expect, it } from "vitest";
import { verifyFactaSession } from "../../src/server/session.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import type { CatalogCustomer, CatalogProduct } from "../../src/types.ts";
import { handleApi } from "../server/router.ts";
import { parseFixtures } from "../server/fixtures.ts";
import { buildSale, SaleError, type CatalogLookup } from "../server/sale.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const direccion = { departamento: "06", municipio: "20", complemento: "Centro de San Salvador" };

const taxpayer = { nombre: "Comercial Prueba", tipoDocumento: "36", numDocumento: "06141234567890", nrc: "123456", codActividad: "46510", descActividad: "Venta al por mayor", direccion, correo: "compras@example.com" };
const foreign = { nombre: "Buyer LLC", numDocumento: "US-998877", codPais: "US", nombrePais: "United States", complemento: "Miami, Florida", tipoPersona: 2, descActividad: "Import", correo: "buyer@example.com" };
const excluded = { nombre: "Rosa Campos", tipoDocumento: "13", numDocumento: "048293165", direccion };
const customLine = { source: "custom", descripcion: "Servicio de prueba", cantidad: 2, precioUni: 5, tipoItem: 2 };

const fixtures = parseFixtures(JSON.stringify({
  customers: [{ id: "demo-biz", label: "Demo", receptor: { ...taxpayer } }],
  products: [{ id: "demo-p", label: "Café", descripcion: "Café", precioUni: 10 }],
}));

const catalog: CatalogLookup = {
  customers: new Map<string, CatalogCustomer>([
    ["cat-biz", { id: "cat-biz", name: "Catálogo SA", doc_number: "06149999999999", nrc: "654321" }],
    ["cat-person", { id: "cat-person", name: "Ana" }],
  ]),
  products: new Map<string, CatalogProduct>([
    ["cat-net", { id: "cat-net", description: "Neto", item_type: 1, unit_price: 20, vat_included: false, active: true }],
    ["cat-gross", { id: "cat-gross", description: "Con IVA", item_type: 2, unit_price: 11.3, vat_included: true, active: true }],
    ["cat-untyped", { id: "cat-untyped", description: "Sin tipo", unit_price: 1, vat_included: false, active: true }],
  ]),
};

const run = (sale: Record<string, unknown>, owned: string[] = [CODE]) => buildSale({ lines: [customLine], ...sale }, fixtures, { owned: owned.map((codigoGeneracion) => ({ codigoGeneracion, tipoDte: "03" })), catalog });
const code = (sale: Record<string, unknown>, owned?: string[]) => {
  try {
    run(sale, owned);
  } catch (error) {
    if (error instanceof SaleError) return error.code;
    throw error;
  }
  return "ok";
};
const custom = (fields: Record<string, unknown>) => ({ receptor: { source: "custom", custom: fields } });

describe("catalog source", () => {
  it("sends ids only, never copied customer data, and prices the total from the product", () => {
    const { sale } = run({ tipoDte: "03", receptor: { source: "catalog", customerId: "cat-biz" }, lines: [{ source: "catalog", productId: "cat-net", cantidad: 3 }] });
    expect(sale.request).toEqual({ tipoDte: "03", receptor: { customerId: "cat-biz" }, items: [{ productId: "cat-net", cantidad: 3 }] });
    expect(sale.total).toBe(60);
  });

  it("serves 01, 05 and 06 too", () => {
    expect(run({ tipoDte: "01", receptor: { source: "catalog", customerId: "cat-person" }, lines: [{ source: "catalog", productId: "cat-gross", cantidad: 1 }] }).sale.request.receptor).toEqual({ customerId: "cat-person" });
    expect(run({ tipoDte: "05", relatedCode: CODE, receptor: { source: "catalog", customerId: "cat-biz" } }).sale.request).toMatchObject({ tipoDte: "05", receptor: { customerId: "cat-biz" } });
    expect(run({ tipoDte: "06", relatedCode: CODE, receptor: { source: "catalog", customerId: "cat-biz" } }).sale.request.tipoDte).toBe("06");
  });

  it("refuses an id the catalog does not have (forged or stale)", () => {
    expect(code({ tipoDte: "03", receptor: { source: "catalog", customerId: "forged" } })).toBe("customer_not_in_catalog");
    expect(code({ tipoDte: "03", receptor: { source: "catalog", customerId: "../etc" } })).toBe("customer_not_in_catalog");
    expect(code({ tipoDte: "01", lines: [{ source: "catalog", productId: "forged", cantidad: 1 }] })).toBe("product_not_in_catalog");
    expect(code({ tipoDte: "01", lines: [{ source: "catalog", cantidad: 1 }] })).toBe("product_not_in_catalog");
  });

  it("needs a contribuyente for 03/05/06", () => {
    expect(code({ tipoDte: "03", receptor: { source: "catalog", customerId: "cat-person" } })).toBe("customer_not_contributor");
  });

  it("is not offered for 11 and 14, whose receiver has no customerId in the API", () => {
    expect(code({ tipoDte: "11", receptor: { source: "catalog", customerId: "cat-biz" } })).toBe("catalog_receiver_unsupported");
    expect(code({ tipoDte: "14", receptor: { source: "catalog", customerId: "cat-biz" } })).toBe("catalog_receiver_unsupported");
  });

  it("refuses a product whose price basis does not match the document, or without a type", () => {
    expect(code({ tipoDte: "01", lines: [{ source: "catalog", productId: "cat-net", cantidad: 1 }] })).toBe("product_vat_basis");
    expect(code({ tipoDte: "03", receptor: { source: "catalog", customerId: "cat-biz" }, lines: [{ source: "catalog", productId: "cat-gross", cantidad: 1 }] })).toBe("product_vat_basis");
    expect(code({ tipoDte: "01", lines: [{ source: "catalog", productId: "cat-untyped", cantidad: 1 }] })).toBe("product_item_type_invalid");
  });

  it("works for lines on 11 and 14 (productId exists on every line)", () => {
    expect(code({ tipoDte: "11", receptor: { source: "custom", custom: foreign }, lines: [{ source: "catalog", productId: "cat-net", cantidad: 1 }] })).toBe("ok");
    expect(code({ tipoDte: "14", receptor: { source: "custom", custom: excluded }, lines: [{ source: "catalog", productId: "cat-gross", cantidad: 1 }] })).toBe("ok");
  });
});

describe("demo source", () => {
  it("still works by source", () => {
    const { sale } = run({ tipoDte: "03", receptor: { source: "demo", customerId: "demo-biz" }, lines: [{ source: "demo", productId: "demo-p", cantidad: 2 }] });
    expect(sale.request).toMatchObject({ receptor: { nrc: "123456" }, items: [{ descripcion: "Café", cantidad: 2, precioUni: 10 }] });
    expect(sale.total).toBe(20);
    expect(code({ tipoDte: "03", receptor: { source: "demo", customerId: "nope" } })).toBe("customer_unknown");
    expect(code({ tipoDte: "03", receptor: { source: "demo" } })).toBe("customer_required");
  });
});

describe("custom receiver, per type", () => {
  it("01: a name is enough; document and address are optional but checked when given", () => {
    expect(run({ tipoDte: "01", ...custom({ nombre: "María" }) }).sale.request.receptor).toEqual({ nombre: "María" });
    expect(run({ tipoDte: "01", ...custom({ nombre: "María", tipoDocumento: "13", numDocumento: "04829316-5", correo: "m@example.com", telefono: "7000-0000", direccion }) }).sale.request.receptor)
      .toMatchObject({ tipoDocumento: "13", numDocumento: "048293165", correo: "m@example.com", direccion });
    expect(code({ tipoDte: "01", ...custom({}) })).toBe("receptor_field_required");
    expect(code({ tipoDte: "01", ...custom({ nombre: "María", tipoDocumento: "13" }) })).toBe("receptor_field_required");
    expect(code({ tipoDte: "01", ...custom({ nombre: "María", direccion: { departamento: "06" } }) })).toBe("address_invalid");
    expect(code({ tipoDte: "01", ...custom({ nombre: "María", correo: "nope" }) })).toBe("email_invalid");
  });

  it("03/05/06: every contribuyente field", () => {
    for (const tipoDte of ["03", "05", "06"]) {
      expect(run({ tipoDte, relatedCode: CODE, ...custom(taxpayer) }).sale.request.receptor).toMatchObject({ nrc: "123456", numDocumento: "06141234567890", codActividad: "46510" });
    }
    for (const field of ["nombre", "tipoDocumento", "numDocumento", "nrc", "codActividad", "descActividad", "correo", "direccion"]) {
      const { [field]: _removed, ...rest } = taxpayer as Record<string, unknown>;
      expect(code({ tipoDte: "03", ...custom(rest) }), field).toBe("receptor_field_required");
    }
  });

  it("refuses a CCF without NRC and an NRC of zeros", () => {
    const { nrc: _nrc, ...noNrc } = taxpayer;
    expect(code({ tipoDte: "03", ...custom(noNrc) })).toBe("receptor_field_required");
    for (const nrc of ["0", "000000", "00000000", "1", "123456789", "12a456"]) {
      expect(code({ tipoDte: "03", ...custom({ ...taxpayer, nrc }) }), nrc).toBe("nrc_invalid");
    }
    expect(run({ tipoDte: "03", ...custom({ ...taxpayer, nrc: "12345-6" }) }).sale.request.receptor).toMatchObject({ nrc: "123456" });
  });

  it("DUI travels as 9 digits: a typed dash is removed, other shapes are refused", () => {
    expect(run({ tipoDte: "03", ...custom({ ...taxpayer, tipoDocumento: "13", numDocumento: "04829316-5" }) }).sale.request.receptor).toMatchObject({ tipoDocumento: "13", numDocumento: "048293165" });
    for (const numDocumento of ["04829316", "0482931655", "0482-93165", "04829316--5", "abcdefghi"]) {
      expect(code({ tipoDte: "03", ...custom({ ...taxpayer, tipoDocumento: "13", numDocumento }) }), numDocumento).toBe("dui_invalid");
    }
  });

  it("NIT travels as 14 digits", () => {
    expect(run({ tipoDte: "03", ...custom({ ...taxpayer, numDocumento: "0614-123456-789-0" }) }).sale.request.receptor).toMatchObject({ numDocumento: "06141234567890" });
    for (const numDocumento of ["0614123456789", "061412345678901", "048293165"]) {
      expect(code({ tipoDte: "03", ...custom({ ...taxpayer, numDocumento }) }), numDocumento).toBe("nit_invalid");
    }
    expect(code({ tipoDte: "03", ...custom({ ...taxpayer, tipoDocumento: "99" }) })).toBe("document_type_invalid");
    expect(code({ tipoDte: "03", ...custom({ ...taxpayer, tipoDocumento: "37" }) })).toBe("document_type_invalid");
  });

  it("11: the foreign receiver's fields, with tipoPersona chosen", () => {
    const { sale } = run({ tipoDte: "11", ...custom({ ...foreign, codPais: "us" }) });
    expect(sale.request).toMatchObject({ tipoDte: "11", receptor: { codPais: "US", tipoPersona: 2, nombrePais: "United States" }, exportacion: { tipoItemExpor: 1 } });
    // `incoterms` must be a CAT-031 code and the SDK ships no catalogue: it is left out, never invented.
    expect(sale.request).not.toHaveProperty("exportacion.incoterms");
    for (const field of ["nombre", "numDocumento", "codPais", "nombrePais", "complemento", "tipoPersona", "descActividad", "correo"]) {
      const { [field]: _removed, ...rest } = foreign as Record<string, unknown>;
      expect(code({ tipoDte: "11", ...custom(rest) }), field).toBe("receptor_field_required");
    }
    expect(code({ tipoDte: "11", ...custom({ ...foreign, codPais: "USA" }) })).toBe("country_invalid");
    expect(code({ tipoDte: "11", ...custom({ ...foreign, tipoPersona: 3 }) })).toBe("receptor_field_required");
  });

  it("14: the supplier, with a document and an address, and no NRC", () => {
    const { sale } = run({ tipoDte: "14", ...custom(excluded) });
    expect(sale.request).toMatchObject({ tipoDte: "14", receptor: { numDocumento: "048293165", direccion }, aplicarReteRenta: false });
    expect(JSON.stringify(sale.request.receptor)).not.toContain("nrc");
    expect(code({ tipoDte: "14", ...custom({ nombre: "Rosa" }) })).toBe("receptor_field_required");
    expect(code({ tipoDte: "14", ...custom({ ...excluded, direccion: undefined }) })).toBe("receptor_field_required");
    expect(code({ tipoDte: "14", ...custom({ ...excluded, codActividad: "abc" }) })).toBe("activity_invalid");
  });

  it("copies nothing the visitor did not type, and no unknown field", () => {
    const { sale } = run({ tipoDte: "03", ...custom({ ...taxpayer, customerId: "cat-biz", ivaRete1: true, extra: "x" }) });
    const text = JSON.stringify(sale.request);
    expect(text).not.toContain("customerId");
    expect(text).not.toContain("ivaRete1");
    expect(text).not.toContain("extra");
  });
});

describe("custom lines", () => {
  it("need the item type chosen by the visitor, no default", () => {
    const { tipoItem: _t, ...noType } = customLine;
    expect(code({ tipoDte: "01", lines: [noType] })).toBe("item_type_required");
    expect(code({ tipoDte: "01", lines: [{ ...customLine, tipoItem: 0 }] })).toBe("item_type_required");
    expect(code({ tipoDte: "01", lines: [{ ...customLine, tipoItem: "1" }] })).toBe("item_type_required");
    expect(run({ tipoDte: "01", lines: [{ ...customLine, tipoItem: 1, codigo: " SKU-1 " }] }).sale.request.items[0]).toEqual({ descripcion: "Servicio de prueba", cantidad: 2, precioUni: 5, tipoItem: 1, codigo: "SKU-1" });
  });

  it("keep the earlier limits and bound the optional code", () => {
    expect(code({ tipoDte: "01", lines: [{ ...customLine, precioUni: 1000.01 }] })).toBe("price_invalid");
    expect(code({ tipoDte: "01", lines: [{ ...customLine, descripcion: "x".repeat(101) }] })).toBe("description_invalid");
    expect(code({ tipoDte: "01", lines: [{ ...customLine, codigo: "x".repeat(26) }] })).toBe("code_invalid");
    expect(code({ tipoDte: "01", lines: [{ ...customLine, source: "other" }] })).toBe("line_source_invalid");
  });
});

describe("POST /api/session: the catalog is confirmed on the Worker", () => {
  const NOW = 1_800_000_000_000;
  const seconds = Math.floor(NOW / 1000);

  async function world(options: { unlock: boolean; failWith?: Error }) {
    const keys = await makeKeys();
    const lookups: string[] = [];
    const facta = {
      environment: "00",
      issue: (async () => { throw new Error("unused"); }) as unknown as FactaLike["issue"],
      getDocumentStatus: (async () => { throw new Error("unused"); }) as unknown as FactaLike["getDocumentStatus"],
      getCustomer: async (id: string) => {
        lookups.push(`customer:${id}`);
        if (options.failWith) throw options.failWith;
        return catalog.customers.get(id) ?? null;
      },
      getProduct: async (id: string) => {
        lookups.push(`product:${id}`);
        return catalog.products.get(id) ?? null;
      },
    } as unknown as FactaLike;
    const env = goodEnv({ QUOTA: fakeQuotaNamespace(() => NOW), ...(options.unlock ? { FACTA_UNLOCK_KEY: "factaul_test-unlock-key-0000" } : {}) });
    const token = await keys.sign(accessClaims(seconds, { email: "ana@example.com" }));
    const post = (body: unknown) => handleApi(new Request("https://playground.factadte.com/api/session", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-facta-ui": "1", "cf-access-jwt-assertion": token },
    }), env, { keys: async () => [keys.jwk], now: () => NOW, facta });
    return { post, env, lookups };
  }

  const sale = (id: string) => ({ tipoDte: "03", receptor: { source: "catalog", customerId: id }, lines: [{ source: "catalog", productId: "cat-net", cantidad: 1 }] });

  it("seals a session that carries ids only", async () => {
    const { post, env, lookups } = await world({ unlock: true });
    const response = await post(sale("cat-biz"));
    expect(response.status).toBe(200);
    const body = await response.json() as { session: string; total: number };
    expect(lookups).toEqual(["customer:cat-biz", "product:cat-net"]);
    const session = await verifyFactaSession(body.session, env.FACTA_SESSION_SECRET!, NOW);
    expect(session.request).toEqual({ tipoDte: "03", receptor: { customerId: "cat-biz" }, items: [{ productId: "cat-net", cantidad: 1 }] });
    // The request carries the id; only the review label (name + masked document) names the customer.
    expect(JSON.stringify(session.request)).not.toContain("Catálogo SA");
    expect(session.display?.recipient).toBe("Catálogo SA · Doc. ••••999");
    expect(JSON.stringify(session)).not.toContain("06149999999999");
    expect(body.total).toBe(20);
  });

  it("refuses a forged customerId with 400 and seals nothing", async () => {
    const { post } = await world({ unlock: true });
    const response = await post(sale("someone-elses-customer"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "customer_not_in_catalog" } });
  });

  it("refuses the catalog source when the Worker cannot read the catalog (no unlock key)", async () => {
    const { post, lookups } = await world({ unlock: false });
    const response = await post(sale("cat-biz"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "catalog_unavailable" } });
    expect(lookups).toEqual([]);
  });

  it("answers 502 without echoing the SDK's detail when the catalog cannot be read", async () => {
    const { FactaError } = await import("../../src/errors.ts");
    const { post } = await world({ unlock: true, failWith: new FactaError("service_unavailable", "secret detail 12345", 503) });
    const response = await post(sale("cat-biz"));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  it("does not touch the catalog for demo or custom sales", async () => {
    const { post, lookups } = await world({ unlock: true });
    expect((await post({ tipoDte: "01", receptor: { source: "custom", custom: { nombre: "María" } }, lines: [customLine] })).status).toBe(200);
    expect(lookups).toEqual([]);
  });

  it("reports the field a custom receiver failed on", async () => {
    const { post } = await world({ unlock: true });
    const { nrc: _nrc, ...noNrc } = taxpayer;
    const response = await post({ tipoDte: "03", receptor: { source: "custom", custom: noNrc }, lines: [customLine] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "receptor_field_required", field: "nrc" } });
  });
});
