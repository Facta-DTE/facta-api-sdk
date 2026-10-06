# Guía de integración: Deno

Para conocer las firmas públicas, alcances, valores predeterminados, efectos
y mecanismos de recuperación, consulta la [referencia de métodos del SDK](reference.es.md).

**Paquete y código:** [npm `@facta-dte/api`](https://www.npmjs.com/package/@facta-dte/api) · [repositorio público en GitHub](https://github.com/Facta-DTE/facta-api-sdk).

**Selección de versión:** Esta documentación describe `0.3.0`. El [registro de npm](https://www.npmjs.com/package/@facta-dte/api?activeTab=versions) es la autoridad para las versiones publicadas y sus etiquetas. `latest` elige la versión estable aprobada. Confirme que la versión publicada instalada incluye un método antes de usarlo; valide las capacidades que solo estén en el código fuente con una copia empaquetada.

El paquete oficial admite TypeScript y JavaScript. Los SDK de otros lenguajes están pendientes; los ejemplos HTTP directos no representan SDK publicados.

## Requisitos e instalación

Consulte `npm view @facta-dte/api version dist-tags` y elija una versión publicada
que incluya las capacidades requeridas. Cuando `0.3.0` esté disponible, fíjela
en `deno.json`:

```json
{ "imports": { "@facta-dte/api": "npm:@facta-dte/api@0.3.0" } }
```

No hay paquete JSR. Guarde la versión elegida y el lockfile en el repositorio.


- Deno 2.6.6.
- Una llave de pruebas `facta_test_…` con scopes `issue`, `query` o `download`
  según el ejemplo.
- `FACTA_SIGN_KEY` para issue. `FACTA_UNLOCK_KEY` solo para abrir localmente
  snapshots de destinos/catálogo.

Durante desarrollo dentro del checkout importa desde `../mod.ts`. El paquete
compilado conserva la misma API y es el artefacto que se instalará cuando se
publique. La verificación de release corre:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm pack:check
```

Fije la versión publicada elegida en `deno.json` y guarde su lockfile.
Valide capacidades ausentes de esa versión con `pnpm pack:check`; no use en la
aplicación métodos que el paquete instalado no proporciona.

## Permisos mínimos

Para una emisión simple el proceso requiere red, lectura de variables
seleccionadas y nada de filesystem:

```sh
deno run \
  --allow-net=hcnvknpsbadplnfcflxx.supabase.co \
  --allow-env=FACTA_API_KEY,FACTA_SIGN_KEY,ERP_ORDER_ID \
  main.ts
```

La URL base puede cambiarse con `FACTA_API_BASE_URL` en entornos controlados;
si se usa esa opción, limita `--allow-net` al hostname elegido. Deno pregunta
antes de permisos no concedidos; en producción declara los mínimos en el
comando o config. No pases `-A` a una integración desplegada.

## Cliente y una factura de prueba

```ts
// Importar el módulo no emite. Llama main() solo cuando quieras emitir una prueba.
import { main } from "../examples/hola-factura.ts";
await main();
```

Configura la base URL de staging y usa únicamente llaves `facta_test_`; esta
llamada explícita consume una secuencia fiscal de prueba y requiere un
`ERP_ORDER_ID` estable.

```ts
import { Facta } from "npm:@facta-dte/api@0.3.0";

const facta = new Facta({
  apiKey: Deno.env.get("FACTA_API_KEY")!,
  signKey: Deno.env.get("FACTA_SIGN_KEY")!,
  timeoutMs: 60_000,
  maxRetries: 3,
});

const result = await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Prueba Deno", cantidad: 1, precioUni: 1 }],
}, { idempotencyKey: Deno.env.get("ERP_ORDER_ID")! });

console.log(result.estado, result.codigoGeneracion, result.numeroControl);
```

El ejemplo `01` es una factura de consumidor final sin ficha de cliente. Para
un CCF (`03`), entrega el receptor requerido de forma inline o usa un
`customerId` que ya figure en el snapshot de esa llave. Inline no necesita la
clave de apertura del catálogo ni crea/actualiza clientes. Al reintentar esa
misma venta conserva la misma clave de idempotencia.

Si `result.estado` es `contingencia`, el documento está firmado, pero el MH no
respondió con sello en ese intercambio. Guarda `codigoGeneracion` y consulta
el resultado después; no emitas otra factura con una clave nueva.

## Catálogo y vaults

Al sincronizar desde la app web, el dueño publica un snapshot cifrado. Para
leerlo desde Deno, concede acceso a `FACTA_UNLOCK_KEY` y configura `unlockKey`:

```ts
const facta = new Facta({
  apiKey: Deno.env.get("FACTA_API_KEY")!,
  signKey: Deno.env.get("FACTA_SIGN_KEY")!,
  unlockKey: Deno.env.get("FACTA_UNLOCK_KEY")!,
});

await facta.syncCatalog();
const customers = await facta.listCustomers();
const products = await facta.listProducts();
```

La clave de apertura no se manda en HTTP. Las consultas posteriores comparan
la revisión del snapshot con `/v1/status`; si cambió, el SDK descarga y abre
otra vez. El SDK mantiene la copia solo en memoria. Clientes nuevos CSV entran
al siguiente snapshot de acuerdo con la selección de la llave; el API/SDK no
escribe el catálogo.

Antes de reservar un correlativo, `diagnose()` revisa también el estado
público del certificado asociado. Usa solo huella, vigencia, NIT y ambiente
registrados desde la aplicación web; nunca descarga ni abre el vault de firma.
Un certificado vencido o asociado a otro NIT bloquea `canIssue`; una diferencia
en el ambiente registrado solo advierte, porque el registro conserva el slot de
carga como contexto. Las llaves antiguas sin metadatos de certificado siguen
funcionando y muestran el chequeo como desconocido.

## Almacenamiento administrado y recuperación

Cuando el servidor publique la capacidad versión 1, revisa cobertura y cupo
para el ambiente de la llave:

```ts
const storage = await facta.getStorageStatus();
if (!storage.managed.ready && !storage.byos.ready) {
  throw new Error("No hay un destino durable del servidor disponible");
}

const copies = await facta.getDocumentCopies({ generationCode });
if (copies.some((copy) => copy.state !== "stored")) {
  const receipt = await facta.retryDocumentStorage(generationCode);
  // Repara el DTE sellado; nunca vuelve a emitirlo.
  console.log(receipt.json.state, receipt.pdf.state);
}
```

Las empresas administradas no configuran claves de bucket en el SDK. La API
obtiene empresa y ambiente de la llave y llama al Worker con autenticación
interna. Los resultados del storage administrado, del archivo cifrado local y
de BYOS son independientes. En servidores anteriores, `storage_unsupported`
indica que falta el contrato; el diagnóstico lo deja como desconocido. Solo se
guardan JSON/PDF, no tickets ni anulaciones.

## Descargar y archivar artefactos

JSON y PDF son bytes separados; el SDK no reconstruye ni imprime el PDF:

```ts
const invoice = await facta.getDocumentStatus(result.codigoGeneracion);
const pdf = await facta.downloadDocument(invoice.codigoGeneracion, "pdf");
await Deno.mkdir("./invoices", { recursive: true });
await Deno.writeFile(
  `./invoices/${invoice.codigoGeneracion}.pdf`,
  pdf.bytes,
  { create: true },
);
```

Para `Deno.writeFile`, concede acceso solo al directorio de salida:

```sh
deno run \
  --allow-net=hcnvknpsbadplnfcflxx.supabase.co \
  --allow-env=FACTA_API_KEY,FACTA_SIGN_KEY \
  --allow-write=./invoices \
  main.ts
```

Para conservar cifrados los artefactos JSON, PDF, JWS y ticket, y recuperarlos
tras reinicios, importa `FileInvoiceArchive` desde
`npm:@facta-dte/api/file-archive` del paquete publicado; fije la versión elegida. Este adaptador usa
compatibilidad con `node:fs/promises`; concede `--allow-read` y `--allow-write`
solo al directorio del archivo. La frase de cifrado debe ser aleatoria, guardarse
en un gestor de secretos separado y ser distinta de `FACTA_UNLOCK_KEY`. Los
escritores se serializan entre procesos en sistemas de archivos locales
compatibles; no se admiten sistemas de archivos de red. Los bloqueos nunca se
roban automáticamente. Después de detener a todos los escritores, libera un
bloqueo abandonado con
`FileInvoiceArchive.releaseStaleLock({ directory, confirmNoConcurrentWriters: true })`.

El directorio del archivo usa `formatVersion: 1` en la raíz. Los journals de
facturas y anulaciones escritos por este SDK añaden `schemaVersion: 1`; los
journals v1 existentes sin ese campo siguen siendo legibles y se reescriben en
v1 al modificarse. Una versión desconocida detiene la operación con
`archive_integrity_error`. Antes de abrir el directorio con un SDK nuevo,
conserva una copia de seguridad completa. No borres ni edites manualmente los
archivos cifrados para resolver un error de versión.

Crea el archivo una vez por proceso y úsalo antes de emitir en producción para
comprobar que está listo y escribir el journal antes de reservar el correlativo:

```ts
import { FileInvoiceArchive } from "npm:@facta-dte/api/file-archive";

const archive = await FileInvoiceArchive.open({
  directory: Deno.env.get("FACTA_ARCHIVE_DIRECTORY")!,
  passphrase: Deno.env.get("FACTA_ARCHIVE_PASSPHRASE")!,
});

const issued = await facta.issueAndArchive(request, {
  includeTicket: false,
  archive,
  operationId: erpOrderId,
  idempotencyKey: erpOrderId,
});
```

Anulación también se journaliza antes de enviarse. Tras reiniciar el proceso,
reutiliza el journal y recupera cada operación pendiente con su clave original:

```ts
const generationCode = result.codigoGeneracion;
const invalidation = await facta.invalidateAndArchive(generationCode, request, {
  archive,
  operationId: erpCancellationId,
  idempotencyKey: erpCancellationId,
});

for (const operation of await facta.listPendingInvalidations(archive)) {
  await facta.recoverInvalidation(operation.id, archive);
}
```

Si la recuperación devuelve `operation_outcome_unknown`, concilia el estado
fiscal antes de actuar. No generes una nueva clave para la misma anulación.

Las copias remotas usan adaptadores `RemoteArtifactDestination` que aporta la
aplicación integradora. Resuelve las credenciales de destino desde
`syncDestinations()` solo en el proceso local de Deno; después pasa los
adaptadores mediante `remoteDestinations` a `issueAndArchive()` o llama
`replicateArchive()` sobre un archivo local completo. `write(artifact)` debe
conservar objetos existentes y permitir reconciliar de forma segura la misma
ruta estable comparando el SHA-256 exacto; `check(artifact)` puede resolver un
resultado de red ambiguo. El journal cifrado registra el resultado de cada
destino y artefacto; `archive.pending()` incluye copias remotas sin resolver para
recuperarlas sin emitir de nuevo. Hay adaptadores integrados para S3, Supabase
Storage, Google Drive, OneDrive y el puente local de Facta. La renovación OAuth
de Google Drive y OneDrive pertenece al runtime; para probar escrituras reales
se requieren credenciales válidas del proveedor. Usa un único proceso escritor
por destino de Google Drive, ya que su API no crea archivos de forma
condicional por ruta. FTP/SFTP utiliza el puente del mismo dispositivo y el
puerto de emparejamiento local, no el vault sincronizado.

## Ticket y reimpresión

El SDK transporta los tipos de solicitud y respuesta DTE; Facta calcula,
valida y firma. Los tipos `05`, `06`, `11` y `14` tienen bloques propios en
`DteRequest`. Consulta los [ejemplos DTE](../examples/dte-types.ts) y sigue el
contrato fiscal [OpenAPI publicado](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json).

La API puede regenerar un ticket PDF desde el DTE sellado sin emitir otra
factura. Usa la plantilla vigente de la empresa y admite rollos de 40–120 mm
(80 mm de forma predeterminada):

```ts
const ticket = await facta.downloadDocument(generationCode, "ticket", {
  paperWidthMm: 58,
});
await Deno.writeFile(ticket.filename ?? `${generationCode}-ticket.pdf`, ticket.bytes);
```

La descarga no detecta impresoras ni confirma que se imprimió un trabajo. Facta
no envía mensajes por WhatsApp; guardar o compartir los bytes no demuestra que
se entregaron o imprimieron. El envío y la cola de impresión siguen siendo
responsabilidad de la integración hasta que se definan esos transportes y sus
contratos de estado.

Envía los bytes descargados mediante un adaptador de transporte:

```ts
const printResult = await facta.print(ticket, printerTransport);
if (printResult.state === "unknown") {
  // Reconcilia con el adaptador antes de volver a enviar este trabajo.
}
```

`printerTransport` implementa `PrintTransport`. El SDK no incluye un controlador
de dispositivo ni reintenta un trabajo cuyo resultado de envío es desconocido.


[English version](deno.md) · [Métodos públicos y tipos](reference.es.md)
