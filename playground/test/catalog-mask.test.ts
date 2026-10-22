import { describe, expect, it } from "vitest";
import { maskCustomer, maskName, maskProduct } from "../server/catalog-mask.ts";

const customer = {
  id: "c-1",
  name: "Pablo La Esquina",
  doc_type: "36",
  doc_number: "0614-210389-102-4",
  nrc: "123456-7",
  activity_code: "47190",
  address: { departamento: "06", municipio: "14", distrito: "01", complemento: "Colonia Escalon, calle 5, casa 22", pais: "SV" },
  phone: "2222-3344",
  email: "carlos.perez@empresa.com.sv",
  nombreComercial: "Distribuidora Luna",
};

// Windows are taken inside each word: a masked name keeps two letters of each, so «La Es» is not a leak.
const windows = (s: string, n = 4) => Array.from({ length: Math.max(0, s.length - n + 1) }, (_, i) => s.slice(i, i + n));

describe("maskCustomer", () => {
  const masked = maskCustomer(customer);

  it("keeps every key, including the nested address", () => {
    expect(Object.keys(masked)).toEqual(expect.arrayContaining(Object.keys(customer)));
    expect(Object.keys(masked.address as object).sort()).toEqual(["complemento", "departamento", "distrito", "municipio", "pais"]);
  });

  it("masks values as specified", () => {
    expect(masked.name).toBe("Pa••• La Es•••••");
    expect(masked.doc_number).toBe("••••-••••••-•02-4");
    expect(masked.nrc).toBe("•••••6-7");
    expect(masked.email).toBe("c•••@empresa.com.sv");
    expect(masked.phone).toBe("••••-••44");
    expect(masked.address).toMatchObject({ departamento: "06", municipio: "14", distrito: "01", pais: "SV", complemento: "•••• (oculta)" });
    expect(masked.activity_code).toBe("47190");
    expect(masked.doc_type).toBe("36");
    expect(masked.id).toBe("c-1");
  });

  it("leaves no original personal substring of four characters or more", () => {
    const values = (v: unknown): string[] => (typeof v === "string" ? [v] : typeof v === "object" && v !== null ? Object.values(v).flatMap(values) : []);
    const out = values({ ...masked, email: undefined }).map((v) => v.toLowerCase());
    for (const field of [customer.name, customer.doc_number, customer.nrc, customer.phone, customer.address.complemento, customer.email.split("@")[0]!, customer.nombreComercial]) {
      for (const w of field!.split(/[^0-9A-Za-z]+/).flatMap((token) => windows(token.toLowerCase()))) expect(out.some((v) => v.includes(w)), `${field} -> ${w}`).toBe(false);
    }
  });

  it("shows «—» for absent fields and still lists the whole shape", () => {
    const sparse = maskCustomer({ id: "c-2" });
    expect(sparse).toMatchObject({ name: "—", doc_type: "—", doc_number: "—", nrc: "—", activity_code: "—", phone: "—", email: "—" });
    expect(sparse.address).toEqual({ departamento: "—", municipio: "—", distrito: "—", pais: "—", complemento: "—" });
  });

  it("masks unknown customer fields instead of showing them", () => {
    expect(maskCustomer({ id: "c-3", extra: { note: "secreto importante" }, flag: true }).extra).toEqual({ note: "se••••• im••••••••" });
  });
});

describe("maskName", () => {
  it("keeps two characters of each word", () => expect(maskName("Ana de la Cruz")).toBe("An• de la Cr••"));
});

describe("maskProduct", () => {
  it("shows every field whole and «—» for the missing ones", () => {
    const p = maskProduct({ id: "p-1", description: "Tornillo 1/4", unit_price: 1.5, vat_included: true, active: true, extra: 7 });
    expect(p).toMatchObject({ id: "p-1", description: "Tornillo 1/4", unit_price: 1.5, vat_included: true, active: true, code: "—", barcode: "—", item_type: "—", unit_of_measure: "—", sale_class: "—", extra: 7 });
  });
});
