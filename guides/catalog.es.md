# Lectura del catálogo y resolución de ids

[Guía en inglés](catalog.md) · [README](../README.es.md)

Desde el SDK 0.6 el **servidor** resuelve `customerId` y `productId`. El SDK los envía
tal como usted los escribió, sea cual sea el modo del catálogo de la empresa (cifrado
en reposo, `readable` o `plain`): ya no hay una instantánea del catálogo por llave que
descargar, descifrar o guardar en memoria, el catálogo no necesita `unlockKey` y un
cambio en el catálogo no puede dejar a la integración con una copia vieja.
`syncCatalog()`, `catalogState()` y la opción `allowStale` se eliminaron (vea el
[changelog](../CHANGELOG.md)).

```ts
await facta.issue({
  tipoDte: "03",
  receptor: { customerId: "id-del-cliente" },
  items: [{ productId: "id-del-producto", cantidad: 1 }],
});
```

Un id desconocido responde `404` (`not_found`) con `details.reason:
"catalog_unknown_id"`; un registro que la llave no puede usar responde igual. Los
campos explícitos de la solicitud siempre ganan sobre los guardados. Los datos completos
(`receptor` e `items` en línea) nunca necesitan el catálogo.

## Lectura

`listCustomers`, `getCustomer`, `searchCustomers` y los de productos llaman a
`GET /v1/customers` y `GET /v1/products` y devuelven los mismos campos en cualquier
modo. Los registros desactivados se omiten salvo con `includeInactive: true`. El
servidor busca en memoria dentro de un catálogo cifrado: una búsqueda de texto sobre
demasiadas filas responde `catalog_search_too_broad` (422); busque por documento.

Las escrituras (`createCustomer`, `updateCustomer`, `deactivateCustomer` y las de
productos) están en la [guía de escritura](catalog-write.es.md).

## Errores que conviene atender

| Código | Significado |
|---|---|
| `data_grant_unavailable` (503) / `data_epoch_stale` (503) | El servidor no pudo abrir ahora el catálogo cifrado de la empresa, o su clave de datos se está rotando. Reintente en unos segundos. |
| `data_grant_revoked` (403) | La dueña quitó a esta llave el acceso a los datos del catálogo. |
| `catalog_revision_conflict` (409) | El registro cambió desde la revisión que envió en `If-Match`. |
| `inbox_retired` / `catalog_snapshot_retired` (410) | El buzón sellado y la instantánea por llave ya no existen; use los métodos de arriba. |
