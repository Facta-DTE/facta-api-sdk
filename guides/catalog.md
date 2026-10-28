# Catalog reads and id resolution

[Spanish guide](catalog.es.md) · [English README](../README.md)

Since SDK 0.6 the **server** resolves `customerId` and `productId`. The SDK sends them
as you wrote them, whatever the company's catalog mode (`encrypted` at rest, `readable`
or `plain`): there is no per-key catalog snapshot to download, decrypt or keep in memory,
no `unlockKey` is needed for the catalog, and a catalog change can never leave the
integration with a stale copy. `syncCatalog()`, `catalogState()` and the `allowStale`
option were removed (see the [changelog](../CHANGELOG.md)).

```ts
await facta.issue({
  tipoDte: "03",
  receptor: { customerId: "customer-id" },
  items: [{ productId: "product-id", cantidad: 1 }],
});
```

An unknown id answers `404` (`not_found`) with `details.reason: "catalog_unknown_id"`;
a record the key may not use answers the same way. Explicit fields on the request
always win over the stored ones. Inline data (complete `receptor` and `items`) never
needs the catalog.

## Reading

`listCustomers`, `getCustomer`, `searchCustomers` and the product equivalents call
`GET /v1/customers` and `GET /v1/products` and return the same fields in every mode.
Deactivated records are left out unless you pass `includeInactive: true`. The server
searches an encrypted catalog in memory: a text search over too many rows answers
`catalog_search_too_broad` (422); search by document instead.

Writes (`createCustomer`, `updateCustomer`, `deactivateCustomer` and the product
methods) are explained in the [catalog write guide](catalog-write.md).

## Errors worth handling

| Code | Meaning |
|---|---|
| `data_grant_unavailable` (503) / `data_epoch_stale` (503) | The server could not open the company's encrypted catalog just now, or the company's data key is rotating. Retry shortly. |
| `data_grant_revoked` (403) | The owner removed this key's access to the catalog data. |
| `catalog_revision_conflict` (409) | The record changed since the `If-Match` revision you sent. |
| `inbox_retired` (410) | The old sealed catalogue inbox is gone (the per-key snapshot is only marked deprecated and ignored by this SDK); use the methods above. |
