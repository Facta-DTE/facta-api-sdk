# Instantáneas de catálogo y consultas sin conexión

La llave de API recibe una instantánea cifrada de los clientes que tiene
autorización para consultar y de los productos activos. `syncCatalog()` descarga
y descifra en memoria la última instantánea publicada. No crea ni modifica
registros en el servidor. Las altas y cambios de clientes y productos siguen
gestionándose en la app de Facta y mediante el flujo de importación CSV.

## Vigencia

Los métodos auxiliares del catálogo consultan el estado de la API antes de
reutilizar la caché del proceso. Si cambia la revisión publicada, descargan y
verifican la nueva instantánea cifrada. Si la sincronización está pendiente, el
comportamiento predeterminado es fallar con `no_storage_destination`; no se
devuelven silenciosamente precios ni datos de clientes desactualizados.

Las consultas no fiscales pueden optar por usar datos desactualizados. Esta
opción sirve para una interfaz, búsqueda local o flujo que pueda mostrar con
claridad que los resultados podrían estar vencidos:

```ts
const state = await facta.catalogState();
const products = await facta.listProducts({ allowStale: true });

if (state.freshness !== "fresh") {
  showCatalogWarning(state);
}
```

`allowStale` solo permite leer la caché que ya mantiene esta instancia de
`Facta`. No conserva el catálogo al reiniciar el proceso ni omite los errores de
integridad al descifrar una instantánea nueva. Sin una caché, el SDK sigue
requiriendo una sincronización inicial correcta.

`catalogState()` solo devuelve metadatos de sincronización:

| Campo | Significado |
|---|---|
| `freshness` | `fresh` cuando coinciden las revisiones local y publicada; `stale` cuando difieren o falla la consulta de estado; `missing` si el proceso no tiene una instantánea descifrada. |
| `localRevision` | Revisión descifrada en este proceso, o `null`. |
| `fetchedAt` | Momento en que el proceso cargó esa revisión, o `null`. |
| `desiredRevision` / `publishedRevision` | Revisiones públicas que devuelve la API, o `null` si no están disponibles. |
| `syncStatus` | Estado público de sincronización del catálogo, o `null`. |
| `statusError` | Código seguro del SDK si falló la consulta de estado. Nunca incluye credenciales ni contenido del vault. |

## Las solicitudes fiscales siempre requieren una instantánea vigente

`issue()` y `issueAndArchive()` resuelven `customerId` y `productId` contra una
instantánea vigente. Nunca usan la opción `allowStale`. Si la sincronización
está pendiente o no se puede confirmar el estado, la resolución de referencias
falla antes de enviar la solicitud de factura. Si la integración ya tiene todos
los datos inline del receptor y los artículos, puede omitir los IDs; esa ruta no
requiere catálogo ni llave `unlockKey`.

```ts
try {
  await facta.issue({
    tipoDte: "03",
    receptor: { customerId: "customer-id" },
    items: [{ productId: "product-id", cantidad: 1 }],
  });
} catch (error) {
  // Ante no_storage_destination, sincroniza la llave desde la app de Facta.
  // No reintentes con una revisión de catálogo desactualizada.
}
```

`catalogState()` puede ayudar a explicar el problema a un operador antes de
emitir, pero el resultado es informativo y puede quedar desactualizado de
inmediato. La API sigue siendo responsable de la autorización, la validación
fiscal, los totales, la firma y la transmisión.

[Versión en inglés](catalog.md) · [README en español](../README.es.md)
