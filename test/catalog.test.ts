import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { resolveCatalogRefs } from "../src/catalog.ts";
import { FactaError } from "../src/errors.ts";
import type { CatalogSnapshot, DteRequest } from "../src/types.ts";

const catalog: CatalogSnapshot = {
  version: 1,
  customers: [{
    id: "customer-1",
    name: "Stored name",
    doc_type: "36",
    doc_number: "0614-010101-101-1",
    email: "stored@example.com",
  }],
  products: [{
    id: "product-1",
    code: "P-1",
    description: "Stored description",
    unit_price: 12.5,
    item_type: "2",
    unit_of_measure: "59",
    vat_included: false,
    active: true,
  }, { id: "inactive-product", active: false }],
};

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function encryptedCatalogBundle(snapshot: CatalogSnapshot, revision: number) {
  const encoder = new TextEncoder();
  const vaultId = "vault-1";
  const companyId = "company-1";
  const keyId = "key-1";
  const rowId = "catalog-1";
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const catalogIv = crypto.getRandomValues(new Uint8Array(12));
  const dekBytes = crypto.getRandomValues(new Uint8Array(32));
  const unlockMaterial = await crypto.subtle.importKey("raw", encoder.encode("factauk_test"), "HKDF", false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("facta-api-vault-destinations") }, unlockMaterial,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const wrappedDek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: encoder.encode(`api-vault:${vaultId}:pass`) }, wrappingKey, dekBytes);
  const master = await crypto.subtle.importKey("raw", dekBytes, "HKDF", false, ["deriveKey"]);
  const catalogKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode("facta-api-vault-catalog") }, master,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const aad = `api-secret:v2:${companyId}:${keyId}:catalog:catalog_snapshot:${rowId}:${revision}`;
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: catalogIv, additionalData: encoder.encode(aad) }, catalogKey, encoder.encode(JSON.stringify(snapshot)));
  const secret = { id: rowId, kind: "catalog_snapshot", iv: encode(catalogIv), ciphertext: encode(new Uint8Array(ciphertext)), formatVersion: 2, revision };
  const envelope = { id: secret.id, kind: secret.kind, iv: secret.iv, ciphertext: secret.ciphertext, formatVersion: secret.formatVersion, revision: secret.revision };
  const envelopeDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([envelope])))), (b) => b.toString(16).padStart(2, "0")).join("");
  dekBytes.fill(0);
  return {
    companyId,
    vault: {
      id: vaultId,
      passSalt: encode(salt),
      wrapPass: { iv: encode(wrapIv), ciphertext: encode(new Uint8Array(wrappedDek)) },
      catalog: { ...secret, envelopeDigest, syncStatus: "ready", desiredRevision: revision, publishedRevision: revision },
    },
  };
}

Deno.test("catalog references resolve locally and caller fields override stored fields", () => {
  const request: DteRequest = {
    tipoDte: "03",
    receptor: { customerId: "customer-1", nombre: "Inline name" },
    items: [{ productId: "product-1", cantidad: 2 }],
  };
  const resolved = resolveCatalogRefs(request, catalog, 17);
  assertEquals(resolved, {
    tipoDte: "03",
    receptor: {
      nombre: "Inline name",
      tipoDocumento: "36",
      numDocumento: "0614-010101-101-1",
      telefono: null,
      correo: "stored@example.com",
    },
    items: [{
      cantidad: 2,
      descripcion: "Stored description",
      precioUni: 12.5,
      codigo: "P-1",
      tipoItem: 2,
      uniMedida: 59,
    }],
  });
  assertEquals(JSON.stringify(resolved).includes("customerId"), false);
  assertEquals(JSON.stringify(resolved).includes("productId"), false);
});

Deno.test("catalog product resolution preserves fiscal type and unit and lets explicit fields override", () => {
  const withProduct = {
    version: 1 as const,
    customers: [],
    products: [{
      id: "p",
      description: "Goods",
      code: "GOOD",
      item_type: "1",
      unit_of_measure: "36",
      unit_price: 10,
      vat_included: true,
    }],
  };
  const fe = resolveCatalogRefs({ tipoDte: "01", items: [{ productId: "p", cantidad: 2 }] }, withProduct, 1);
  assertEquals(fe.items[0], {
    cantidad: 2,
    descripcion: "Goods",
    precioUni: 10,
    codigo: "GOOD",
    tipoItem: 1,
    uniMedida: 36,
  });
  const explicit = resolveCatalogRefs({ tipoDte: "03", items: [{
    productId: "p", cantidad: 1, precioUni: 8.5, tipoItem: 3, uniMedida: 59,
  }] }, withProduct, 1);
  assertEquals(explicit.items[0]?.precioUni, 8.5);
  assertEquals(explicit.items[0]?.tipoItem, 3);
  assertEquals(explicit.items[0]?.uniMedida, 59);
});

Deno.test("catalog product rejects VAT basis mismatch and missing fiscal item type", async () => {
  const netProduct = { version: 1 as const, customers: [], products: [{
    id: "p", description: "Net", unit_price: 10, item_type: 2, unit_of_measure: 59, vat_included: false,
  }] };
  const error = await assertRejects(async () => resolveCatalogRefs({
    tipoDte: "01", items: [{ productId: "p", cantidad: 1 }],
  }, netProduct, 1), FactaError);
  assertEquals(error.code, "invalid_request");
  const missingType = { ...netProduct, products: [{ ...netProduct.products[0], item_type: null }] };
  const typeError = await assertRejects(async () => resolveCatalogRefs({
    tipoDte: "01", items: [{ productId: "p", cantidad: 1 }],
  }, missingType, 1), FactaError);
  assertEquals(typeError.code, "invalid_request");
});

Deno.test("unknown customer errors identify the catalog revision without catalog data", async () => {
  const request: DteRequest = {
    tipoDte: "01",
    receptor: { customerId: "missing-customer" },
    items: [{ descripcion: "Inline", cantidad: 1, precioUni: 2 }],
  };
  const error = await assertRejects(
    async () => resolveCatalogRefs(request, catalog, 21),
    FactaError,
  );
  assertEquals(error.code, "not_found");
  assertEquals(error.details, {
    customerId: "missing-customer",
    catalogRevision: 21,
  });
});

Deno.test("inactive or missing products fail with ID and catalog revision", async () => {
  const request: DteRequest = {
    tipoDte: "01",
    items: [{ productId: "inactive-product", cantidad: 1 }],
  };
  const error = await assertRejects(
    async () => resolveCatalogRefs(request, catalog, 22),
    FactaError,
  );
  assertEquals(error.code, "not_found");
  assertEquals(error.details, {
    productId: "inactive-product",
    catalogRevision: 22,
  });
});

Deno.test("stale catalog reads require opt-in and never change issuance resolution", async () => {
  const bundle = await encryptedCatalogBundle(catalog, 17);
  const calls: string[] = [];
  let vaultCalls = 0;
  const fetch = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/vault/destinations")) {
      vaultCalls += 1;
      const response = vaultCalls === 1 ? bundle : {
        ...bundle,
        vault: { ...bundle.vault, catalog: { ...bundle.vault.catalog, syncStatus: "pending" } },
      };
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      sincronizacion: { catalog: { status: "pending", desiredRevision: 18, publishedRevision: 17 } },
    }), { status: 200 }));
  }) as typeof globalThis.fetch;
  const facta = new Facta({ region: false,
    apiKey: "key-1.secret",
    unlockKey: "factauk_test",
    fetch,
    config: { version: 1, allowStaleCatalogReads: true },
  });
  await facta.syncCatalog();

  const issuanceError = await assertRejects(() => facta.issue({
    tipoDte: "01",
    receptor: { customerId: "customer-1" },
    items: [{ descripcion: "Inline", cantidad: 1, precioUni: 1 }],
  }), FactaError);
  assertEquals(issuanceError.code, "no_storage_destination");
  assertEquals(issuanceError.message, "The catalog of this key is out of date; open Facta to synchronize it.");
  assertEquals((issuanceError.details as { reason?: string }).reason, "catalog_out_of_sync");
  assertEquals(calls.some((url) => url.endsWith("/v1/dte")), false);

  assertEquals((await facta.listCustomers()).length, 1);
  assertEquals((await facta.catalogState()).freshness, "stale");
  assertEquals((await facta.catalogState()).localRevision, 17);
  const error = await assertRejects(() => facta.listCustomers({ allowStale: false }), FactaError);
  assertEquals(error.code, "no_storage_destination");
  assertEquals(calls.filter((url) => url.endsWith("/v1/vault/destinations")).length, 3);
});
