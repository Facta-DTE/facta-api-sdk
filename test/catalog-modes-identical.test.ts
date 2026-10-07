import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { resolveCatalogRefs } from "../src/catalog.ts";
import { FactaError } from "../src/errors.ts";
import type { CatalogSnapshot } from "../src/types.ts";
import { encryptedCatalogBundle } from "./catalog-bundle.ts";

// Marvin, 6-Oct-2026: customers and products come back identically whether the
// company keeps its catalog encrypted, readable or plain. Only latency differs.

const ADDRESS = { departamento: "06", municipio: "23", distrito: "14", complemento: "Colonia Escalón #5", pais: "US" };

// The same two records, as an encrypted snapshot stores them (stored names)...
const SNAPSHOT: CatalogSnapshot = {
  version: 1,
  customers: [{
    id: "c1", name: "Laura Ortiz", doc_type: "13", doc_number: "048293165", nrc: null,
    activity_code: "62010", address: ADDRESS, phone: "22223333", email: "laura@example.test",
  }],
  products: [{
    id: "p1", code: "INT-1", barcode: null, description: "Intereses de préstamo", item_type: "2",
    unit_of_measure: "59", unit_price: 50, vat_included: true, sale_class: "noSuj", active: true,
  }],
};

// ...and as the API answers for readable and plain catalogs (Ministry names).
const API_CUSTOMER = {
  id: "c1", nombre: "Laura Ortiz", tipoDocumento: "13", numDocumento: "048293165", nrc: null,
  codActividad: "62010", direccion: ADDRESS, telefono: "22223333", correo: "laura@example.test",
  activo: true, creadoEn: null, actualizadoEn: null,
};
const API_PRODUCT = {
  id: "p1", codigo: "INT-1", codigoBarras: null, descripcion: "Intereses de préstamo", tipoItem: 2,
  uniMedida: 59, precioUni: 50, ivaIncluido: true, tipoVenta: "no_sujeta", activo: true, actualizadoEn: null,
};

type Mode = "encrypted" | "readable" | "plain";

async function facta(mode: Mode, options: { unlockKey?: boolean } = {}): Promise<Facta> {
  const bundle = await encryptedCatalogBundle(SNAPSHOT, 3);
  const fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*\/v1/, "/v1");
    const json = (value: unknown) => Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
    if (path === "/v1/status") {
      return json({
        ok: true,
        llave: { keyId: "key-1", alcances: ["catalog:read"], catalogMode: mode === "plain" ? "readable" : mode, ...(mode === "plain" ? { catalogoSinCifrar: true } : {}) },
        sincronizacion: { catalog: { status: "ready", desiredRevision: 3, publishedRevision: 3 } },
      });
    }
    if (path === "/v1/vault/destinations") return json(bundle);
    if (path === "/v1/customers") return json({ clientes: [API_CUSTOMER], siguiente: null });
    if (path === "/v1/customers/c1") return json({ cliente: API_CUSTOMER });
    if (path === "/v1/products") return json({ productos: [API_PRODUCT], siguiente: null });
    if (path === "/v1/products/p1") return json({ producto: API_PRODUCT });
    return Promise.resolve(new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), { status: 404 }));
  }) as typeof globalThis.fetch;
  return new Facta({
    apiKey: "key-1.secret",
    ...(options.unlockKey === false ? {} : { unlockKey: "factauk_test" }),
    fetch,
    region: false,
    clock: false,
    maxRetries: 0,
  });
}

const without = (record: unknown, keys: string[]) =>
  Object.fromEntries(Object.entries(record as Record<string, unknown>).filter(([key]) => !keys.includes(key)));

Deno.test("customers and products read the same in encrypted, readable and plain catalogs", async () => {
  const reads: Record<string, unknown[]> = { customers: [], customer: [], products: [], product: [] };
  for (const mode of ["encrypted", "readable", "plain"] as const) {
    const client = await facta(mode);
    reads["customers"]!.push(await client.listCustomers());
    reads["customer"]!.push(await client.getCustomer("c1"));
    reads["products"]!.push(await client.listProducts());
    reads["product"]!.push(await client.getProduct("p1"));
  }
  for (const [what, [encrypted, readable, plain]] of Object.entries(reads) as Array<[string, unknown[]]>) {
    assertEquals(encrypted, readable, `${what}: encrypted differs from readable`);
    assertEquals(readable, plain, `${what}: readable differs from plain`);
  }
  const product = reads["product"]![0] as Record<string, unknown>;
  // the VAT treatment and the whole address survive in every mode
  assertEquals([product["tipoVenta"], product["sale_class"]], ["no_sujeta", "noSuj"]);
  assertEquals([product["tipoItem"], product["uniMedida"], product["precioUni"]], [2, 59, 50]);
  const customer = reads["customer"]![0] as Record<string, unknown>;
  assertEquals(customer["direccion"], ADDRESS);
  assertEquals(customer["address"], ADDRESS);
  assertEquals(Object.keys(customer).sort(), Object.keys(without(customer, [])).sort());
});

Deno.test("searches agree too, whatever the mode", async () => {
  const [a, b] = [await facta("encrypted"), await facta("plain")];
  assertEquals(await a.searchProducts("intereses"), await b.searchProducts("intereses"));
});

Deno.test("an encrypted catalog without unlockKey says what is missing, never a partial record", async () => {
  const client = await facta("encrypted", { unlockKey: false });
  for (const read of [() => client.listCustomers(), () => client.getProduct("p1")]) {
    const error = await assertRejects(read, FactaError);
    assertEquals(error.code, "unauthorized");
    assert(error.message.includes("unlockKey"));
    assertEquals((error.details as { missing?: string }).missing, "unlockKey");
  }
});

Deno.test("an encrypted product resolves at issue time with its VAT treatment and the full address", () => {
  const resolved = resolveCatalogRefs(
    { tipoDte: "01", receptor: { customerId: "c1" }, items: [{ productId: "p1", cantidad: 1 }] },
    SNAPSHOT,
    3,
  );
  assertEquals((resolved.items[0] as unknown as Record<string, unknown>)["tipoVenta"], "no_sujeta");
  assertEquals((resolved.receptor as Record<string, unknown>)["direccion"], ADDRESS);
  const own = resolveCatalogRefs(
    { tipoDte: "01", items: [{ productId: "p1", cantidad: 1, tipoVenta: "exenta" } as never] },
    SNAPSHOT,
    3,
  );
  assertEquals((own.items[0] as unknown as Record<string, unknown>)["tipoVenta"], "exenta");
  const fex = resolveCatalogRefs({ tipoDte: "11", items: [{ productId: "p1", cantidad: 1, precioUni: 50 }] } as never, SNAPSHOT, 3);
  assertEquals((fex.items[0] as unknown as Record<string, unknown>)["tipoVenta"], undefined);
});
