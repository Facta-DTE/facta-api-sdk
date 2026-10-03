# Adaptadores de almacenamiento en tiempo de ejecución

[English version](storage-adapters.md) · [README en español](../README.es.md)

El SDK gestiona la integridad de artefactos, el estado de replicación y la coordinación de reintentos y recuperación. No administra credenciales de nube ni configura proveedores. Un entorno Node, Deno o la aplicación crea el cliente de destino usando credenciales obtenidas por el canal aprobado y proporciona un `RemoteArtifactDestination` o el puerto más sencillo `ArtifactStore`.

## Adaptar un cliente `put/get` existente

```ts
import { createStorageArtifactDestination } from "@facta-dte/api";

const destination = createStorageArtifactDestination({
  id: "private-invoices",
  kind: "s3",
  label: "Private invoice bucket",
  store: existingClient,
  pathForArtifact: (artifact) =>
    `DTE/API/${artifact.codigoGeneracion}/${artifact.kind}`,
  isNotFound: (error) => isDefinitiveObjectNotFound(error),
});
```

`store` implementa:

```ts
interface ArtifactStore {
  put(path: string, bytes: Uint8Array, contentType: string,
      options?: { signal?: AbortSignal }): Promise<void>;
  get(path: string,
      options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  /** Operación atómica opcional de creación si no existe. */
  putIfAbsent?(path: string, bytes: Uint8Array, contentType: string,
      options?: { signal?: AbortSignal }): Promise<"created" | "exists">;
}
```

La función necesita una ruta de objeto determinista para el mismo código de generación y tipo de artefacto. Las rutas son claves relativas. El SDK rechaza rutas vacías, con raíz, segmentos de recorrido, barras invertidas o NUL. Mantén privado el bucket o contenedor: el JSON DTE y los PDF contienen datos personales y transaccionales.

## AWS S3 y buckets compatibles con S3

El SDK incluye el adaptador integrado `createS3ArtifactDestination()`. Usa WebCrypto SigV4 y escrituras condicionales `If-None-Match: *`; después vuelve a leer el objeto y compara SHA-256. Así evita la carrera en que dos procesos del SDK detectan una ruta ausente y luego reemplazan bytes distintos. El servicio del bucket debe admitir creación condicional de objetos. AWS usa HTTPS y un endpoint regional por defecto; los endpoints personalizados usan estilo de ruta por defecto. HTTP sin cifrar solo se permite para un endpoint localhost habilitado expresamente para un laboratorio local de almacenamiento.

```ts
import { createS3ArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const destinationConfig = JSON.parse(destinos.find((item) => item.id === "s3-id")!.secret);
const destination = createS3ArtifactDestination({
  id: "s3-id",
  label: "Accounting bucket",
  config: destinationConfig,
});
```

La configuración usa `bucket`, `region`, `accessKeyId` y `secretAccessKey`; los servicios compatibles con S3 también pueden proporcionar `endpoint`, `pathStyle` y `prefix`. Trata el `secret` descifrado y la configuración analizada como credenciales: consérvalos en memoria, no los registres en logs ni los guardes en el archivo de facturas. Por defecto, cada artefacto exacto usa `api-invoices/{codigoGeneracion}/{kind}` bajo el prefijo configurado. Define `pathForArtifact` si la integración ya tiene una convención de claves.

## Supabase Storage

El SDK también incluye `createSupabaseArtifactDestination()`. Usa la URL del proyecto, el bucket y la clave de servicio configurados con la API REST de Supabase Storage. Las cargas envían `x-upsert: false`; si el objeto ya existe, se lee y compara, y un conflicto de creación provoca una lectura en lugar de reemplazarlo.

```ts
import { createSupabaseArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const row = destinos.find((destination) => destination.id === "supabase-backup");
if (!row) throw new Error("Destination not present in this API key's snapshot");

const destination = createSupabaseArtifactDestination({
  id: row.id,
  label: row.label,
  config: JSON.parse(row.secret),
});
```

La configuración descifrada contiene `url`, `serviceKey` y `bucket`, además de un `prefix` opcional. La clave de servicio tiene acceso elevado en el proyecto. Usa un bucket privado dedicado a documentos, conserva la clave en memoria y nunca la escribas en el archivo local ni en logs. La URL debe ser la raíz del proyecto con HTTPS; HTTP solo se habilita expresamente para desarrollo en localhost. Los permisos de carga y lectura se verifican mediante operaciones reales, por lo que no se deducen de una consulta que solo comprueba el estado.

## Google Drive

`createGoogleDriveArtifactDestination()` escribe en la carpeta de Facta seleccionada bajo el ámbito `drive.file` de Google. El entorno anfitrión proporciona la renovación del token de acceso o la reautorización del usuario:

```ts
import { createGoogleDriveArtifactDestination } from "@facta-dte/api";

const destination = createGoogleDriveArtifactDestination({
  id: "accounting-drive",
  label: "Accounting Drive",
  config: { accessToken, folderId },
  refreshAccessToken: async () => getFreshGoogleDriveToken(),
});
```

Drive permite nombres duplicados y no ofrece una operación atómica de creación condicional para este modelo de rutas. El adaptador etiqueta los archivos con un digest de ruta privado en `appProperties`, serializa escrituras de la misma ruta dentro de una instancia y revisa todas las coincidencias indexadas durante la recuperación. Si encuentra coincidencias divergentes, informa `unknown` sin reemplazar ningún archivo. Usa un solo proceso escritor por destino de Drive; procesos independientes pueden competir y dejar archivos duplicados. Este adaptador tiene cobertura con mocks, pero aún necesita una prueba de escritura real en Drive.

### Ejecutar la comprobación local autenticada de integración S3

El comando opcional `pnpm test:local-s3-storage` compila el SDK e inicia un servicio S3 temporal de SeaweedFS en Docker con credenciales generadas al azar. Verifica que se rechacen las solicitudes sin firma y luego prueba SigV4 para escribir y leer, reintentar una escritura idéntica y conservar los bytes existentes si una carga distinta apunta al mismo objeto. El servicio solo escucha en loopback y, al terminar, el comando elimina el contenedor y el archivo temporal de credenciales. Docker debe estar disponible. Define `FACTA_TEST_S3_IMAGE` para usar una imagen SeaweedFS local en vez de la imagen predeterminada.

## FTP y SFTP mediante Facta Bridge

El SDK puede escribir a través de `facta-bridge` en el mismo equipo que ejecuta Node o Deno. El vault de destinos contiene la clave de API y el ID de sesión del puente, pero el puerto pertenece al dispositivo y deliberadamente no se sincroniza. Lee el puerto de la configuración local del emparejamiento del puente y combínalo con el secreto descifrado:

```ts
import { createBridgeArtifactDestination } from "@facta-dte/api";

const destination = createBridgeArtifactDestination({
  id: row.id,
  label: row.label,
  config: { ...JSON.parse(row.secret), port: localBridgePort },
});
```

El adaptador solo contacta `127.0.0.1`, se autentica con la clave del puente y usa el contrato `POST /v1/storage` de bridge v1. Nunca obtiene la contraseña del servidor FTP/SFTP. La ruta remota incluye el SHA-256 del artefacto antes del nombre de archivo, por lo que bytes distintos se guardan en una ruta inmutable diferente aunque FTP/SFTP no tengan creación condicional. Los mismos bytes siempre resuelven a la misma ruta y se verifican con una lectura posterior. A diferencia de la comprobación del puente en la aplicación web, el SDK no envía una consulta de estado en segundo plano; solo realiza una lectura o escritura real cuando la integración invoca una operación de almacenamiento.

Este adaptador tiene cobertura simulada en Node y Deno. Para una prueba real hace falta un puente local emparejado con un servidor FTP/SFTP desechable.

## Integridad y resultados ambiguos

Antes de escribir, la función lee el objeto. Si los bytes tienen el SHA-256 esperado, devuelve `stored` sin otra escritura. Si el objeto no existe, escribe los bytes exactos del archivo y vuelve a leerlos antes de devolver `stored`. Nunca reemplaza un objeto existente con contenido distinto: devuelve `unknown` para que un operador lo concilie. Los errores de red o permisos también producen `unknown`, salvo que `isNotFound` identifique un resultado definitivo de objeto ausente. La función nunca registra credenciales, rutas, bytes de artefactos ni mensajes de error.

Clasifica como ausente únicamente la respuesta exacta de “no encontrado” del proveedor:

```ts
const isDefinitiveObjectNotFound = (error: unknown) =>
  error instanceof ProviderError && error.status === 404;
```

No clasifiques un `403` genérico, un timeout, un fallo DNS ni un error del SDK como ausencia. Se espera que el puerto de escritura sea idempotente para bytes idénticos y rutas estables. Si el almacén admite `putIfAbsent`, la función usa creación atómica y vuelve a comprobar el objeto tras un conflicto. Sin esa primitiva, comparar antes de escribir y verificar después no evita una carrera entre escritores independientes; usa la operación condicional del proveedor si hay emisores concurrentes. `InvoiceArchive` guarda cifrado el estado de cada destino y artefacto para permitir su recuperación.

## Diagnóstico de problemas del proveedor

Los errores de los adaptadores de proveedor son errores de almacenamiento, no `FactaError`. Exponen un estado o código del proveedor sin copiar el cuerpo de respuesta, la ruta ni credenciales al diario del SDK. Usa la clase de error pública del adaptador empleado y conserva el ID de operación, ID de destino, tipo de artefacto y SHA-256 para soporte o conciliación.

| Adaptador / síntoma | Qué revisar | Siguiente paso seguro |
|---|---|---|
| S3 `301`, `400`, `403` o `SignatureDoesNotMatch` | Región del bucket, endpoint, estilo de ruta, par de claves de acceso/secreta, reloj del host y permisos `GetObject`/`PutObject` | Corrige la configuración del destino y vuelve a intentar la misma replicación archivada. Un `409`/`412` significa que la clave ya existe o que se perdió una carrera de creación condicional; deja que el SDK lea y compare los bytes. |
| Supabase `401` o `403` | URL HTTPS de raíz del proyecto, clave de servicio, nombre de bucket y política de bucket privado | Corrige credenciales o política en la aplicación, sincroniza el vault de destinos y vuelve a intentar la misma operación de archivo. Un `409` se resuelve leyendo el objeto existente y comprobando su hash. |
| Google Drive `401` después del callback de renovación | El callback puede renovar el token y conservar el estado OAuth actualizado; el token tiene autorización `drive.file` para la carpeta seleccionada | Si falla la renovación, reautoriza desde el entorno dueño de la integración. Un `401` repetido no significa que falte el objeto. Ante `409` o coincidencias duplicadas divergentes, inspecciona los archivos indexados del destino y usa un solo proceso escritor por destino. |
| OneDrive `401` después de renovar | Persistencia del callback de renovación y permiso `Files.ReadWrite.AppFolder` | Renueva o reautoriza desde el entorno responsable y luego concilia. Ante `409`/`412`, el adaptador revisa el elemento de la carpeta de la aplicación y solo considera completa una copia con bytes idénticos. |
| Bridge `unreachable` o `timeout` | El proceso Node/Deno se ejecuta en el dispositivo emparejado, `facta-bridge` está activo y `port` es el puerto local del emparejamiento | Vuelve a emparejar o reinicia el puente y luego invoca de nuevo la replicación con la misma operación y destino. No envíes la solicitud loopback desde un servidor remoto: `127.0.0.1` se refiere a ese servidor. Un `401`/`403` requiere reparar la clave del puente; `404` indica que el objeto indexado no existe. |

Los estados tienen significados distintos: `stored` significa que los bytes coinciden por SHA-256; `unknown` significa que no se pudo demostrar el estado remoto; `failed` significa que el adaptador informó un fallo; `unavailable` significa que el destino configurado ya no está presente. Si el estado es `unknown`, conserva el diario y concilia con `check()` o reintenta la escritura con la misma ruta estable y el mismo hash. Nunca emitas un DTE de reemplazo para corregir un problema de copia de artefactos. Estas comprobaciones no prueban la salud integral del proveedor salvo que se haya realizado una lectura/escritura autenticada real. Las pruebas mock validan el comportamiento del adaptador; la comprobación S3 local autenticada valida SigV4 y la semántica de almacenamiento con SeaweedFS, no con todos los proveedores compatibles con S3.

## Replicar o recuperar

```ts
const result = await facta.issueAndArchive(request, {
  archive,
  operationId: order.id,
  idempotencyKey: order.id,
  remoteDestinations: [destination],
});

if (result.archive.remoteCopies?.some((copy) => copy.state !== "stored")) {
  // Conserva el ID de operación, el archivo y el ID de destino para recuperarlos explícitamente.
  await facta.replicateArchive(order.id, archive, [destination]);
}
```

`replicateArchive()` solo acepta un archivo local completo y verifica el digest de cada artefacto local antes de la primera operación remota. Nunca emite un DTE. Si se cancela una escritura, el elemento actual se marca `unknown` en el diario cifrado, si este sigue disponible para escritura, y el SDK detiene el lote. Usa `check()` o repite más tarde la misma replicación para conciliar; no emitas otra factura. Si falla la persistencia del diario, el resultado se informa como `unknown`, pero `pending()` no puede reflejar ese elemento hasta que vuelva a funcionar. La recuperación consiste en repetir la escritura con la misma ruta estable y el mismo hash.

Para inspeccionar copias existentes sin crear objetos de prueba, usa `diagnoseDestinations(operationId, archive, destinations)`. Lee cada artefacto local disponible e invoca únicamente el método opcional `check()` del adaptador. `stored` confirma que los bytes remotos coinciden; `missing` y `unknown` nunca provocan escrituras. Esto comprueba lectura y conciliación, no el permiso de escritura remota. Usa una emisión archivada real e invoca `replicateArchive()` solo si deseas copiar sus artefactos fiscales.

`createStorageArtifactDestination()` adapta un cliente `put/get` existente. `createS3ArtifactDestination()` y `createSupabaseArtifactDestination()` son proveedores integrados. El paquete también incluye `createOneDriveArtifactDestination()` para la carpeta privada de la aplicación:

```ts
import { createOneDriveArtifactDestination } from "@facta-dte/api";

const destination = createOneDriveArtifactDestination({
  id: "accounting-onedrive",
  label: "Accounting OneDrive",
  accessToken: credentials.accessToken,
  // Conserva el token de renovación en el entorno que administra las credenciales OAuth.
  refreshAccessToken: async () => {
    const renewed = await refreshOneDriveCredentials(credentials.refreshToken);
    await saveCredentials(renewed);
    return renewed.accessToken;
  },
  prefix: "Facta/Invoices",
});
```

El token debe incluir `Files.ReadWrite.AppFolder`. La renovación se delega al callback del entorno, por lo que el SDK nunca escribe credenciales rotadas en un vault de API. Las sesiones de carga usan `conflictBehavior: "fail"`; un reintento a la misma ruta vuelve a leer y verifica SHA-256 antes de informar éxito. La URL de carga está preautenticada y nunca se persiste ni registra. El adaptador tiene cobertura mock para consumidores Node y Deno, pero aún necesita una prueba real con OneDrive.

S3, Supabase Storage, Google Drive, OneDrive y el puente local tienen adaptadores integrados. El almacenamiento administrado por Facta sigue siendo exclusivo de la aplicación: su Worker requiere un token de sesión de usuario Supabase autenticado, y una clave API de Facta no autentica ese servicio. No reenvíes la sesión de una persona desde la aplicación a un proceso integrador. Para admitir el almacenamiento administrado en el SDK se necesita un contrato de capacidad distinto, con alcance de clave API. La renovación de credenciales, las políticas de acceso privado y la validación real con proveedores siguen siendo responsabilidad de las integraciones de ejecución.
