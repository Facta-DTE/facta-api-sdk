# Catalog: customers and products

Sources: `guides/catalog.md`, `guides/catalog-write.md`, `README.md`,
`CHANGELOG.md` (0.5.0), `src/types.ts`, contract (`Item`, `Receptor`).

The API/SDK does not require a catalog: **an integration that sends complete
receiver and line data depends on no catalog at all.** Use the catalog only if
you want to refer to customers/products by id (`receptor: { customerId }`,
`items: [{ productId, cantidad }]`).

## Three modes

`GET /v1/status` tells the SDK which one the key is in
(`llave.catalogMode`, also `facta.catalogState().catalogMode` and
`diagnose().catalogMode`):

| Mode | Who can read the catalog | How ids resolve | Needs `unlockKey`? |
| --- | --- | --- | --- |
| `encrypted` | Only the company (end-to-end). Facta cannot read names or documents. | **The SDK resolves locally** from the key's encrypted snapshot, in memory. A direct HTTP call cannot. | Yes (`factauk_…`) |
| `readable` | The owner enabled «Catálogo legible por la API». | **The server resolves** `customerId`/`productId`; the SDK sends the ids as they are. Unknown id → `404` with `detail.reason: "catalog_unknown_id"` (`detail.catalogStale` says if the published catalog lags). | No |
| `plain` | Facta DTE and any key allowed to read the catalog. | Server, always live. Reads via `GET /v1/customers` and `/v1/products`. | No |

An older server that does not advertise the mode behaves as `encrypted`. The SDK
asks for the mode about once a minute and, if it cannot read it, keeps resolving
locally; that check is never the reason an emission fails.

## Reading (all modes)

`listCustomers`, `getCustomer(id)`, `searchCustomers(query, { limit })` and
`listProducts`, `getProduct`, `searchProducts` keep one signature in every mode.
Deactivated records are left out; pass `includeInactive: true` to see them.
`limit` is an integer 1–500 (default 50). Search is case- and diacritic-insensitive.

```ts
const state = await facta.catalogState(); // { catalogMode, freshness, localRevision, desiredRevision, publishedRevision, syncStatus, statusError }
if (state.catalogMode === "encrypted" && state.freshness !== "fresh") await facta.syncCatalog(); // needs unlockKey
```

- **Encrypted catalogs and fiscal requests:** `issue` / `issueAndArchive` resolve
  ids against a **fresh** snapshot and never accept stale data. If the snapshot is
  pending or its status cannot be confirmed, resolution fails *before* anything is
  sent (`no_storage_destination` with `details.reason: "catalog_out_of_sync"`, or
  `not_found` for an id that is not in it). Fix it by publishing the snapshot from
  the Facta app. Do not retry with stale data.
- `allowStale: true` exists for **non-fiscal reads only** (a UI, local search) and
  only reuses this process's cache; it does not persist across restarts and does not
  suppress integrity errors.
- Explicit fields in the request win over catalog values. Inline receiver data never
  creates or edits a customer.
- A catalog price carries a VAT basis (`vat_included`). If it does not match the
  document type (FE includes VAT; CCF/notes exclude it) the request fails (`400`
  `catalog_vat_basis` from the server; `invalid_request`, 422, locally in the SDK).
  Send an explicit `precioUni` in the document's basis.
- `catalog_unknown_id`, inactive products and unknown customers are `404` / `not_found`.
- Not in the SDK: the per-line VAT class of a catalog product does not reach the API
  (per the contract, send `tipoVenta` on the line, which the SDK's types may not yet
  declare — see issuing-dte-types.md).

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
  { name: "Laura Ortiz", doc_type: "13", doc_number: "04829316-5",
    address: { departamento: "06", municipio: "14", complemento: "Colonia Escalón" },
    email: "laura@example.com" },
  { idempotencyKey: `crm-customer-${crmId}` },   // retries never create a second record
);
await facta.updateCustomer(customer.id, { phone: "2222-3333" }); // PATCH; null clears an optional field
const product = await facta.createProduct({
  description: "Disco de corte 4 1/2",
  item_type: 1,      // 1 good, 2 service, 3 both — required, never defaulted
  unit_price: 2.85,
  vat_included: true,
});
await facta.deactivateProduct(product.id); // DELETE deactivates; there is no hard delete
```

- Wire names are snake_case here (`doc_type`, `doc_number`, `item_type`, `unit_price`,
  `vat_included`), different from the DTE request.
- Rules checked locally before sending (never stricter than the server): customer
  needs `name`; DUI 9 digits, NIT 14 (dashes accepted and removed), NRC 1–8 digits;
  address needs two-digit `departamento` and `municipio` and a `complemento`;
  product needs `description`, `item_type`, non-negative `unit_price`. Failure:
  `validation_failed` (422) with `details.issues`, before any request.
- `doc_type`: `36` NIT, `13` DUI, `37` other, `03` passport, `02` residence card.
- Only creates take an `idempotencyKey`; updates and deactivations are repeatable.
- Deactivated records still resolve for past documents, vanish from lists, and a
  deactivated product cannot be issued. Reactivation is done in the app.
- From a browser: `createFactaHandler({ capabilities: { catalog: "write" }, authorize })`
  adds six `catalog.customers|products.create|update|deactivate` actions; it
  **requires an `authorize` function** (`"session-only"` is refused at construction).
  The pickers `FactaCustomerPicker` / `FactaProductPicker` work in plain mode unchanged.
