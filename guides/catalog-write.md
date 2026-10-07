# Create, edit and deactivate customers and products

[Spanish guide](catalog-write.es.md) · [Catalog snapshots](catalog.md) · [English README](../README.md)

From 0.5.0 the SDK can manage the company's customers and products through the
API: `createCustomer`, `updateCustomer`, `deactivateCustomer`, `createProduct`,
`updateProduct` and `deactivateProduct`. This is off until the company turns it
on, because it changes who can read the catalog.

## What you need

All three, in this order:

1. **A plain-text catalog.** In Facta DTE go to **Cuenta → API** and switch the
   company catalog from encrypted to plain text.
2. **The switch «Permitir administrar clientes y productos desde el API»**, on the
   same screen.
3. **A key with the scope `catalog:write`**, minted in the same place.

If something is missing the API answers, and the SDK explains in Spanish what to
change:

| Error | HTTP | Meaning |
|---|---|---|
| `catalog_write_disabled` | 403 | The company did not enable catalog administration from the API. |
| `catalog_encrypted` | 409 | The catalog is still encrypted; the API cannot write to it. |
| `forbidden_scope` | 403 | The key does not carry `catalog:write`. |
| `validation_failed` | 422 | A field breaks a rule (the SDK checks the same rules before sending). |

## What it means for privacy, in plain words

Today the company catalog is encrypted with a key only the company holds, so Facta
DTE cannot read your customers' names, document numbers or addresses. A plain-text
catalog is the opposite: **Facta DTE can read it**, and so can any API key allowed
to read the catalog. That is the price of letting a program add and edit records
without your encryption key. Switch it on only if you need it, keep keys with
`catalog:write` to the systems that truly edit the catalog, and use read-only keys
everywhere else. Invoices already issued keep their own privacy rules.

## Reading works in every mode

You do not have to choose a path. The SDK asks `/v1/status` once, together with the
region discovery it already does, and uses:

| `catalogMode` | How `listCustomers`, `getCustomer`, `searchCustomers` and the product reads work |
|---|---|
| `encrypted` | Decrypts the key's snapshot locally with `unlockKey`, as before. |
| `readable` | Reads through the API (`GET /v1/customers`, `GET /v1/products`); no `unlockKey`. Falls back to the snapshot only if the routes are missing and an `unlockKey` is set. |
| `plain` | Reads through the API; always live; no `unlockKey`. |

```ts
const state = await facta.catalogState();
console.log(state.catalogMode); // "encrypted" | "readable" | "plain" | null
```

`diagnose()` reports the same `catalogMode`. Deactivated records are left out of
lists and searches; pass `includeInactive: true` to see them.

## Examples

```ts
const customer = await facta.createCustomer(
  {
    nombre: "Laura Ortiz",
    tipoDocumento: "13",
    numDocumento: "04829316-5",
    direccion: { departamento: "06", municipio: "14", distrito: "01", complemento: "Colonia Escalón" },
    correo: "laura@example.com",
  },
  { idempotencyKey: `crm-customer-${crmId}` },
);

await facta.updateCustomer(customer.id, { telefono: "2222-3333" });

const product = await facta.createProduct({
  descripcion: "Disco de corte 4 1/2",
  tipoItem: 1, // 1 good, 2 service, 3 both: required, never assumed
  precioUni: 2.85,
  ivaIncluido: true,
  tipoVenta: "gravada", // or "exenta" / "no_sujeta"; omitted reads as gravada
});

await facta.updateProduct(product.id, { precioUni: 3.1 });
await facta.deactivateProduct(product.id);
```

Field names are the ones the rest of the public API uses (`nombre`, `numDocumento`,
`precioUni`, `tipoVenta`...). The stored spellings (`name`, `doc_number`,
`unit_price`...) are still accepted as input, and every record the SDK returns
carries both spellings, in every catalog mode.

Rules the SDK checks before sending, and the server checks too: a customer needs a
`nombre`; a DUI has 9 digits and a NIT 14 (dashes are accepted and removed before
sending); an NRC has 1 to 8 digits; a `direccion` needs department, municipality and
district codes and a `complemento`; a product needs `descripcion`, `tipoItem` and a
`precioUni` greater than zero. `tipoVenta` is the VAT treatment of the product and it
rides on every line issued from it. The SDK never rejects a value the server would
accept. `FactaError` with `code: "validation_failed"` and `status: 422` lists the
problems in `details.issues`.

## Idempotency

Pass `idempotencyKey` to a create (a CRM id, an order number). Retrying with the
same key never creates a second record, even after a restart. Without one the SDK
mints a key and reuses it across its own network retries. Updates and
deactivations are naturally repeatable and send no key.

## Deactivate, not delete

There is no hard delete. `deactivateCustomer` and `deactivateProduct` send
`DELETE`, and the record is kept with `active: false`: past documents still
resolve it, it stops appearing in lists and searches, and a deactivated product
cannot be issued. Reactivation is done in the Facta app.

## From the browser: the server handler

The handler never exposes writes unless you ask for them:

```ts
const handler = createFactaHandler({
  facta,
  sessionSecret: process.env.FACTA_SESSION_SECRET!,
  capabilities: { catalog: "write" }, // default: nothing; "read" only reads
  authorize: async (req, ctx) => isCatalogEditor(await currentUser(req), ctx.action),
});
```

`catalog: "write"` adds `catalog.customers.create | update | deactivate` and
`catalog.products.create | update | deactivate`. It requires an `authorize`
function: `"session-only"` is refused at construction, because a write has no
purchase session to vouch for it. Bodies are `{ action, input }` (create),
`{ action, id, input }` (update) and `{ action, id }` (deactivate); a create may
carry `idempotencyKey`. Answers are the same masked projections the search
actions return. The pickers (`FactaCustomerPicker`, `FactaProductPicker`) work in
plain mode with no change.
