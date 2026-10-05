# Catalog snapshots and offline reads

[Spanish guide](catalog.es.md) · [English README](../README.md)

The API key receives an encrypted snapshot of the customers it is allowed to
use and the active products. `syncCatalog()` downloads and decrypts the latest
published snapshot in memory. It does not create or update server-side records.
Customer and product writes remain in the Facta app and CSV import flow.

## Freshness

Catalog helper methods check the API status before reusing the process-local
cache. If the published revision changed, they download and verify the new
encrypted snapshot. If the synchronization is pending, the default behavior is
to fail with `no_storage_destination`; it does not silently return old prices
or customer details.

Non-fiscal reads may opt into stale data. This option is for a UI, local search,
or a workflow that can clearly label its results as potentially out of date:

```ts
const state = await facta.catalogState();
const products = await facta.listProducts({ allowStale: true });

if (state.freshness !== "fresh") {
  showCatalogWarning(state);
}
```

`allowStale` only permits a read from the cache already held by this `Facta`
instance. It does not persist the catalog across process restarts. It also does
not suppress integrity errors while decrypting a new snapshot. Without a cache,
the SDK still requires a successful initial sync.

`catalogState()` returns only synchronization metadata:

| Field | Meaning |
|---|---|
| `freshness` | `fresh` when local and published revisions match, `stale` when they differ or the status request fails, `missing` when this process has no decrypted snapshot. |
| `localRevision` | Revision decrypted into this process, or `null`. |
| `fetchedAt` | Time the current process loaded that revision, or `null`. |
| `desiredRevision` / `publishedRevision` | Public revision numbers returned by the API, or `null` when unavailable. |
| `syncStatus` | Public catalog synchronization state, or `null`. |
| `statusError` | Safe SDK error code when the API status request failed. It never includes credentials or vault content. |

## Readable catalog: the server resolves the ids

When the key's owner enabled «Catálogo legible por la API» in Facta,
`GET /v1/status` advertises `llave.catalogMode: "readable"`. In that mode the
SDK **sends `customerId` and `productId` as they are** and the server resolves
them from the catalog the app published for that key: no `unlockKey` is needed,
no snapshot is downloaded or decrypted, and a catalog change cannot leave the
integration with a stale copy. An unknown id answers `404` with
`detail.reason: "catalog_unknown_id"`; `detail.catalogStale` says whether the
published catalog lags the app's.

With `catalogMode: "encrypted"` (or an older server that does not advertise it)
everything works as described below. The SDK asks for the mode once a minute
and, if it cannot read it, keeps resolving locally: that check is never the
reason an emission fails. An integration that sends complete data depends on
neither mode.

## Fiscal requests always require a fresh snapshot

`issue()` and `issueAndArchive()` resolve `customerId` and `productId` against
a current snapshot. They never use the `allowStale` option. If synchronization
is pending or status cannot be confirmed, reference resolution fails before an
invoice request is sent. Integrators that already have complete inline receptor
and item data can omit IDs; that path does not need the catalog or unlock key.

```ts
try {
  await facta.issue({
    tipoDte: "03",
    receptor: { customerId: "customer-id" },
    items: [{ productId: "product-id", cantidad: 1 }],
  });
} catch (error) {
  // Handle no_storage_destination by syncing the key from the Facta app.
  // Do not retry with a stale catalog revision.
}
```

`catalogState()` can be used to explain the issue to an operator before
issuance, but its result is informational and may age immediately. The API
remains responsible for authorization, fiscal validation, totals, signing, and
transmission.
