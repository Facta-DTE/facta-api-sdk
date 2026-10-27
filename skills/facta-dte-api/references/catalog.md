# Catalog: customers and products

Sources: `guides/catalog.md`, `guides/catalog-write.md`, `README.md`,
`CHANGELOG.md` (0.5.0), `src/types.ts`, contract (`Item`, `Receptor`).

The API/SDK does not require a catalog: **an integration that sends complete
receiver and line data depends on no catalog at all.** Use the catalog only if
you want to refer to customers/products by id (`receptor: { customerId }`,
`items: [{ productId, cantidad }]`).

## One road since 0.6

The **server** resolves `customerId` / `productId` for every key, whether the company keeps
its catalog `encrypted` at rest, `readable` or `plain`. The SDK sends the ids as they are:
no `unlockKey`, no snapshot to download, nothing to refresh. `GET /v1/status` still
reports `llave.catalogMode` (also `diagnose().catalogMode`) for information. An unknown id is
`404` with `detail.reason: "catalog_unknown_id"`. `syncCatalog()`, `catalogState()` and
`allowStale` were removed in 0.6.

## Reading (all modes)

`listCustomers`, `getCustomer(id)`, `searchCustomers(query, { limit })` and
`listProducts`, `getProduct`, `searchProducts` keep one signature in every mode.
Deactivated records are left out; pass `includeInactive: true` to see them.
`limit` is an integer 1–500 (default 50). Search is case- and diacritic-insensitive.

- If the server cannot open the company's encrypted catalog right now it answers
  `data_grant_unavailable` / `data_epoch_stale` (503, retry shortly) or
  `data_grant_revoked` (403, the owner removed the key's access).
- Explicit fields in the request win over catalog values. Inline receiver data never
  creates or edits a customer.
- A catalog price carries a VAT basis (`vat_included`). If it does not match the
  document type (FE includes VAT; CCF/notes exclude it) the request fails (`400`
  `catalog_vat_basis` from the server; `invalid_request`, 422, locally in the SDK).
  Send an explicit `precioUni` in the document's basis.
- `catalog_unknown_id`, inactive products and unknown customers are `404` / `not_found`.
- The VAT class of a catalog product (`tipoVenta`) rides on every line issued from it (0.5.0);
  an older SDK issues the line as `gravada` unless you send `tipoVenta` yourself.

```ts
const request: DteRequest = {
  tipoDte: "03",
  receptor: { customerId: "customer-id" },
  items: [{ productId: "product-id", cantidad: 1 }],
};
```

## Writing from the API (0.5.0)

`createCustomer`, `updateCustomer`, `deactivateCustomer`, `createProduct`,
`updateProduct`, `deactivateProduct`. It is **off** until the company turns it on.
**All three prerequisites**, in this order:

1. A **plain-text catalog**: in Facta DTE, Cuenta → API, switch the company catalog
   from encrypted to plain text.
2. The switch **«Permitir administrar clientes y productos desde el API»**, same screen.
3. A key with scope **`catalog:write`**, minted there.

Missing pieces answer `catalog_encrypted` (409), `catalog_write_disabled` (403) and
`forbidden_scope` (403). The SDK explains in Spanish where to enable it.

**Privacy, in plain words (tell the developer before recommending it):** a plain
catalog means **Facta DTE can read your customers' names, document numbers and
addresses**, and so can any key allowed to read the catalog. Keep `catalog:write` on
the systems that really edit the catalog and use read-only keys elsewhere. Already
issued invoices keep their own privacy rules.

```ts
const customer = await facta.createCustomer(
  { nombre: "Laura Ortiz", tipoDocumento: "13", numDocumento: "04829316-5",
    direccion: { departamento: "06", municipio: "14", distrito: "01", complemento: "Colonia Escalón" },
    correo: "laura@example.com" },
  { idempotencyKey: `crm-customer-${crmId}` },   // retries never create a second record
);
await facta.updateCustomer(customer.id, { telefono: "2222-3333" }); // PATCH; null clears an optional field
const product = await facta.createProduct({
  descripcion: "Disco de corte 4 1/2",
  tipoItem: 1,          // 1 good, 2 service, 3 both: required, never defaulted
  precioUni: 2.85,
  ivaIncluido: true,
  tipoVenta: "gravada", // or "exenta" / "no_sujeta"; omitted reads as gravada
});
await facta.deactivateProduct(product.id); // DELETE deactivates; there is no hard delete
```

- **Field names (0.5.0):** the
  inputs use the same Ministry names as the rest of the API: customers `nombre`,
  `tipoDocumento`, `numDocumento`, `nrc`, `codActividad`, `direccion { departamento,
  municipio, distrito, complemento, pais? }`, `telefono`, `correo`; products `descripcion`,
  `tipoItem`, `precioUni`, `uniMedida`, `codigo`, `codigoBarras`, `ivaIncluido`, `tipoVenta`.
  The older stored spellings (`name`, `doc_type`, `doc_number`, `activity_code`, `address`,
  `phone`, `email`, `description`, `item_type`, `unit_price`, `unit_of_measure`, `code`,
  `barcode`, `vat_included`) are **still accepted** (deprecated): do not mix both for the same
  field. On an SDK older than 0.5.0 only the old spellings exist.
- Every record the SDK returns carries **both** spellings, in every catalog mode, plus
  `activo`; the product's `tipoVenta` rides on every line issued from it.
- Direct HTTP uses the same names; list queries use `buscar`, `limite`, `incluirInactivos` and
  responses use `clientes` / `productos`. The SDK methods keep their signatures
  (`searchCustomers(query, { limit, includeInactive })`).
- Rules checked locally before sending (never stricter than the server): a customer needs
  `nombre`; DUI 9 digits, NIT 14 (dashes accepted and removed), NRC 1–8 digits; a `direccion`
  needs department, municipality and district codes and a `complemento`; a product needs
  `descripcion`, `tipoItem` and a `precioUni` greater than zero. Failure: `validation_failed`
  (422) with `details.issues`, before any request.
- `tipoDocumento`: `36` NIT, `13` DUI, `37` other, `03` passport, `02` residence card.
- A customer with the same document, or a product with the same code, already existing is
  `catalog_duplicate` (409; `details.id` names it): edit it, or reactivate it if deactivated.
- Only creates take an `idempotencyKey`; updates and deactivations are repeatable.
- Deactivated records still resolve for past documents, vanish from lists, and a
  deactivated product cannot be issued. **Reactivate through the API**:
  `updateCustomer(id, { activo: true })` / `updateProduct(id, { activo: true })`
  (HTTP: `PATCH` with `{"activo": true}`). The web app does not list deactivated
  customers, so never tell a user that deactivating or reactivating "must be done in
  the app": both work from the API when `catalog:write` is enabled.
- From a browser: `createFactaHandler({ capabilities: { catalog: "write" }, authorize })`
  adds six `catalog.customers|products.create|update|deactivate` actions; it
  **requires an `authorize` function** (`"session-only"` is refused at construction).
  The pickers `FactaCustomerPicker` / `FactaProductPicker` work in plain mode unchanged.
