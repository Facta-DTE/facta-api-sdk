# @facta-dte/api — cliente de TypeScript

Emite un DTE sellado por el Ministerio de Hacienda desde Node 22/24. El paquete
publicado contiene JavaScript ESM compilado y sus tipos se leen del contrato
TypeScript. El código fuente también funciona con Deno 2.6.6; el chequeo del
tarball prueba un consumidor Node y uno Deno desde un directorio limpio.
**Paquete y código:** [npm `@facta-dte/api`](https://www.npmjs.com/package/@facta-dte/api) · [repositorio público en GitHub](https://github.com/Facta-DTE/facta-api-sdk).

**Selección de versión:** Esta documentación describe `0.3.0`. El [registro de npm](https://www.npmjs.com/package/@facta-dte/api?activeTab=versions) es la autoridad para las versiones publicadas y sus etiquetas. `latest` elige la versión estable aprobada. Confirme que la versión publicada instalada incluye un método antes de usarlo; valide las capacidades que solo estén en el código fuente con una copia empaquetada.

**Novedades de 0.3.0:** con una llave de desbloqueo y un snapshot de destinos publicado desde la app de Facta, `issueAndArchive()` ahora también copia por defecto a esos destinos sincronizados, en las rutas canónicas de Facta, y le informa a Facta cada copia verificada (`replicate: false` lo desactiva). Un problema de almacenamiento sobre un documento sellado es un aviso tipado (`byos_not_replicated`, `copy_report_failed`), nunca un fallo. Las llaves con catálogo legible permiten que el servidor resuelva `customerId` / `productId` sin catálogo local. Vea la guía de adaptadores de almacenamiento.

El paquete oficial admite TypeScript y JavaScript. Los SDK de otros lenguajes están pendientes; los ejemplos HTTP directos no representan SDK publicados.

```sh
# Verificar versiones y etiquetas, luego instalar la versión estable aprobada:
npm view @facta-dte/api version dist-tags
pnpm add @facta-dte/api
# Opcional: fijar 0.3.0 después de verificar que está publicada:
pnpm add @facta-dte/api@0.3.0
```


El contrato que implementa es el [OpenAPI publicado](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json), autoridad para los campos y respuestas HTTP.

> **Licencia:** MIT. Consulta [LICENSE](LICENSE).

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  unlockKey: process.env.FACTA_UNLOCK_KEY!,
  baseUrl: process.env.FACTA_API_BASE_URL!,
});

const dte = await facta.issue({
  tipoDte: "03",
  receptor: { customerId: "…" },
  items: [{ descripcion: "Integración de la API", cantidad: 1, precioUni: 25 }],
});

console.log(dte.numeroControl);
if (dte.estado === "sellado") console.log(dte.selloRecibido, dte.totales.totalPagar);

const page = await facta.listDocuments({ limit: 20 });
const file = await facta.downloadDocument(dte.codigoGeneracion, "json");
```

Ejemplo completo, con el manejo de rechazo: [`examples/hola-factura.ts`](examples/hola-factura.ts).
Guías de instalación y uso por runtime: [Node.js](guides/node.es.md) y [Deno](guides/deno.es.md).
Catalog freshness, explicit stale-read opt-in, and fiscal fail-closed behavior:
[catalog guide](guides/catalog.es.md).

Para reconstruir y comprobar el paquete independiente desde el repositorio:

```sh
pnpm install --frozen-lockfile
pnpm pack:check
```

`pack:check` genera ESM y declaraciones `.d.ts`, crea el tarball e instala ese
tarball en consumidores temporales limpios para comprobar importación, tipos,
ejecución en Node y ejecución en Deno.

When the repository's local Supabase stack is already running, the optional
`pnpm test:sdk:local-storage` check exercises the compiled Supabase Storage
adapter against a uniquely named private bucket on the loopback project. It
verifies exact write/read bytes, an identical retry, and that a mismatched
retry cannot replace stored bytes. It deletes its test object and bucket on
completion. It refuses non-loopback Supabase URLs and does not reset or migrate
the local database. This repository-only validation script is not included in
the published package.

## Configuración tipada versionada

`FactaOptions` conserva las opciones planas por compatibilidad. Para guardar defaults de comportamiento, usa `config: { version: 1, ... }`; si el mismo campo aparece en ambos lugares, la opción plana gana. Credenciales (`apiKey`, `signKey`, `unlockKey`) permanecen fuera de `config` para evitar serializarlas junto con perfiles.

```ts
const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,
  unlockKey: process.env.FACTA_UNLOCK_KEY,
  config: {
    version: 1,
    baseUrl: "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1",
    expectedEnvironment: "00",
    requiredScopes: ["issue", "query", "download"],
    timeoutMs: 60_000,
    maxRetries: 3,
    allowStaleCatalogReads: false,
    ticketPaperWidthMm: 80,
  },
});

const readiness = await facta.diagnose();
```

`expectedEnvironment` and `requiredScopes` are checked against live `status()` by `diagnose()`; a mismatch blocks its preparación de emisión result but does not rewrite server permissions. Runtime-only defaults use a separate versioned `runtime` block for invoice and invalidation archives, remote destinations, and a print transport. These are executable objects, not serializable profile fields; per-call adapters override them. Stale-catalog defaults apply only to non-fiscal lookup helpers; per-call `allowStale` overrides them, and fiscal reference resolution always requires a current snapshot. Archive stores, remote destination clients, and print transports may be passed per operation or as runtime defaults. Credentials remain outside both config blocks. WhatsApp sending is not available until its API contract is decided. Supported config version is `1`; unknown versions and invalid timeout, retry, and ticket-width values fail during construction.

## Métodos del cliente

| Método | Uso | Envía `FACTA_SIGN_KEY` |
|---|---|---|
| `status()` | Estado de la llave, revisiones de sincronización, datos públicos de vigencia/identidad del certificado cuando están registrados, ambiente y límites restantes. | No |
| `diagnose(options?)` | Revisa scopes, emisor, firma, vigencia/identidad pública del certificado, sincronización, archivo local y capacidad administrada. Un servidor anterior deja esa capacidad como desconocida. | No |
| `getStorageStatus()` | Capacidad administrada (cobertura, cupo e integración) y BYOS verificado para el ambiente de la llave. Requiere `download`. | No |
| `getDocumentCopies()` | Recibos JSON/PDF administrados de la empresa/ambiente de la llave; no devuelve rutas ni enlaces. Requiere `download`. | No |
| `retryDocumentStorage(codigoGeneracion)` | Repara copias de un DTE sellado sin volver a emitir; requiere scopes `download` e `issue`. | No |
| `syncDestinations()` | Descarga el snapshot cifrado y abre destinos localmente. | No |
| `syncCatalog()` | Descarga el snapshot cifrado y abre clientes/productos localmente. | No |
| `listCustomers()`, `getCustomer(id)`, `searchCustomers(query)` | Lee o busca clientes ya autorizados para esta llave desde el snapshot descifrado localmente. | No |
| `listProducts()`, `getProduct(id)`, `searchProducts(query)` | Lee o busca productos del snapshot descifrado localmente. | No |
| `issue(request, options?)` | Prepara, firma y transmite un DTE en una operación. | Sí |
| `deliverEmail(codigoGeneracion, token)`, `deliverWhatsApp(codigoGeneracion, token)` | Inician la entrega por correo o WhatsApp de un DTE sellado con el token de entrega de `issue(…, { deliver })` (válido 5 minutos). | No |
| `getDelivery(codigoGeneracion)`, `waitForDelivery(codigoGeneracion, options?)` | Leen el estado de cada canal; `waitForDelivery` consulta hasta que todos sean finales. | No |
| `prepare(request, options?)` | Reserva correlativo y devuelve el documento canónico sin firma. | No |
| `sign(prepared, options?)` | Firma y transmite exactamente el resultado de `prepare`. | Sí |
| `getDocumentStatus(codigoGeneracion)` | Consulta un DTE por su código de generación. | No |
| `listDocuments(filters?)` | Lista DTE con filtros y cursor de paginación. | No |
| `invalidate(codigoGeneracion, request, options?)` | Anula un DTE sellado. | Sí |
| `invalidateAndArchive(codigoGeneracion, request, options)` | Anula y guarda de forma cifrada el evento y su JWS para recuperación. | Sí |
| `recoverInvalidation(operationId, archive?)`, `listPendingInvalidations(archive?)` | Reanuda o lista anulaciones locales pendientes; reusa la misma clave de idempotencia. | Si reanuda |
| `downloadDocument(codigoGeneracion, kind?)` | Descarga los bytes exactos de JSON/PDF/ticket e informa origen cuando el servidor lo conoce. | No |
| `issueAndArchive(request, options)` | Verifica el archivo antes de reservar un número, emite y conserva los bytes exactos del JSON firmado y PDF que devuelve el servidor; deriva el JWS y descarga solo el ticket opcional. | `issue` y `download` (ticket y recuperación) |
| `listPendingOperations(archive?)` | Lista operaciones locales que aún requieren recuperación o conciliación. | No |
| `replicateArchive(operationId, archive, destinations)` | Reproduce los bytes archivados exactos mediante los adaptadores remotos de la aplicación y registra el resultado por artefacto en el journal cifrado. |
| `diagnoseDestinations(operationId, archive, destinations)` | Inspección de solo lectura de copias remotas existentes; confirma los bytes exactos cuando el adaptador lo permite, sin escribir archivos de prueba. | None |
| `listHolding(limit?)` | Consulta documentos retenidos para sincronización. | No |
| `getStorageStatus()` | Revisa capacidad administrada, cobertura, cupo e integración, además de BYOS verificado. Requiere `download`. | No |
| `getDocumentCopies()` | Lista recibos JSON/PDF de esta empresa y ambiente; no devuelve rutas ni enlaces. Requiere `download`. | No |
| `retryDocumentStorage(codigoGeneracion)` | Repara copias de un DTE sellado sin emitir de nuevo; requiere `download` e `issue`. | No |
| `getContract()` | Obtiene el contrato OpenAPI publicado por la API. | No |

### Firmas públicas y valores de argumentos

Los nombres siguientes son los exports del paquete (`Facta` y los tipos se
importan desde `@facta-dte/api`).

| Método | Firma/argumentos | Retorno |
|---|---|---|
| `new Facta` | `FactaOptions`: `apiKey` requerido; `signKey`, `unlockKey`, `baseUrl`, `timeoutMs`, `maxRetries` opcionales | `Facta` |
| `status` | `status()` | `Promise<Status>` |
| `diagnose` | `diagnose(options?: { archive?: InvoiceArchive; tipoDte?: DteType })` | `Promise<DiagnosticsReport>`; revisiones, conteos de archivo y diagnósticos legibles |
| `getStorageStatus` | `getStorageStatus(options?: { signal?: AbortSignal })`; requiere `download` | `Promise<ManagedStorageStatus>`; capability v1, cobertura/cupo administrado y BYOS verificado |
| `getDocumentCopies` | `getDocumentCopies(options?: { generationCode?: string; signal?: AbortSignal })`; requiere `download` | `Promise<ManagedDocumentCopy[]>`; recibos JSON/PDF del ambiente autenticado |
| `retryDocumentStorage` | `retryDocumentStorage(codigoGeneracion, options?: { signal?: AbortSignal })`; requiere `download` e `issue` | `Promise<ManagedStorageReceipt>`; reparación sin reemisión |
| `syncDestinations` | `syncDestinations()`; requiere `unlockKey` | `Promise<DestinationSnapshot>`; descifra destino solo en memoria |
| `syncCatalog` | `syncCatalog()`; requiere `unlockKey` | `Promise<CatalogSnapshot>`; reemplaza la copia de catálogo de este proceso |
| `catalogState` | `catalogState()` | `Promise<CatalogState>`; revisiones pública/local y frescura, sin devolver contenido |
| `listCustomers` | `listCustomers(options?: { allowStale?: boolean })` | `Promise<CatalogCustomer[]>`; caché antigua solo con opt-in explícito |
| `getCustomer` | `getCustomer(customerId: string, options?: { allowStale?: boolean })` | `Promise<CatalogCustomer \| null>` |
| `searchCustomers` | `searchCustomers(query: string, options?: { limit?: number; allowStale?: boolean })`; limit 50, 1–500 | `Promise<CatalogCustomer[]>`; busca nombre/documento/NRC/correo, localmente sin acentos |
| `listProducts` | `listProducts(options?: { includeInactive?: boolean; allowStale?: boolean })`; default false | `Promise<CatalogProduct[]>` |
| `getProduct` | `getProduct(productId: string, options?: { allowStale?: boolean })` | `Promise<CatalogProduct \| null>`; devuelve `null` también para producto inactivo |
| `searchProducts` | `searchProducts(query: string, options?: { limit?: number; allowStale?: boolean })`; limit 50, 1–500 | `Promise<CatalogProduct[]>`; busca descripción/código/barra en memoria |
| `issue` | `issue(request: DteRequest, options?: CallOptions)` | `Promise<IssueResult>` (`sellado` o `contingencia`) |
| `issueAndArchive` | `issueAndArchive(request: DteRequest, options: ArchiveEmissionOptions)`; el archivo, `operationId` e `idempotencyKey` son obligatorios; `remoteDestinations` opcional | `Promise<ArchiveEmissionResult>`; resultado fiscal, archivo local y copias remotas se informan por separado |
| `recoverOperation` | `recoverOperation(operationId, options?: { request?, archive?, signal?, remoteDestinations? })` | `Promise<ArchiveEmissionResult>`; recuperación por ID sin reconstruir la solicitud |
| `listPendingOperations` | `listPendingOperations(archive?)` | `Promise<PendingArchiveOperation[]>`; resumen seguro sin el DTE solicitado ni secretos |
| `replicateArchive` | `replicateArchive(operationId, archive, destinations, options?: { signal?: AbortSignal })` | `Promise<RemoteReplicationReport>`; copia bytes archivados y persiste estado por destino/artefacto |
| `diagnoseDestinations` | `diagnoseDestinations(operationId, archive, destinations, options?: { signal?: AbortSignal; artifacts?: ArchiveArtifact["kind"][] })` | `Promise<RemoteDestinationProbeReport>`; verifica artefactos existentes en solo lectura y no demuestra permisos de escritura |
| `prepare` | `prepare(request: DteRequest, options?: CallOptions)` | `Promise<PreparedDte>`; reserva número y entrega documento canónico sin firma |
| `sign` | `sign(prepared: PreparedDte, options?: CallOptions)` | `Promise<IssueResult>`; manda exactamente el documento preparado |
| `getDocumentStatus` | `getDocumentStatus(codigoGeneracion: string)` | `Promise<DocumentStatus>` |
| `listDocuments` | `listDocuments(filters?: ListDocumentsFilters)`; `limit` default 50, máximo API 100 | `Promise<DtePage>`; cursor `siguiente` o `null` |
| `invalidate` | `invalidate(codigoGeneracion, request: InvalidationRequest, options?: CallOptions)` | `Promise<InvalidationResult>`; evento fiscal irreversible |
| `invalidateAndArchive` | `invalidateAndArchive(codigoGeneracion, request, { archive, operationId, idempotencyKey })` | Persiste el comando antes de enviar y archiva el JWS del evento en el journal cifrado; el estado del archivo se revisa aparte |
| `recoverInvalidation`, `listPendingInvalidations` | `recoverInvalidation(operationId, archive?)`, `listPendingInvalidations(archive?)` | Reusa la misma clave dentro de la ventana segura; evita reenvíos tras expirar o si solo existe una respuesta escueta de «ya estaba anulado» |
| `downloadDocument` | `downloadDocument(codigoGeneracion, kind?: "json" \| "pdf" \| "ticket", options?: DownloadOptions)`; `kind` defaults to `"json"` | `Promise<DownloadedDocument>` with bytes, MIME type, and suggested filename; `ticket` is regenerated without issuing again |
| `print` | `print(document: DownloadedDocument, transport: PrintTransport, options?: { signal?: AbortSignal })` | `Promise<PrintResult>`; submits once and reports `submitted` or `unknown`, never `printed` |
| `listHolding` | `listHolding(limit?: number)`; default 50, máximo API 100 | `Promise<HoldingPage>`; lista limitada, sin cursor |
| `getContract` | `getContract()` | `Promise<unknown>`; OpenAPI JSON tal como lo publica el servidor |

`CallOptions` includes `idempotencyKey?` and `signal?`. `DownloadOptions`
includes `signal?` and `paperWidthMm?` (tickets only, integer 40–120, default
80). `ListDocumentsFilters` supports `desde?`, `hasta?`, `estado?`, `tipoDte?`,
`limit?`, and `cursor?`. `FactaOptions.timeoutMs` includes response-body reads.
Full TypeScript signatures are in [`src/client.ts`](src/client.ts); wire models
are in [`src/types.ts`](src/types.ts).
For the complete method-by-method behavior, scopes, defaults, side effects,
and recovery notes, see the [SDK method reference](guides/reference.es.md).

Todas las llamadas autenticadas envían `apiKey`. Los alcances adicionales son:

| Operaciones | Alcance de API | Credencial local adicional | Resultado / efecto principal |
|---|---|---|---|
| `status()`, `getContract()`, `syncDestinations()`, `syncCatalog()` | Ninguno | Sync de vaults requiere `unlockKey`; nunca se envía | Estado, contrato público o snapshot descifrado localmente. |
| Lecturas locales `list*`, `get*`, `search*` | Ninguno | `unlockKey` al primer sync; solo memoria del proceso después | Retornan registros del snapshot; `get*` usa `null` si no existe. |
| `getDocumentStatus()`, `listDocuments()` | `query` | Ninguna | Estado individual o página resumida. |
| `downloadDocument()`, `listHolding()` | `download` | None | Exact JSON/PDF/ticket bytes or bounded holding-area evidence. |
| `issue()`, `prepare()`, `sign()`, `invalidate()` | `issue` | `signKey` en `issue`, `sign` e `invalidate`; no en `prepare` | Emisión puede gastar correlativo; `invalidate` es una acción fiscal irreversible. |
| `issueAndArchive()`, `recoverOperation()` | `issue` + `download` | `signKey`; `unlockKey` if the request contains catalog references | Emite o recupera sin cambiar la clave de idempotencia y cifra los artefactos JSON/PDF/JWS/ticket. |
| `invalidateAndArchive()`, `recoverInvalidation()` | `issue` | `signKey` en la llamada inicial o en una recuperación segura | Conserva y recupera el evento firmado en un journal cifrado independiente del DTE original. |
| `diagnose()` | Como `status()` | Archivo local opcional; sync local se prueba solo si se piden sus métodos | Inspección previa; nunca abre vaults remotos ni reserva correlativos. |

Los errores HTTP se convierten en `FactaError` (`code`, `status`, `details`,
`isRejection` y `spent`). `spent` identifica el correlativo cuando Hacienda
rechaza después de reservarlo. Los errores locales de configuración, clave de
apertura incorrecta, formato cifrado, archivo y hash se lanzan antes de una
petición o se devuelven como `archive.state: "needs_attention"` después de
una emisión fiscal ya exitosa. El SDK reintenta solo errores declarados
transitorios; los rechazos de Hacienda y otros `4xx` no se reintentan.

Casos que cambian el flujo del integrador:

| Código/estado | Significado | Acción segura |
|---|---|---|
| `invalid_request`, `validation_failed`, `dte_type_not_allowed`, `amount_limit`, `no_storage_destination` | Datos, tipo, límite o destinos faltantes; estas validaciones ocurren antes de reservar. | Corregir el request/configuración y volver a emitir como operación nueva solo cuando el anterior falló antes de reservar. |
| `mh_rejected` (`error.isRejection === true`) | Hacienda leyó y rechazó el DTE; el correlativo sí se gastó. | Leer `error.spent` y corregir usando el mismo código/número de generación según norma. No repetir una emisión nueva. |
| `contingencia` en `IssueResult` | La respuesta es HTTP 202: se firmó el documento, pero Hacienda no devolvió sello final. | Guardar el código de generación y reconciliar con `getDocumentStatus()`. No es `FactaError`. |
| `idempotency_in_flight`, `network_error`, `service_unavailable`, `correlative_unavailable` | La respuesta final aún no se confirmó o el servicio no pudo completar la operación. | Reintentar solo con la misma clave y request; después de agotar reintentos, getDocumentStatus/reconciliar antes de crear otra operación. |
| `idempotency_key_reuse` | La misma clave llegó con un cuerpo diferente. | No insistir con ese par; compara el cuerpo contra el journal y no ocultes la colisión. |
| `operation_outcome_unknown` | La ventana segura de una anulación venció o la API solo confirma que ya estaba anulada, sin devolver el JWS del evento. | No volver a anular automáticamente; conciliar con Facta/Hacienda y conservar el journal para revisión. |
| `archive_integrity_error` | El journal de anulación completado no contiene un JWS válido o su hash no coincide. | No volver a anular; conserva los archivos cifrados para recuperación manual y revisa una copia antes de reparar. |
| `unauthorized`, `key_expired`, `key_revoked`, `forbidden_scope`, `sign_key_required`, `sign_key_invalid` | Credencial, vigencia, alcance o segundo factor incorrecto. | Corregir o renovar permisos/secretos en la app y gestor de secretos; no reintentar el mismo request a ciegas. |

La tabla completa de códigos HTTP y reglas de reserva está en
el [contrato OpenAPI publicado](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json), que es el contrato primario del
servidor. No cambies la lógica del integrador según el texto español de
`message`: clasifica con `code` y conserva `details` para diagnóstico.
El SDK elimina de `details` los campos de credenciales, redacta las llaves API,
de firma y apertura si aparecen en el texto, y no adjunta el mensaje interno de
un fallo de red. Evita registrar requests, documentos o configuraciones enteras.

### Opciones y valores por defecto

| Opción | Valor por defecto | Detalle |
|---|---|---|
| `baseUrl` | URL pública de Facta | La llave selecciona el ambiente de Hacienda; staging no usa otra URL de SDK. |
| `timeoutMs` | `60_000` | Deadline para la petición completa, incluido leer el cuerpo de respuesta. |
| `maxRetries` | `3` | Hasta tres reintentos para `idempotency_in_flight`, `mh_unreachable`, `service_unavailable`, `correlative_unavailable` y `network_error`; todo `POST` conserva la misma clave. |
| `CallOptions.idempotencyKey` | UUID generado por llamada `POST` | Para sobrevivir reinicios, suministra un ID estable de venta y repítelo solo para esa misma operación/cuerpo. |
| `CallOptions.signal` | Sin cancelación | `AbortSignal` cancela petición y reintentos posteriores. Si una emisión ya llegó al servidor, consulta su resultado con la misma clave antes de crear otra. |
| `CatalogSearchOptions.limit` | `50` | Entero entre `1` y `500`; búsquedas sin acentos en memoria. |
| `listDocuments().limit` | `50` | La API sirve un máximo de `100`; continúa con el cursor `siguiente` sin alterarlo. |
| `listHolding(limit)` | `50` | Lista hasta `100` registros recientes del área de retención; no expone rutas ni permite filtrar otra empresa. |

Las opciones no reciben certificado, clave privada, contraseña de Hacienda,
perfil de impresión ni proveedor de entrega: el SDK no firma localmente, no
transmite directo a impresoras; el envío por correo y WhatsApp lo hace la API cuando usted marca los canales (`deliver`).

### Consultas y descarga de documentos

`listDocuments()` acepta fechas ISO (`desde`, `hasta`), `estado`, `tipoDte`,
`limit` y el cursor opaco `cursor`. El servidor limita y valida la página; usa
el cursor recibido en `siguiente` hasta que sea `null`:

```ts
let cursor: string | undefined;
do {
  const page = await facta.listDocuments({ desde: "2026-09-01", limit: 50, cursor });
  for (const row of page.documentos) {
    console.log(row.codigoGeneracion, row.estado, row.tipoDte, row.totales?.totalPagar);
  }
  cursor = page.siguiente ?? undefined;
} while (cursor);
```

La fila de listado es un resumen; no contiene el documento firmado completo.
`getDocumentStatus(codigoGeneracion)` devuelve el estado individual, incluidas
contingencias y rechazos que el índice conozca. `downloadDocument(id, "json")`
devuelve JSON firmado con tipo MIME, nombre sugerido y `Uint8Array`; `"pdf"`
devuelve la representación gráfica disponible. Guarda o transmite esos bytes
directamente: parsear y serializar de nuevo el JSON cambia sus bytes. Ambas
descargas requieren el alcance `download`. Una respuesta `202` de emisión es
contingencia y no equivale a un rechazo ni a un DTE sellado.

```ts
import { writeFile } from "node:fs/promises";

const page = await facta.listDocuments({ estado: "sellado", tipoDte: "03", limit: 20 });
const first = page.documentos[0];
if (first) {
  const [json, pdf] = await Promise.all([
    facta.downloadDocument(first.codigoGeneracion, "json"),
    facta.downloadDocument(first.codigoGeneracion, "pdf"),
  ]);
  await writeFile(json.filename ?? `${first.codigoGeneracion}.json`, json.bytes);
  await writeFile(pdf.filename ?? `${first.codigoGeneracion}.pdf`, pdf.bytes);
}
```

El `codigoGeneracion` identifica el documento; `numeroControl` es el
correlativo fiscal. Ninguno sustituye el contenido legal JSON/JWS, el PDF,
el comprobante impreso o el estado de entrega a un tercero. Reimprimir o volver
a descargar no emite otro documento.

`listHolding(limit)` informa hasta 100 documentos recientes en el área de
retención temporal, con `whereLanded` (`holding` o `synced`), `gaveUp`,
`attempts`, `expiresAt`, conteo de descargas y fecha de sincronización. Es solo
estado, sin bytes ni rutas de almacenamiento; no es un historial paginado.
La retención inicial dura una hora. La API puede reconstruir archivos de DTE
emitidos por API desde su registro después de esa hora; los emitidos desde la
app pueden depender del destino original. Trata `listHolding()` como alerta de
copias, no como archivo de largo plazo: usa `issueAndArchive()` o tu destino
conectado para conservar documentos propios.

Las operaciones del catálogo requieren `unlockKey`. Las búsquedas se ejecutan
en memoria sobre los datos que el SDK descifra en el entorno del integrador;
no crean ni modifican clientes o productos en Facta.

Las operaciones `POST` generan y conservan un `Idempotency-Key` durante los
reintentos. `options.signal` permite cancelar una petición con `AbortController`.

## Emisión y archivo recuperable

`issueAndArchive()` recibe un `InvoiceArchive`, que el integrador implementa
para su entorno. El adaptador debe guardar `begin()` de forma durable antes de
que se resuelva; cada artefacto incluye su SHA-256. Debe permitir repetir una
escritura de los mismos bytes y rechazar una colisión con contenido distinto.
`assertReady()` debe probar una escritura real para detener la emisión antes
de gastar un correlativo si el almacenamiento no está disponible.

```ts
const readiness = await facta.diagnose({ tipoDte: "03", archive });
if (!readiness.canIssueAndArchive) {
  throw new Error(readiness.checks.map((check) => check.message).join("; "));
}

const result = await facta.issueAndArchive(solicitud, {
  includeTicket: false,
  archive,                     // implementa InvoiceArchive
  operationId: order.id,        // ID estable de la venta
  idempotencyKey: order.id,     // reutilizar al reintentar
});

if (result.archive.state === "needs_attention") {
  // La emisión fiscal ya ocurrió. Reintenta el archivo, no la factura.
  await alertOps(result.archive.detail);
}
```

`diagnose()` entrega `overall`, `canIssue`, `canQuery`,
`canDownload`, `canIssueAndArchive`, el conteo `pendingArchiveOperations` y
`revisions` con estado y números deseados/publicados para firma, destinos y
catálogo, además de comprobaciones legibles. Si no se pasa un archivo o no se
puede leer su journal, el conteo es `null`; la revisión nunca devuelve IDs,
hashes ni contenido del journal. El estado puede incluir la huella pública del
certificado de firma y sus fechas de vigencia, NIT y ambiente cuando la app los
haya registrado. No devuelve ciphertext, credenciales, llave privada ni
contenidos de vault o catálogo. Una revisión de catálogo pendiente solo advierte
cuando el integrador envía datos inline; destinos o firma pendientes impiden
declarar la emisión lista. Un certificado vencido o cuyo NIT no coincide
bloquea `canIssue`; una diferencia en el ambiente registrado solo genera una
advertencia porque ese campo identifica el slot desde el que se cargó la clave
pública. La falta de metadatos heredados se presenta como desconocida y no
bloquea una llave que ya funciona.

The SDK retains exact API JSON/PDF/JWS bytes and a regenerated ticket PDF as a
separate encrypted artifact. `ticketPaperWidthMm` defaults to 80 mm and is
stored in the encrypted operation journal so recovery uses the same width.
The same Node file archive also keeps invalidation intent, response, and compact
event JWS in a separate encrypted event journal; it never overwrites the
original invoice artifacts.
The Node package entry exposes `FileInvoiceArchive` and the client without
loading Node filesystem modules from the portable root entry. The archive
serializes writers across processes on supported local filesystems; network
filesystems are unsupported. Locks are never stolen automatically. After
stopping every writer, recover an abandoned lock explicitly:

```ts
import { Facta, FileInvoiceArchive } from "@facta-dte/api/node";

const archive = await FileInvoiceArchive.open({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!,
});
await archive.assertReady();
```

Node integrations can load an explicitly selected JSON `FactaConfigV1` profile
with `createFactaFromConfigFile()`. Keep API/signing/unlock credentials and
runtime adapters in application code or a secret manager; the config file only
contains versioned non-secret defaults. Values passed as `config` override the
matching file fields.

```ts
import { createFactaFromConfigFile } from "@facta-dte/api/node";

const facta = await createFactaFromConfigFile({
  configFile: "/etc/facta/client.json",
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,
  config: { version: 1, timeoutMs: 90_000 },
});
```

The file contains a `FactaConfigV1` object such as
`{"version":1,"baseUrl":"https://…/api-v1","ticketPaperWidthMm":58}`.
The loader rejects unknown keys and never discovers a file automatically.

```ts
await FileInvoiceArchive.releaseStaleLock({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  confirmNoConcurrentWriters: true,
});
```

La contraseña debe ser un secreto aleatorio de al menos 32 caracteres,
guardado en un gestor de secretos, y distinto de `FACTA_UNLOCK_KEY`. El
adaptador cifra journal, metadatos y bytes con AES-GCM; deriva la clave con
PBKDF2-SHA-256 y una sal local. Escribe archivos temporales, sincroniza sus
bytes y luego hace el reemplazo atómico. El bloqueo admite varios procesos en
un filesystem local compatible; filesystem de red no está soportado.

`issueAndArchive()` guarda la solicitud ya resuelta dentro del journal cifrado.
`recoverOperation(operationId)` y `listPendingOperations()` permiten a un worker
Node descubrir y reanudar trabajo tras reiniciar sin reconstruir la solicitud.
`recoverOperation()` también acepta explícitamente la solicitud para journals
anteriores que no la guardaban. Si el journal solo alcanzó `started`, usa la misma clave hasta un máximo conservador
de 23 horas (la API libera la clave a las 24 h). Después se detiene para
conciliación manual. Si ya existe el código de generación en el journal,
consulta ese DTE y recupera sus archivos sin enviar una segunda emisión.
`archive.pending()` lista operaciones incompletas localmente o con copias remotas
pendientes para que el proceso de arranque o un worker las reintente;
`archive.getArtifact()`
lee los bytes archivados y vuelve a verificar su SHA-256.

Cada operación nueva también guarda una identidad pública versionada: endpoint
normalizado, `keyId`, NIT emisor y ambiente confirmado por `/v1/status`. No
guarda llaves ni contraseñas. Antes de recuperar una emisión o anulación, el
SDK compara esos cuatro valores con la instancia actual. Si no coinciden, o
el registro heredado no tiene identidad, conserva el journal para inspección y
detiene la repetición automática. Use la instancia y credenciales originales
o concilie el resultado manualmente.

La recuperación verifica las huellas de los artefactos existentes y reutiliza
sus bytes. Solo descarga los que faltan; nunca reemplaza un PDF o JSON legal
guardado con una versión regenerada. El ticket conserva el ancho registrado
en la operación. Datos o metadatos incompletos se reportan como error de
integridad y requieren revisión.

## Modelos y cobertura DTE

Los tipos públicos se exportan desde `mod.ts` y están definidos en
`src/types.ts`. `DteRequest` es una unión discriminada por `tipoDte` y cubre
los seis tipos admitidos por la API (`01`, `03`, `05`, `06`, `11`, `14`).
`ExportRecipient`, `ExcludedSubjectRecipient`, `RelatedDocument` y
`ExportDetails` tipan los campos particulares. `Recipient`, `Address` e `LineItem`
describen los datos comunes; `IssueResult` discrimina `SealedDte` y `DteInContingency` por
`estado`; `PreparedDte`, `DocumentStatus`, `InvalidationResult`, `DtePage`, `HoldingPage`,
`Status`, `RateLimitWindow`, `Totals` y `FactaError` describen respuestas y errores.

La unión conserva el contrato fiscal del servidor: no calcula importes ni
reemplaza la validación de Hacienda. Los documentos `05` y `06` requieren
`documentosRelacionados`; el `11` requiere `receptor` extranjero y
`exportacion`; el `14` requiere el sujeto excluido. `numPagoElectronico` solo
aplica al `06`, y `aplicarReteRenta` solo al `14`. El detalle de restricciones
fiscales sigue en el [contrato OpenAPI publicado](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json).

### Ejemplos tipados por DTE

Los ejemplos completos están en [examples/dte-types.ts](examples/dte-types.ts).
La suite TypeScript los importa y compila en cada ejecución, además de verificar
que representan los seis códigos soportados.

| DTE | Ejemplo | Particularidad |
|---|---|---|
| FE consumidor final anónima (01) | `finalConsumerInvoice` | Omite `receptor`; no crea ficha de cliente. |
| FE con receptor inline (01) | `namedFinalConsumerInvoice` | Envía nombre y correo solo para ese documento. |
| Crédito fiscal (03) | `creditFiscalInvoice` | Recipient inline con documento, NRC, actividad y dirección. |
| Nota de crédito (05) | `creditNote` | Requiere `documentosRelacionados`. |
| Nota de débito (06) | `debitNote` | Requiere documento relacionado; admite `numPagoElectronico`. |
| Exportación (11) | `exportInvoice` | Requiere receptor extranjero y bloque `exportacion`. |
| Sujeto excluido (14) | `excludedSubjectInvoice` | Usa `ExcludedSubjectRecipient` y `aplicarReteRenta`. |

Recipient y productos inline nunca crean ni actualizan registros. Para usar un
`customerId` o `productId`, habilita la llave para ese snapshot, llama
`syncCatalog()` y deja que el SDK resuelva los campos antes de llamar la API.
En ambos flujos el servidor valida el documento y calcula los importes.

El catálogo es opcional para issue. Si no guarda clientes en Facta, envíe los
datos inline en `receptor`: el SDK no crea ni actualiza una ficha. Para una
FE (`01`) de consumidor final puede omitir el receptor. Para un CCF (`03`) debe
enviar los datos exigidos por Hacienda, incluido el nombre, aunque el cliente
no esté guardado en Facta. Este flujo inline no necesita `unlockKey`; usar
`customerId` sí requiere que el cliente exista en el snapshot local de esa llave.

```ts
const dte = await facta.issue({
  tipoDte: "03",
  receptor: {
    nombre: "Comercial Ejemplo, S.A. de C.V.",
    tipoDocumento: "36",
    numDocumento: "06141234567890",
    nrc: "1234567",
    codActividad: "46510",
    descActividad: "Venta al por mayor de equipo",
    direccion: {
      departamento: "06",
      municipio: "20",
      complemento: "Colonia Centro, San Miguel",
    },
    correo: "compras@example.com",
  },
  items: [{ descripcion: "Equipo", cantidad: 1, precioUni: 125 }],
}, { idempotencyKey: "pedido-ERP-1042" });
```

## Clientes, productos y sincronización

La aplicación web es la autoridad de escritura. Desde ella se mantienen los
registros y se importan archivos CSV; la API pública no crea ni actualiza
clientes o productos. Al sincronizar desde la aplicación, la llave recibe un
snapshot cifrado: los clientes respetan la selección configurada para esa
llave, los clientes futuros se agregan automáticamente salvo exclusión
explícita, y se publican los productos activos.

En el proceso del integrador, configura `unlockKey` con `FACTA_UNLOCK_KEY` y
llama `syncCatalog()` para descargar y abrir localmente el snapshot. Las
funciones `list*`, `get*` y `search*` leen esa copia local. Antes de reutilizarla,
el SDK consulta el estado público; si cambió la revisión publicada, descarga y
abre el snapshot más reciente automáticamente. También puedes forzar la carga
con `syncCatalog()`. Sin `unlockKey` siguen funcionando las emisiones que
incluyen `receptor` y datos completos de `items` en línea.

```ts
const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  unlockKey: process.env.FACTA_UNLOCK_KEY!,
});

const status = await facta.status();
if (status.sincronizacion?.catalog?.status === "pending") {
  // Primero el propietario debe completar la sincronización desde la app web.
  throw new Error("El catálogo de esta llave aún no se ha publicado");
}
await facta.syncCatalog();
const customer = await facta.getCustomer("customer-id");
const product = await facta.getProduct("product-id");
```

El snapshot es una copia autorizada, no un mecanismo de edición o sync
bidireccional desde el SDK. La resolución de `customerId`/`productId` sustituye
campos faltantes localmente; los campos explícitos del request prevalecen.
Un ID ausente o producto inactivo produce `FactaError` con código
`not_found`; `error.details` identifica el ID y `catalogRevision` usada en la
resolución. No se reintenta automáticamente con otro cliente ni se muta el
catálogo. La importación CSV disponible en la app admite previsualización,
validación y hasta 5,000 filas; clientes se emparejan por documento y
productos por código. Confirma la selección de llave y sincroniza otra vez para
publicar los cambios.

Al resolver un producto, el SDK conserva `tipoItem` y `uniMedida`. El precio
del catálogo debe usar la misma base de IVA que requiere el DTE: incluido para
FE (`01`), excluido para CCF y los demás tipos gravados. Si no coincide o el
dato está ausente, la resolución falla antes del envío. Un `precioUni` inline
explícito prevalece y debe expresarse en la base del documento. La excepción
FSE (`14`) no convierte el precio.

### CSV de clientes y productos

El archivo debe ser texto CSV UTF-8 con encabezados en la primera fila; la
app detecta `;`, `,`, tabulador o `|`, entiende BOM, CRLF, comillas y
separadores dentro de celdas entrecomilladas. No acepta `.xlsx`: guárdalo como
CSV desde Excel o Sheets. La pantalla previsualiza y deja corregir la
asociación de columnas antes de escribir; una fila inválida se devuelve con
su número y motivo sin perder las demás.

Ejemplo de clientes (solo nombre es obligatorio; sin documento se importa como
cliente de consumidor final y queda sin clave de deduplicación):

```csv
Nombre;TipoDoc;NumDoc;NRC;Giro;Correo;Telefono;Address
Meridian Trading;36;0614-241285-102-2;241058-7;62010 — Programación;compras@example.com;2222-0000;Colonia Escalón
Consumidor eventual;;;;;;;
```

El cliente se empareja por número de documento normalizado; tipo de documento
se infiere por columna o longitud (`36` NIT, `13` DUI, `03` pasaporte). Se
validan NIT, DUI y NRC antes de guardar. Actividad `62010 — Programación`
conserva el código inicial (`62010`); la dirección se guarda como una línea y
no inventa departamento/municipio para Hacienda.

Ejemplo de productos:

```csv
Codigo;Descripcion;Precio;Unidad;Tipo;IvaIncluido
SRV-1;Consultoría;1.234,56;59;Servicio;Sí
PROD-2;Café molido;3,50;59;Bien;No
```

Descripción y precio son obligatorios. El precio entiende `$ 12.50`, `12,50`,
`1.234,56` y `1,234.56`; una celda ilegible se rechaza, nunca se convierte a
cero. `Sí`, `true`, `1`, `x` y `yes` marcan IVA incluido; otros valores,
incluido vacío, quedan en falso. Tipo acepta `1`–`4`, `Bien` o `Servicio` y
por defecto es servicio (`2`); unidad no numérica/ausente queda en `59`. Estos
campos describen el catálogo; la aplicación/API siguen determinando la
interpretación fiscal al facturar.

Dentro de un archivo, si se repite un documento o código de producto se queda
la última fila. Al repetir un identificador ya guardado se actualiza ese
registro cifrado; no se duplica. Sin código de producto no hay clave de
deduplicación y cada fila se trata como registro independiente.

## Ticket, WhatsApp e impresión

`downloadDocument(generationCode, "ticket", { paperWidthMm })` asks Facta for a
ticket PDF based on the sealed DTE. It uses the company's current ticket
template, accepts widths from 40 to 120 mm, and defaults to 80 mm like the app
renderer. `"pdf"` still means the letter representation. Facta regenerates a
ticket from the sealed DTE, so it can be reprinted without issuing another
invoice. Invoices issued in the web app cannot be regenerated through this API.

The `print()` method submits a downloaded PDF once through a caller-supplied
`PrintTransport`. That adapter owns device discovery and spooling. The result
reports only `submitted` or `unknown`; it never reports `printed`, and the SDK
does not retry an uncertain job. Saving or sharing bytes does not prove delivery. To have Facta send the
document, mark `deliver` on `issue` (see `deliverEmail` / `deliverWhatsApp`).

## Las tres piezas, y por qué son tres

Al acuñar una llave, Facta te entrega **tres** cadenas y las muestra **una sola
vez**. No son tres formas de decir lo mismo: cada una abre algo distinto, y esa
separación es lo que hace que perder una no sea perderlo todo.

| | Qué abre | ¿Viaja a Facta? |
|---|---|---|
| `FACTA_API_KEY` | nada — identifica y autentica | sí, en cada petición |
| `FACTA_SIGN_KEY` (`factask_`) | tu vault de firma, **en el servidor de Facta**, durante un request | sí, solo al emitir |
| `FACTA_UNLOCK_KEY` (`factauk_`) | tus vaults locales de destinos y catálogo | **nunca** |

Consecuencias prácticas:

- **Con el token solo no se puede sign.** Un `.env` filtrado deja de ser poder
  de emitir documentos fiscales a tu nombre.
- **Guarda `FACTA_API_KEY` y `FACTA_SIGN_KEY` en sitios distintos** — la primera
  puede vivir con la configuración; la segunda, en el gestor de secretos del
  despliegue. Juntas en el mismo archivo se desperdicia media defensa.
- **`FACTA_UNLOCK_KEY` se configura como `unlockKey` únicamente para abrir los
  vaults localmente.** Si intentas ponerla como `signKey`, el constructor la
  rechaza. La implementación no la adjunta a ninguna petición.
- **Cinco intentos fallidos de abrir el vault de firma suspenden la llave.** Es
  la contrapartida de que el vault no se pueda descargar: como todo intento pasa
  por Facta, se puede contar y frenar.
- **`issue` y `sign` mandan `signKey`; `prepare`, `status` y `getDocumentStatus` no.**
  Reservar un correlativo no abre ningún vault.

## Las dos cosas que este cliente NO hace

1. **No calcula dinero.** Ni IVA, ni retenciones, ni totales, ni el número de
   control, ni fechas fiscales. Todo eso lo produce `dte-core` en el servidor y
   el cliente lo transporta. Un SDK que calcule dinero es un segundo motor
   fiscal, y dos motores se desincronizan el primer martes.
2. **No firma.** El certificado no pasa por aquí en ningún momento. Decisión de
   Marvin (2-sep-2026): *«para los SDK no necesitas sign, solo manejar los
   vaults; las firmas es en el server»*.

`test/architecture.test.ts` falla si alguna de las dos deja de ser cierta.

## Synchronize the destination vault and catalog

Set `unlockKey` from the deployment secret manager when this integration needs
the company's storage destinations or encrypted customer/product catalog.
`syncDestinations()` and `syncCatalog()` download only encrypted envelopes,
derive their wrapping keys, and decrypt them in the SDK process. The unlock key
is never added to an HTTP header, body, retry, or error message. Both methods
return their snapshots in memory; persist them only if your own application
has a suitable secret store. During the lifetime of one `Facta` instance, the
catalog snapshot stays in memory. A catalog reference checks the server's
published/desired revision and downloads a replacement only when that revision
changes; there is no disk cache.

```ts
const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,
  unlockKey: process.env.FACTA_UNLOCK_KEY,
});

const { destinos } = await facta.syncDestinations();
const { customers, products } = await facta.syncCatalog();
```

`syncDestinations()` decrypts destination configurations but does not itself
upload invoice artifacts. (Since this version `issueAndArchive()` and
`recoverOperation()` do replicate to the synced destinations by default when
`unlockKey` is set; see "Adónde van los documentos" in
[`guides/storage-adapters.es.md`](guides/storage-adapters.es.md). `issue()` never
writes storage; opt out with `replicate: false`.) `issueAndArchive()` stores exact artifacts in the
configured `InvoiceArchive`; remote replication is a separate step. Each runtime
can adapt a synced destination to the SDK's `RemoteArtifactDestination` port:

```ts
const destination = {
  id: "accounting-bucket",
  kind: "s3",
  label: "Accounting bucket",
  async write(artifact) {
    // Use the runtime's storage client and a deterministic object key.
    // Repeating an identical SHA-256 must be safe.
    await storage.put(objectKey(artifact), artifact.bytes, artifact.contentType);
    return "stored";
  },
  async check(artifact) {
    // Return "stored", "missing", or "unknown" after comparing the remote
    // object's checksum with artifact.sha256.
    return await inspectRemoteCopy(artifact);
  },
};

const issued = await facta.issueAndArchive(request, {
  includeTicket: false,
  archive,
  operationId: order.id,
  idempotencyKey: order.id,
  remoteDestinations: [destination],
});
```

For an existing runtime storage client that exposes only `put/get`,
`createStorageArtifactDestination()` supplies the verified bridge. It requires
a stable object-path function and an exact not-found classifier. The adapter
reads and hashes an existing object before writing, refuses to overwrite a
mismatched object, then reads back a new write before reporting `stored`. It
does not create a provider client or manage its credentials:

```ts
import { createStorageArtifactDestination } from "@facta-dte/api";

const destination = createStorageArtifactDestination({
  id: "accounting-bucket",
  kind: "s3",
  label: "Accounting bucket",
  store: existingStorageClient,
  pathForArtifact: (artifact) =>
    `api-invoices/${artifact.codigoGeneracion}/${artifact.kind}`,
  isNotFound: (error) => isObjectNotFound(error),
});
```

The path must be stable for the same generation code and artifact kind, and
must not contain `.` or `..` path segments. Return `true` from `isNotFound`
only for a definitive missing-object response; authorization and network
errors remain `unknown` so the SDK does not overwrite an object whose state it
cannot inspect. See [the storage adapter guide](guides/storage-adapters.es.md)
for adapter and cancellation details.

For AWS S3 and compatible services, the package also includes a signed
provider adapter. It verifies exact bytes and uses conditional create-if-missing
to prevent concurrent retries from overwriting a different artifact:

```ts
import { createS3ArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const s3 = destinos.find((destination) => destination.id === "accounting-bucket");
if (!s3) throw new Error("The API key has no accounting bucket destination");

const destination = createS3ArtifactDestination({
  id: s3.id,
  label: s3.label,
  config: JSON.parse(s3.secret),
});
```

S3 configurations need `bucket`, `region`, `accessKeyId`, and
`secretAccessKey`; compatible services can also provide `endpoint`, `pathStyle`,
and `prefix`. Keep decrypted credentials in memory and out of logs and archive
journals. The configured S3 service must support conditional object creation.
See [the storage adapter guide](guides/storage-adapters.es.md) for endpoint and
security details.

For a private bucket in a Supabase project, `createSupabaseArtifactDestination()`
uses the Storage REST API with `x-upsert: false` and verifies the uploaded bytes:

```ts
import { createSupabaseArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const backup = destinos.find((destination) => destination.id === "supabase-backup");
if (!backup) throw new Error("The API key has no Supabase destination");

const destination = createSupabaseArtifactDestination({
  id: backup.id,
  label: backup.label,
  config: JSON.parse(backup.secret),
});
```

The decrypted config uses `url`, `serviceKey`, and `bucket`, with optional
`prefix`. The service key has elevated access in that Supabase project; use a
private bucket and keep the decrypted credential in memory, outside logs and
archive journals. See [the storage adapter guide](guides/storage-adapters.es.md)
for its scope and conflict handling.

For Google Drive, the SDK writes below the authorized Facta folder and tags
its objects with a private app property so recovery can find the exact
artifact:

```ts
const driveRow = destinos.find((destination) => destination.kind === "gdrive");
if (!driveRow) throw new Error("No Google Drive destination is synced to this key");

const drive = createGoogleDriveArtifactDestination({
  id: driveRow.id,
  label: driveRow.label,
  config: JSON.parse(driveRow.secret),
  refreshAccessToken: async () => requestFreshGoogleDriveToken(),
});
```

Google's `drive.file` token expires and cannot be refreshed silently in every
runtime; the callback belongs to the integration. Google Drive also permits
duplicate names, so this adapter reconciles indexed matches and should be used
with one writer process per destination. See the [storage adapter guide](guides/storage-adapters.es.md)
for the concurrency limitation and recovery behavior.

FTP/SFTP can use the SDK's bridge adapter on the device where `facta-bridge`
runs. Add the port from that device's local pairing to the decrypted vault
secret; the port intentionally is not synchronized between devices:

```ts
const bridge = createBridgeArtifactDestination({
  id: row.id,
  label: row.label,
  config: { ...JSON.parse(row.secret), port: localBridgePort },
});
```

The adapter sends the bridge API key only to loopback and writes immutable
content-addressed paths. It does not carry the user's FTP/SFTP password. See
the [storage adapter guide](guides/storage-adapters.es.md) for bridge pairing and
path details.

For OneDrive, `createOneDriveArtifactDestination()` uses the Microsoft Graph
app folder and requires a token with `Files.ReadWrite.AppFolder`. The host
runtime owns refresh-token persistence and can pass a callback:

```ts
const destination = createOneDriveArtifactDestination({
  id: "accounting-onedrive",
  label: "Accounting OneDrive",
  accessToken: credentials.accessToken,
  refreshAccessToken: async () => {
    const updated = await refreshAndPersistOneDriveCredentials();
    return updated.accessToken;
  },
  prefix: "Facta/Invoices",
});
```

Uploads use sessions with conflict behavior `fail`; the SDK reads back and
checks the exact SHA-256 before reporting success. The preauthenticated upload
URL is used only for the transfer and is never stored in the archive journal.
Mocked Node and Deno consumers are covered; live OneDrive credentials are
still needed to validate provider behavior.

Google Drive has a built-in `drive.file` adapter with caller-managed token
refresh. Drive can retain duplicate files when independent processes race;
use one writer process per destination. The SDK reads each indexed match and
returns `unknown` if copies disagree. FTP/SFTP still require the user's local
bridge, for which this package provides a content-addressed adapter.
La nueva capacidad `getStorageStatus()`, `getDocumentCopies()` y
`retryDocumentStorage()` usa un contrato API-key-scoped del servidor; el SDK no
recibe credenciales R2 ni tokens de sesión de la aplicación. Hasta que el
servidor despliegue la versión 1, una respuesta 404/501 se informa como
`storage_unsupported`. Las copias BYOS siguen registrando cada destino y
artefacto como `stored`, `unknown`, `failed` o `unavailable` en el journal
cifrado. Una escritura que lanza error queda `unknown`, porque el proveedor
pudo confirmar antes de perderse la conexión. Implemente `check` para resolver
esa ambigüedad; si no, el siguiente replay explícito repite los mismos bytes y
debe ser seguro para el mismo hash. El archivo local puede completarse aunque
una copia remota requiera atención. `archive.pending()` incluye las copias sin
resolver y `recoverOperation()` las reconcilia sin emitir un segundo DTE.

The Facta app remains the writer. If the API reports a stale or pending
destination revision, synchronize the key from **Configuración → API de Facta**
while the company vault is open, then retry. `legacy` means the key has not yet
been enrolled; its old snapshot remains readable during the migration window.
When `receptor.customerId` or `items[].productId` is supplied, the SDK resolves
those references from the local snapshot and sends the complete fiscal fields
inline. Inline data remains usable without a catalog reference. New customers
and products appear in a key after the owner publishes its snapshot from the
app. The API-key creation screen can limit which existing customers are in a
key's local SDK catalog. Later customer additions are included automatically;
existing exclusions are retained in the encrypted sync policy. This is a
catalog-resolution boundary: an integrator that calls HTTP directly and sends
a complete inline receptor remains responsible for that data and is not
restricted by the local SDK snapshot.

## Lo que sí hace, y por qué vale las líneas que ocupa

- **`Idempotency-Key` por operación**, generada si no la das y **reusada en cada
  reintento**. Generar una nueva por intento es exactamente el error que esta
  cabecera existe para evitar: quemaría un segundo correlativo.
  Si tu sistema ya tiene un identificador para la venta (número de pedido, ticket
  de caja), pásalo — así la operación es idempotente entre reinicios del proceso
  y no solo entre reintentos de una llamada.
- **Reintentos solo donde reintentar es seguro**: `409 idempotency_in_flight`
  (la primera petición sigue trabajando) y 502/503 (nadie juzgó nada). Nunca en
  un 4xx, y **nunca en un rechazo**.
- **Errores tipados**. `error.isRejection` distingue «Hacienda leyó el documento
  y lo negó» de «no llegamos a Hacienda», que es la diferencia que decide qué
  hacer después. `error.spent` da el correlativo que ya se gastó: el §167 de la
  normativa permite corregir con ESE mismo número.

## Tres cosas que conviene saber antes de la primera venta

- **`precioUni` incluye IVA en una factura (01) y lo excluye en un crédito
  fiscal (03).** Así lo definen los esquemas oficiales; el servidor no adivina.
- **`202` es un resultado, no un fallo.** Significa que el documento quedó
  FIRMADO y el MH no respondió: los bytes existen y se le deben a Hacienda. Se
  retransmite solo, en contingencia. Reintentar ahí signía un segundo
  documento.
- **Archiva `jws`, no `documento`.** Volver a serializar el JSON no reproduce
  los bytes cuya firma Hacienda validó.

## Correr las pruebas

```bash
deno test --allow-read --allow-net .        # pruebas unitarias, sin red real
FACTA_API_KEY=facta_test_… FACTA_SIGN_KEY=factask_… deno task hola   # emite en 00
```

### Reportes públicos de pruebas live

El workflow de staging publica solamente una tabla de validación en el PR y
el resumen de la ejecución. Comprueba la factura de pruebas, el JSON firmado
y el PDF en memoria y en un archivo temporal cifrado, que elimina al terminar.
No sube los documentos ni publica identificadores del emisor o receptor,
códigos de generación, números de control, errores crudos de la API o datos
incluidos en errores de comparación.

Los datos del receptor en consultas y listados pueden ser nulos para documentos cifrados en la app Facta, importados o restaurados con una clave de empresa que la API no tiene. El SDK conserva ese valor: un cliente del catálogo actual no demuestra quién era el receptor del documento histórico. `unlockKey` abre solamente los snapshots publicados del catálogo y los destinos, no los datos cifrados del receptor de facturas históricas.

El workflow completo de staging exige abrir el catálogo publicado por el dueño y, para BYOS, su snapshot de destinos antes de emitir la factura de pruebas. Si solamente usa Facta y está listo, no requiere un snapshot BYOS. Si falta un snapshot requerido, la ejecución falla. La compatibilidad del SDK con respuestas de estado anteriores no elimina este requisito de integración.

### Ejemplos ejecutables y fallas de almacenamiento

Los [ejemplos de flujos](examples/workflows.ts) incluyen emisión con almacenamiento
Facta, archivo local cifrado y BYOS, recuperación después de reiniciar,
referencias del catálogo, tickets de 58 mm, invalidación de una factura de
pruebas designada y diagnóstico de servidores anteriores. Los [seis tipos DTE](examples/dte-types.ts)
son plantillas tipadas: sustituya los datos de ejemplo y proporcione documentos
sellados de su empresa para las notas antes de usarlos en vivo. Importarlos no emite.

Instale `@facta-dte/api`, copie los ejemplos a su proyecto y llame explícitamente
las funciones exportadas. Para el ejemplo mínimo:

```sh
node --experimental-strip-types --input-type=module -e "import { main } from './examples/hola-factura.ts'; await main();"
deno eval "import { main } from './examples/hola-factura.ts'; await main();"
```

Configure primero una llave de pruebas, la URL explícita y un `ERP_ORDER_ID`
estable. Si falta esa configuración, el ejemplo se detiene antes de emitir.
`pack:check` compila todos los ejemplos y ejecuta sus funciones con fixtures
sintéticos en Node/Deno contra el paquete empacado. Las condiciones fiscales
para probarlos en vivo se validan por separado.

Un recibo de almacenamiento inválido conserva el éxito fiscal: se omite el
recibo y se expone `storageErrorCode: storage_contract_invalid`. El archivo
cifrado conserva esa condición como operación pendiente hasta obtener un
recibo válido por reparación. No emita con una identidad fiscal nueva.
Una capacidad de almacenamiento presente pero inválida bloquea el diagnóstico;
las rutas ausentes de servidores anteriores siguen como desconocidas. Si
Facta está listo, la sincronización BYOS es opcional; la firma y las referencias
solicitadas del catálogo conservan sus comprobaciones.

La prueba de staging exige almacenamiento Facta listo, compara los recibos
JSON/PDF con los bytes exactos, descarga las copias de Facta, repite la clave
original de idempotencia, repara solamente esa factura y confirma que no
creció el consumo. Publica etiquetas fijas. Los tickets, las invalidaciones y
los seis tipos fiscales requieren documentos designados y condiciones fiscales
válidas para afirmar que se probaron en vivo.

Use `downloadDocument(generationCode, "pdf", { source: "managed" })` para exigir la copia JSON/PDF de Facta sin recurrir a retención. Esta opción no admite tickets; un servidor anterior sin prueba de origen devuelve `storage_unsupported`. Se conserva el orden de descarga predeterminado.

## Publicación automatizada

La publicación se realiza desde el workflow `publish.yml` de GitHub Actions
en `Facta-DTE/facta-api-sdk`, con Trusted Publishing de npm (OIDC), sin guardar
un token de publicación. El editor de confianza debe permitir `npm publish`.
Un tag `v<versión-del-paquete>` ejecuta las pruebas, valida el paquete en
consumidores independientes y lo publica. El commit debe pertenecer a `main`
y su versión debe coincidir con `package.json`. Las versiones estables usan
`latest`; las preliminares usan su propio tag.

Integre y valide la versión en `main` antes de enviar un tag nuevo. No mueva
un tag existente ni intente volver a publicar una versión ya publicada. El
workflow publica directamente, sin una aprobación separada en npm.
