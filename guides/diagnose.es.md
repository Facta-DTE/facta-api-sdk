# Diagnóstico

[English guide](diagnose.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Antes de que una integración emita su primer documento (y después, como
revisión de salud) conviene saber: ¿la llave es válida, está en el ambiente
correcto, tiene los alcances necesarios, puede firmar, tiene dónde guardar los
documentos? `diagnose()` responde esas preguntas con los datos públicos de
estado, sin abrir ningún vault y sin reservar un número de control. Lo
complementan dos herramientas más pequeñas: `catalogState()` para el catálogo y
`diagnoseDestinations()` para las copias remotas.

## `diagnose(options?)`

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  config: { version: 1, expectedEnvironment: "00", requiredScopes: ["issue", "query", "download"] },
});

const report = await facta.diagnose({ dteType: "03" });
if (!report.canIssue) {
  for (const check of report.checks) {
    if (check.state === "blocked") console.error(check.id, check.message);
  }
}
```

`DiagnoseOptions` (todas opcionales):

| Opción | Efecto |
| --- | --- |
| `archive` | Un `InvoiceArchive` para probar lectura/escritura y contar operaciones pendientes. Por defecto, `runtime.archive`. |
| `dteType` | Confirmar que la llave puede emitir ese `tipoDte`. |
| `expectedEnvironment` | `"00"` o `"01"`; si no coincide, bloquea la emisión. Por defecto, `config.expectedEnvironment`. |
| `requiredScopes` | Alcances que necesita su integración; cada uno que falte bloquea la emisión. Por defecto, `config.requiredScopes`. |

Hace `GET /v1/status` y `GET /v1/storage/status` (más el descubrimiento de
región, una sola vez). Si no puede leer el estado **no** lanza: devuelve un
informe `blocked` con un único chequeo `api` que nombra el código de error.

## El informe

`DiagnosticsReport`:

| Campo | Significado |
| --- | --- |
| `overall` | `"blocked"` cuando no se puede emitir; `"attention"` cuando algún chequeo está en `warning` o `unknown`; si no, `"ready"`. |
| `canIssue`, `canQuery`, `canDownload` | Lo que esta llave puede hacer ahora. |
| `canIssueAndArchive` | `canIssue` y además pasó el chequeo del archivo. |
| `storageReady` | El almacenamiento administrado o un destino BYOS verificado está listo; `null` cuando el servidor no lo dice. |
| `pendingArchiveOperations` | Cantidad según el archivo, o `null` sin archivo. |
| `catalogMode` | `encrypted`, `readable`, `plain` o `null`. |
| `region`, `servedRegion` | Vea [region.es.md](region.es.md). |
| `revisions` (`DiagnosticRevisions`) | Revisiones públicas de `sign`, `destinations` y `catalog` (`SyncRevision`), o `null`. |
| `checks` (`DiagnosticCheck[]`) | `{ id, state, message }`; `state` es un `DiagnosticState`: `ok`, `warning`, `blocked` o `unknown`. |

`overall` es estricto: una llave de producción siempre añade un aviso
`environment`, y la falta de archivo añade chequeos `unknown`, así que muchas
integraciones sanas leen `"attention"`. **Decida con `canIssue` / `canQuery` /
`canDownload`**, y use `overall` y los mensajes para las personas. Una llave
solo de consulta lee `overall: "blocked"` porque no puede emitir, mientras que
`canQuery` es `true`.

## Los chequeos

| `id` | Qué revisa |
| --- | --- |
| `api` | `/v1/status` respondió `ok`. |
| `issuer`, `issuer-environment` | La llave tiene empresa emisora, en el ambiente de la llave. |
| `scope-issue`, `scope-query`, `scope-download` | Los alcances de la llave. |
| `configured-scope-<alcance>` | Cada alcance de `requiredScopes`. |
| `configured-environment` | `expectedEnvironment`, cuando se configuró. |
| `environment` | `ok` para `00`; `warning` en producción, como recordatorio. |
| `issue-quota` | Ventanas por hora y por día: bloqueado en cero, aviso por debajo del 10 %. |
| `key-expiry` | Bloqueado si venció, aviso si vence en 72 horas. |
| `dte-type` | Solo con `dteType`. |
| `certificate-metadata`, `certificate-identity`, `certificate-environment`, `certificate-validity` | Datos públicos del certificado: huella, que el NIT coincida con el emisor, ambiente registrado, vigencia (aviso dentro de 30 días). |
| `signing`, `sign-sync` | Hay un vault de firma provisionado y sincronizado. |
| `destinations-sync` | La foto de destinos BYOS está sincronizada (opcional cuando el almacenamiento administrado está listo). |
| `catalog-sync` | La foto del catálogo está sincronizada; solo puede ser `ok` o `warning`. |
| `managed-storage` | El almacenamiento administrado o un destino BYOS verificado está listo; `unknown` cuando el servidor o la llave no lo exponen. |
| `archive`, `archive-pending` | Con archivo: puede leer y escribir, y cuántas operaciones hay pendientes. |
| `emergency-store` | Informativo: si `runtime.emergencyStore` está configurado. Siempre `ok` y nunca cambia `overall`. |

Los mensajes son texto en inglés para los registros y pueden cambiar; decida
con `id` y `state`.

## `catalogState()`

`catalogState()` compara la foto local del catálogo con lo que publica el
servidor, sin devolver nada del contenido del catálogo:

```ts
const catalog = await facta.catalogState();
// { catalogMode, freshness: "fresh" | "stale" | "missing", localRevision, fetchedAt,
//   desiredRevision, publishedRevision, syncStatus, statusError }
if (catalog.catalogMode === "encrypted" && catalog.freshness !== "fresh") await facta.syncCatalog();
```

Un catálogo `plain` se lee en vivo desde la API y siempre informa `fresh`.
Cuando no se puede leer el estado, `statusError` trae un código de error seguro
y la llamada no lanza. Vea [catalog.es.md](catalog.es.md).

## `diagnoseDestinations(operationId, archive, destinations, options?)`

Una revisión de solo lectura de las copias remotas de una operación archivada
**completa**. Para cada destino y artefacto (`json`, `pdf`, `jws`, más `ticket`
cuando se archivó uno, o los tipos de `options.artifacts`) informa `stored`
(bytes iguales y legibles), `missing`, `unknown` (la revisión falló) o
`unsupported` (el adaptador no tiene `check`). No escribe nada, así que no
prueba el permiso de escritura.

```ts
const probe = await facta.diagnoseDestinations("sale:1042", archive, destinations);
for (const r of probe.results) console.log(r.label, r.artifact, r.state);
```

## Qué puede salir mal

- **`overall: "attention"` en una integración de producción sana**: es lo
  esperado (el aviso `environment`). Use los booleanos `can*`.
- **`managed-storage` bloqueado**: no está listo ni el almacenamiento
  administrado ni un destino BYOS verificado; lo más probable es que la emisión falle con
  `no_storage_destination`.
- **`signing` bloqueado**: la llave no tiene vault de firma; vuelva a acuñarla
  desde la aplicación de Facta (`sign_vault_missing` al emitir).
- **`configured-environment` bloqueado**: una llave `facta_live_` donde
  esperaba `00`, o al revés.
- **`diagnoseDestinations` lanza**: la operación no está completa localmente,
  falta un artefacto local o no pasa su revisión SHA-256, o los ids de los
  destinos no son únicos.

## Relacionado

- [Salvaguarda de emergencia](emergency.es.md) · [Fijación de región](region.es.md)
- [Adaptadores de almacenamiento](storage-adapters.es.md) ·
  [Catálogo de errores](errors.es.md)
- [Referencia de métodos](reference.es.md)
