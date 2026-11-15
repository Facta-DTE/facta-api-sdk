# La copia temporal, la confirmación y el almacenamiento de emergencia

[English guide](temporary-copy.md) · [README en español](../README.es.md)

Facta no es el archivo fiscal de nadie. El documento firmado tiene que aterrizar
en un almacenamiento que la empresa controla. Entre que un documento se sella y
que usted lo tiene en un lugar seguro, Facta guarda copias cifradas propias. Esta
guía explica exactamente por cuánto tiempo, qué debe hacer usted para que se
puedan borrar, qué se le avisa al dueño de la empresa si no hace nada y qué hace
(y qué no hace) el almacenamiento de emergencia. Léala una vez; la lista del final
es lo que conviene automatizar.

## El recorrido completo

1. **Emitir.** `issue()` (o `issueAndArchive()`) devuelve el documento sellado.
   Facta guarda entonces una **copia de retención de una hora** y una **copia
   temporal cifrada**. Ninguna de las dos es su archivo.
2. **Guardar.** Usted escribe el JSON (y el PDF) en un lugar suyo: un destino
   sincronizado desde la app de Facta (S3 y compatibles, Supabase Storage), el
   `FileInvoiceArchive` local, su disco o su base de datos. Si eso falla, el
   [almacenamiento de emergencia](emergency.es.md) conserva los archivos mientras
   lo arregla.
3. **Informar.** Guardar no basta, porque Facta no ve su disco. Avísele con
   `confirmDocumentStorage()` (`POST /v1/dte/{codigoGeneracion}/storage-confirmation`).
   Cuando `issueAndArchive()` replicó a un destino sincronizado, el SDK ya informó
   esa copia y no hay nada más que hacer. Cuando Facta mismo guardó una copia
   verificada (Almacenamiento Facta), el documento se marca solo.
4. **Si nadie informa,** el dueño de la empresa recibe un correo desde el primer
   día con la tabla completa de lo que se va a borrar y cuándo, y
   `listUnconfirmedDocuments()` (`GET /v1/storage/unconfirmed`) lista los mismos
   documentos con su fecha de borrado.
5. **Borrado.** Facta borra la copia temporal **2 días después de que el documento
   se marca como guardado**, o **30 días después de sellado** si nunca se marcó.
   Esa es la fecha que anuncian la lista y los correos. Después,
   `GET /v1/dte/{codigoGeneracion}/file` contesta `410 temporary_copy_expired`
   salvo que Almacenamiento Facta tenga el archivo.

Un `200` de `issue()` **no** significa, por tanto, que el documento esté
guardado. El resultado fiscal es definitivo; los archivos son suyos para
conservarlos.

## Las tres capas

| Capa | Cuánto dura | Para qué sirve | Quién la crea | Cómo deja de importar |
| --- | --- | --- | --- | --- |
| **Copia de retención** | **1 hora** | Cubre el tramo entre sellar y la escritura al almacenamiento duradero. `listHolding()` la muestra. | Facta, al sellar | Vence sola. |
| **Copia temporal cifrada** | **30 días** sin informar, **2 días** tras informar | La red detrás de `downloadDocument()` y `retryDocumentStorage()`. | Facta, al sellar | El documento se marca como guardado; se borra en la fecha anunciada. |
| **Almacenamiento de emergencia** (`runtime.emergencyStore`) | Hasta que usted lo vacíe | Su función guarda los archivos cuando falló el almacenamiento duradero. | El SDK llama a su función | **Por sí solo no confirma nada.** Usted informa después. |

La copia de retención y la copia temporal se confunden con facilidad. La primera
es una ventana corta; la segunda es el plazo real de 30 días.

## Informar que ya lo guardó

Envíe el SHA-256 de los bytes del JSON que guardó (el archivo que devolvió
`downloadDocument(code, "json")`), o los bytes mismos y el SDK los calcula:

```ts
const file = await facta.downloadDocument(code, "json");
await myStorage.put(`${code}.json`, file.bytes); // su disco, bucket o base de datos

const receipt = await facta.confirmDocumentStorage(code, {
  where: "bucket-contabilidad", // un nombre corto; nunca una ruta con secretos
  bytes: file.bytes,
});
// receipt.por          primera fuente que lo marcó: api_report, sdk_report, facta_managed...
// receipt.verificado   true solo si Facta pudo rearmar el archivo y el hash coincidió
// receipt.informado    true cuando Facta no pudo comprobar lo que usted afirma
// receipt.borradoEl    cuándo se borra la copia temporal
```

Lo que Facta puede comprobar depende de quién emitió el documento. En uno emitido
por la API, Facta rearma el JSON y compara: un hash distinto es
`storage_hash_mismatch` (HTTP 422) y no se registra nada. En uno emitido desde la
app, la copia está cifrada con una llave que ningún servidor tiene, así que Facta
acepta su informe como una afirmación (`informado: true`), nunca como verificado.
Informar dos veces es seguro (`yaConfirmado: true`; se conserva la primera
fuente). En un servidor que no controla, mire primero
`capabilities.storageConfirmation` en `getStorageStatus()`: sin ella el SDK lanza
`storage_unsupported` y Facta no borra nada.

La misma llamada por HTTP directo:

```sh
curl -X POST "$FACTA_API_BASE_URL/v1/dte/$CODE/storage-confirmation" \
  -H "X-Facta-Key: $FACTA_API_KEY" -H "Content-Type: application/json" \
  -d "{\"donde\": \"bucket-contabilidad\", \"sha256\": \"$SHA256\"}"
```

## Vacíe la lista todos los días

`storeAndConfirmUnconfirmed()` hace la ronda completa: lista, descarga el JSON y el
PDF, se los entrega a su función y confirma con el hash exacto de lo que le dio.
Está acotada, no lanza error por un documento malo y se puede correr a diario.

```ts
const report = await facta.storeAndConfirmUnconfirmed({
  where: "bucket-contabilidad",
  store: async ({ codigoGeneracion, json, pdf }) => {
    await myStorage.put(`${codigoGeneracion}.json`, json);
    if (pdf) await myStorage.put(`${codigoGeneracion}.pdf`, pdf);
    // Resuelva solo cuando los archivos están de verdad guardados. Lance un error para dejarlo sin confirmar.
  },
});
if (report.failed > 0 || report.stopped !== "complete") {
  alertYourTeam(report); // report.results[].step / code dicen qué falló; report.firstDeletionAt es el plazo
}
```

Un documento que falla se queda en la lista y en el correo del dueño; la corrida
sigue con el siguiente. Se detiene antes por `maxFailures`, por su `signal`, por
un error que afecta a todos (una llave revocada, un servidor sin la capacidad) o
por su `limit`. Córrala desde un trabajo diario y mire también
`getStorageStatus().sinConfirmar` (`{ total, primeroSeBorraEl }`) para un resumen
en una sola llamada.

## Qué recibe el dueño de la empresa

Desde el primer día en que un documento está sin informar (24 horas después de
sellado) el dueño recibe un correo de Facta DTE con la **tabla completa**: tipo,
número de control, fecha de emisión y fecha de borrado de cada documento
pendiente, y el total. Después: cada semana, 7 días antes del primer borrado y 1
día antes. Nunca más de un correo al día por empresa, sin nada más que la tabla
(ni contenido del documento ni datos del receptor), y solo en producción (`01`);
las empresas en pruebas ven la misma información en la app. Un documento sale de
los correos cuando se marca como guardado. Si la dirección del dueño rebotó, Facta
no borra esos documentos y lo señala en la app, porque nadie fue avisado.

## El almacenamiento de emergencia guarda, no confirma

`runtime.emergencyStore` protege contra la **copia de retención de una hora**:
cuando el servidor no pudo guardar el documento de forma duradera, o falló toda
replicación, su función recibe los archivos para que no se pierdan. Facta no se
entera de que los guardó. Después, informe:

```ts
const facta: Facta = new Facta({
  apiKey, signKey,
  runtime: {
    version: 1,
    emergencyStore: async (files, info) => {
      await emergencyDisk.write(info.codigoGeneracion, files); // lance un error si no pudo
      // Guardado no es informado: avise a Facta, y que un fallo aquí nunca deshaga el guardado.
      await facta.confirmDocumentStorage(info.codigoGeneracion, {
        where: "disco-de-emergencia",
        bytes: files.archivoDte ?? files.jsonRaw, // exactamente lo que escribió
      }).catch(() => {});
    },
  },
});
// Cuando el almacenamiento vuelva: facta.emergency.replicate(files, info). Una copia que llega a un
// destino sincronizado la informa el SDK; si `stored` viene vacío, llame usted a confirmDocumentStorage.
```

Mientras no llegue uno de esos informes, el documento sigue en la lista de
pendientes y en el correo del dueño, y Facta borra su copia temporal el día 30.

## Deje que `issueAndArchive` informe por usted

`issueAndArchive()` ya informa cada copia que escribe en un destino sincronizado.
También puede informar el archivo local, pero solo si usted lo indica, porque solo
usted sabe si ese archivo es duradero (un disco con respaldo, no una carpeta
temporal):

```ts
const facta = new Facta({
  apiKey, signKey, unlockKey,
  runtime: { version: 1, archive, confirmArchive: true }, // o por llamada: { confirmArchive: true }
});
const out = await facta.issueAndArchive(request, { operationId, idempotencyKey });
out.confirmation; // { state: "confirmed", by } | { state: "pending", detail } | { state: "failed" } | { state: "unsupported" }
```

`pending` no es una advertencia: es lo normal cuando nada informó el documento.
`failed` agrega la advertencia `confirmation_failed`; el documento sellado nunca se
ve afectado.

## Errores y servidores anteriores

- `temporary_copy_expired` (410): la copia ya no existe. Búsquela en su propio
  almacenamiento.
- `nothing_to_repair_from` (409): `retryDocumentStorage()` ya no tiene de dónde
  reescribir.
- `storage_hash_mismatch` (422): el hash no es el del documento. Descargue de
  nuevo y calcule el hash sobre los bytes que guardó.
- `storage_unsupported`: el servidor es anterior a la regla (no borra nada) o no
  expone la ruta.

Lista: guarde cada documento; infórmelo (o deje que lo haga el SDK); corra
`storeAndConfirmUnconfirmed()` a diario; nunca borre su copia antes de que el
informe conteste; dé un informe de seguimiento al almacenamiento de emergencia.
