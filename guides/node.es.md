# Guía de integración: Node.js

Para conocer las firmas públicas, alcances, valores predeterminados, efectos
y mecanismos de recuperación, consulta la [referencia de métodos del SDK](reference.es.md).

**Estado:** `0.1.0-beta.1` está publicado en npm. Se está preparando la versión
estable `0.1.0`; no estará disponible hasta aprobar su revisión de staging en
npm.

## Requisitos e instalación

- Node.js 22 o 24, ESM y TypeScript 5.9+ para compilar el consumidor.
- Cuenta de Facta y una llave `facta_test_…` habilitada para `issue`, `query`
  y `download` según las operaciones que use la integración.
- Al abrir snapshots locales, también `FACTA_UNLOCK_KEY`. Al issue, además
  `FACTA_SIGN_KEY`.

Valida una copia del repositorio con:

```sh
pnpm install --frozen-lockfile
pnpm pack:check
```

Esto prueba el tarball en consumidores limpios. Instala una versión aprobada y
explícita, y fija el número en el lockfile de la aplicación. Cuando se apruebe
`0.1.0`, usa esa versión estable; hasta entonces, usa la beta de forma
intencional.

## Configurar el cliente

Inyecta secretos desde el gestor de secretos del proceso. No los pongas en el
código fuente ni imprimas `FactaOptions` en los logs.

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  baseUrl: process.env.FACTA_API_BASE_URL,
  timeoutMs: 60_000,
  maxRetries: 3,
});

const health = await facta.status();
if (!health.ok || health.ambiente !== "00") {
  throw new Error("La llave no está lista en el ambiente de pruebas");
}
```

`baseUrl` usa la URL pública de Facta si se omite. El prefijo de la llave
selecciona pruebas (`facta_test_`, ambiente `00`) o producción (`facta_live_`,
ambiente `01`); no hay una URL de staging distinta. `status()` confirma la
llave, empresa, revisiones y cuotas. También consume una llamada de estado,
pero no necesita `issue`, `query` ni `download`.

Para valores no secretos, Node puede cargar un archivo JSON explícito con
`createFactaFromConfigFile()` desde `@facta-dte/api/node`. El objeto del archivo
usa `FactaConfigV1` (`version: 1`); se rechazan claves desconocidas y los valores
pasados en `config` prevalecen. Mantén llaves, archivos locales y adaptadores
fuera del archivo:

```ts
import { createFactaFromConfigFile } from "@facta-dte/api/node";

const facta = await createFactaFromConfigFile({
  configFile: "/etc/facta/client.json",
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,
});
```

## Emitir con o sin cliente guardado

Los datos inline aplican solo a la factura y nunca crean o editan una ficha.
Para una FE anónima (`01`) se puede omitir `receptor`. Para una FE nominada o
CCF, envía el receptor exigido por ese DTE:

```ts
const result = await facta.issue({
  tipoDte: "03",
  receptor: {
    nombre: "Comercial de Prueba, S.A. de C.V.",
    tipoDocumento: "36",
    numDocumento: "06140000000001",
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
  items: [{ descripcion: "Servicio de instalación", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "erp-order-1042" });

if (result.estado === "sellado") {
  console.log(result.codigoGeneracion, result.numeroControl, result.selloRecibido);
} else {
  // 202: firmado y pendiente de respuesta final del MH; consulta después.
  console.log(result.estado, result.codigoGeneracion, result.detalle);
}
```

Usa el mismo `idempotencyKey` al reintentar la misma venta después de un
timeout. No uses esa clave con otro cuerpo. El SDK genera una por POST si no
se pasa una, pero una clave de pedido estable permite recuperar la operación
después de reiniciar Node.

`FactaError` separa rechazos fiscales de errores técnicos. Un rechazo de
Hacienda ya consumió el número y `error.spent` devuelve su generación y control
para poder corregir la operación según el contrato de la API:

```ts
import { FactaError } from "@facta-dte/api";

try {
  await facta.issue(request, { idempotencyKey: "erp-order-1042" });
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    console.error("Hacienda rechazó el DTE", error.spent?.numeroControl, error.message);
  } else {
    throw error;
  }
}
```

## Listar y guardar JSON/PDF

La lista devuelve resúmenes y un cursor estable. Descarga los bytes legales
por separado y escríbelos sin parsear/re-serializar el JSON:

```ts
import { writeFile } from "node:fs/promises";

const page = await facta.listDocuments({ tipoDte: "03", limit: 50 });
for (const invoice of page.documentos) {
  const json = await facta.downloadDocument(invoice.codigoGeneracion, "json");
  await writeFile(json.filename ?? `${invoice.codigoGeneracion}.json`, json.bytes);
}
```

El ejemplo guarda solo la primera página. Un proceso reconciliador debe seguir
`page.siguiente` mientras no sea `null`. El método `"pdf"` descarga la
representación gráfica cuando existe. Ninguno de esos pasos imprime o envía
por WhatsApp.

## Archivo durable y recuperación

Importa el adaptador Node desde la subruta, y guarda su contraseña en un
secreto diferente a `FACTA_UNLOCK_KEY`:

```ts
import { Facta } from "@facta-dte/api";
import { FileInvoiceArchive } from "@facta-dte/api/node";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
});

const archive = await FileInvoiceArchive.open({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!,
});
const diagnostic = await facta.diagnose({ dteType: "03", archive });
if (!diagnostic.canIssueAndArchive) {
  throw new Error(diagnostic.checks.map((item) => item.message).join("; "));
}
```

Los diagnósticos del certificado usan solo la huella pública, las fechas de
vigencia, el NIT y el ambiente que la app web ya registró. Un certificado
vencido o un NIT distinto bloquean `canIssue`; una diferencia de ambiente solo\se advierte porque el registro conserva como contexto el espacio donde se subió
la llave pública. Las llaves antiguas sin una fila de metadatos públicos siguen
funcionando y el diagnóstico aparece como desconocido hasta que la app publique
esos datos. La ruta de estado nunca devuelve entradas cifradas del vault ni una
llave privada.

Las versiones anteriores de la API pueden omitir todo el bloque de estado
`sincronizacion`. En ese caso, `diagnose()` informa advertencias de compatibilidad
y sigue verificando la firma configurada, los datos del certificado, los
permisos, el ambiente, los límites y el archivo local. Si el bloque está presente
pero es nulo o incompleto, hay sincronización pendiente o fallida, o las
revisiones no coinciden, la emisión sigue bloqueada.

`issueAndArchive()` registra primero la clave de idempotencia y luego cifra los
bytes exactos de JSON, PDF, JWS y ticket. El ancho predeterminado del ticket es
80 mm; usa `ticketPaperWidthMm` (40–120 mm) para elegir otro ancho admitido. La
elección se guarda en el journal y se reutiliza al recuperar. Tras reiniciar,
lista `facta.listPendingOperations(archive)` y llama a
`facta.recoverOperation(operation.id, { archive })`; el journal cifrado aporta la
solicitud original ya resuelta, así que la integración no necesita
reconstruirla. El archivo serializa escritores entre procesos en sistemas de
archivos locales compatibles; no admite sistemas de archivos de red. Los
bloqueos nunca se roban automáticamente. Si un proceso se detiene mientras
conserva uno, detén todos los escritores y llama a
`FileInvoiceArchive.releaseStaleLock({ directory, confirmNoConcurrentWriters: true })`
antes de reanudar. `lockTimeoutMs` limita las esperas y vale 30 segundos de forma
predeterminada.

El directorio del archivo usa `formatVersion: 1` en la raíz. Los journals de
facturas y anulaciones escritos por este SDK añaden `schemaVersion: 1`; los
journals v1 existentes sin ese campo siguen siendo legibles y se reescriben en
v1 al modificarse. Una versión desconocida detiene la operación con
`archive_integrity_error`. Antes de abrir el directorio con un SDK nuevo,
conserva una copia de seguridad completa. No borres ni edites manualmente los
archivos cifrados para resolver un error de versión.

La anulación también es irreversible, así que archiva la respuesta del evento
por separado del DTE original. Después de reiniciar, reutiliza los mismos IDs de
operación e idempotencia:

```ts
const generationCode = result.codigoGeneracion;
const invalidation = await facta.invalidateAndArchive(
  generationCode,
  {
    tipoAnulacion: 2,
    motivo: "Correction",
    responsable: { nombre: "Issuer", tipoDocumento: "36", numDocumento: "06140000000001" },
    solicita: { nombre: "Operator", tipoDocumento: "36", numDocumento: "06140000000001" },
  },
  { archive, operationId: stableOperationId, idempotencyKey: stableIdempotencyKey },
);

// Tras reiniciar, concilia cada evento guardado con su clave de idempotencia original.
for (const operation of await facta.listPendingInvalidations(archive)) {
  await facta.recoverInvalidation(operation.id, archive);
}
```

Si la recuperación devuelve `operation_outcome_unknown`, revisa el estado fiscal
antes de actuar. No generes otra clave de operación para el mismo evento.

La replicación remota usa un adaptador `RemoteArtifactDestination` que el
runtime crea desde la instantánea de destinos abierta localmente. Pasa los
adaptadores en `remoteDestinations` a `issueAndArchive()` o llama a
`replicateArchive(operationId, archive, destinations)` después de emitir. Las
escrituras deben usar rutas deterministas y poder repetirse con seguridad si los
bytes SHA-256 son idénticos. Implementa `check(artifact)` para conciliar
timeouts ambiguos. El journal cifrado registra el estado por destino y
artefacto; las copias remotas pendientes siguen visibles y
`recoverOperation()` puede reintentarlas sin emitir otro DTE. La autenticación del
proveedor y los requisitos de la plataforma corresponden al adaptador.

`print()` envía una sola vez un PDF descargado mediante el `PrintTransport` que
proporciona la aplicación. El estado `submitted` del adaptador indica que el
trabajo se aceptó para entrar a la cola, no que se imprimió físicamente. Si el
resultado es `unknown`, concílialo con el adaptador antes de reintentarlo.

## Datos guardados y migración

El API/SDK no guarda clientes ni productos. El propietario los mantiene o los
importa por CSV en Facta y publica snapshots cifrados desde la app web. El SDK
solo los lee y resuelve sus IDs en memoria. Los nombres inline, la lista de
facturas y el contenido fiscal obedecen los límites de acceso de la llave.
Para pasar de otro cliente HTTP, conserva la misma `Idempotency-Key`, mapea
su respuesta a `IssueResult` y no recalcules totales ni el documento
canónico.

## Ticket y reimpresión

La representación tamaño carta y el ticket son artefactos PDF separados. Pide
un ticket a Facta después del sellado; esto no emite el DTE otra vez:

```ts
const ticket = await facta.downloadDocument(dte.codigoGeneracion, "ticket", {
  paperWidthMm: 80, // 40–120 mm; omite esta opción para usar 80 mm
});
await writeFile(ticket.filename ?? `${dte.codigoGeneracion}-ticket.pdf`, ticket.bytes);
```

Facta genera el ticket con la plantilla vigente de la empresa. La API no
detecta impresoras ni confirma trabajos de impresión, y tampoco envía mensajes
por WhatsApp. Guardar o compartir los bytes no demuestra que se entregaron o
imprimieron. El envío y la cola de impresión siguen siendo responsabilidad de
la integración hasta que se definan esos transportes y sus contratos de estado.

Para enviar el PDF descargado a una impresora, pásalo a un adaptador de transporte:

```ts
const printResult = await facta.print(ticket, printerTransport);
if (printResult.state === "unknown") {
  // Reconcilia con el adaptador antes de volver a enviar este trabajo.
}
```

`printerTransport` implementa el contrato exportado `PrintTransport`. El SDK no
incluye un controlador de dispositivo ni reintenta un trabajo cuyo resultado
de envío sea desconocido.


[English version](node.md) · [Métodos públicos y tipos](reference.es.md)
