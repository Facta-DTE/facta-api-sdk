# Referencia de métodos del SDK TypeScript

[English version](reference.md) · [README en español](../README.es.md)

# `@facta-dte/api`

[English version](reference.md) · [README en inglés](../README.md)

El único cliente oficial. Node 22 y 24, y también Deno y Bun: `fetch` y `crypto.randomUUID` son los dos únicos globales que toca, y los dos son estándar en todas partes.

## Instalación

**Paquete y código:** [npm `@facta-dte/api`](https://www.npmjs.com/package/@facta-dte/api) · [repositorio público en GitHub](https://github.com/Facta-DTE/facta-api-sdk).

**Selección de versión:** Esta documentación describe `0.3.0`. El [registro de npm](https://www.npmjs.com/package/@facta-dte/api?activeTab=versions) es la autoridad para las versiones publicadas y sus etiquetas. `latest` elige la versión estable aprobada. Confirme que la versión publicada instalada incluye un método antes de usarlo; valide las capacidades que solo estén en el código fuente con una copia empaquetada.

El paquete oficial admite TypeScript y JavaScript. Los SDK de otros lenguajes están pendientes; los ejemplos HTTP directos no representan SDK publicados.

```sh
# Verificar versiones y etiquetas, luego instalar la versión estable aprobada:
npm view @facta-dte/api version dist-tags
pnpm add @facta-dte/api
# Opcional: fijar 0.3.0 después de verificar que está publicada:
pnpm add @facta-dte/api@0.3.0
```

## Configuración

```typescript
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  // Solo hace falta para issue, sign y anular. Consultar no la pide.
  signKey: process.env.FACTA_SIGN_KEY!,
});
```

`FactaOptions`:

| Opción | Tipo | Qué hace |
| --- | --- | --- |
| `apiKey` | texto, requerida | `facta_test_…` o `facta_live_…`. Léala del gestor de secretos, no de un archivo del repositorio. |
| `signKey` | `factask_…`, condicional | Hace falta para issue, sign y anular; no para getDocumentStatus. Guárdela fuera del mismo `.env` que `apiKey`. Si le pasa una `factauk_` por error, el constructor la rechaza por el prefijo. |
| `unlockKey` | `factauk_…`, condicional | Hace falta para abrir localmente los vaults de destinos y catálogo. No viaja en ninguna petición. No la necesita si manda receptor y líneas completas inline, sin `customerId` ni `productId`. |
| `baseUrl` | texto, opcional | Por defecto la URL pública. Una llave `facta_test_` sigue emitiendo en pruebas con esa misma URL. |
| `timeoutMs` | número, opcional, defecto 60000 | Plazo de la petición entera. El Ministerio puede tardar unos cuarenta segundos en contestar. |
| `maxRetries` | número, opcional, defecto 3 | Cuántas veces reintentar las condiciones donde reintentar es seguro. |
| `fetch` | función, opcional | Para inyectarlo en pruebas. |

`CallOptions` — el segundo argumento de los métodos que escriben:

| Opción | Qué hace |
| --- | --- |
| `idempotencyKey` | La suya. Si su sistema ya tiene un identificador para esta venta, páselo: así la operación es idempotente entre reinicios del proceso, no solo entre reintentos de una llamada. Sin ella, el cliente genera una y la reusa en todos los reintentos. |
| `signal` | Un `AbortSignal` para cancelar. Los reintentos se detienen con la misma señal. |

## Modelos y cobertura actual

Los tipos públicos viven en `src/types.ts` y se exportan desde `mod.ts`. Para el SDK, los modelos principales son:

| Modelo | Representa |
| --- | --- |
| `DteRequest` | La petición para `issue`, `prepare` o `sign`. |
| `Recipient` y `Address` | Datos fiscales inline; `customerId` es una referencia opcional al catálogo cifrado de esa llave. |
| `ExportRecipient`, `ExcludedSubjectRecipient` | Datos del receptor específicos para DTE 11 y 14. |
| `RelatedDocument`, `ExportDetails` | Documentos corregidos en notas 05/06 y datos de exportación 11. |
| `LineItem` | Una línea de la venta. `cantidad` siempre se envía; `productId` permite resolver descripción, precio, tipo de artículo y unidad del catálogo cifrado. |
| `IssueResult` | Unión discriminada por `estado`: `SealedDte` o `DteInContingency`. |
| `ManagedStorageStatus`, `ManagedStorageReceipt`, `ManagedDocumentCopy` | Capacidad v1 y estados/digests de copias JSON/PDF administradas. No contienen rutas de objetos ni enlaces. |
| `PreparedDte`, `DocumentStatus`, `InvalidationResult`, `DtePage`, `HoldingPage` | Resultados de prepare, getDocumentStatus, anular, listar y recuperar documentos. |
| `Status`, `RateLimitWindow`, `Totals`, `FactaError` | Estado de llave, límites, importes calculados por el servidor y errores tipados. |

`DteType` y `DteRequest` cubren los seis tipos que admite el API (`01`, `03`, `05`, `06`, `11`, `14`). La solicitud es una unión discriminada: al elegir `tipoDte: "11"`, TypeScript exige el receptor extranjero y el bloque `exportacion`; para `05` y `06` exige al menos un documento relacionado. Los tipos ayudan a construir el payload, pero el API sigue siendo la autoridad de validación fiscal. Consulte el [contrato OpenAPI](/api/v1/issue/) para restricciones completas.

El catálogo no es requisito para issue. Si no guarda clientes con Facta, mande los datos inline en `receptor`; el SDK los pasa a la API y no crea ni actualiza una ficha. Una FE (`01`) puede omitir `receptor` si es consumidor final. Un CCF (`03`) requiere `nombre`, NIT, NRC, actividad, dirección y correo, aunque el cliente no exista en el catálogo.

El producto debe tener un `item_type` válido y la base de su precio debe
coincidir con el documento: IVA incluido para FE (`01`), excluido para CCF y
los demás tipos gravados. Si no coincide, resuelva la línea con un `precioUni`
inline en la base que espera ese DTE, o corrija `vat_included` en el catálogo.
El SDK no convierte IVA; el cálculo fiscal permanece en el servidor. En FSE
(`14`) el precio se conserva sin conversión.

Ejemplo de nota de crédito sobre un documento electrónico de la misma empresa:

```typescript title="Nota de crédito (05)"
const nota = await facta.issue({
  tipoDte: "05",
  documentosRelacionados: [{ codigoGeneracion: facturaOriginal.codigoGeneracion }],
  items: [{ descripcion: "Devolución parcial", cantidad: 1, precioUni: 25 }],
});
```

Una nota de débito (`06`) usa la misma forma para relacionar el documento; es
el único tipo que admite `numPagoElectronico`:

```typescript title="Nota de débito (06)"
const debito = await facta.issue({
  tipoDte: "06",
  documentosRelacionados: [{ codigoGeneracion: facturaOriginal.codigoGeneracion }],
  numPagoElectronico: "TRF-99120",
  items: [{ descripcion: "Cargo adicional acordado", cantidad: 1, precioUni: 5 }],
});
```

Para un documento que no esté en el índice de la empresa, envíe los cuatro
campos del documento relacionado (`tipoDocumento`, `numeroDocumento`,
`fechaEmision` y, si es papel, `tipoGeneracion: 1`). En notas con más de un
documento, asigne `numeroDocumento` también a cada línea.

Ejemplo mínimo de exportación y de factura a sujeto excluido. Los datos aquí
son ilustrativos; Hacienda determina la aceptación fiscal final.

```typescript title="Exportación (11)"
const exportacion = await facta.issue({
  tipoDte: "11",
  receptor: {
    nombre: "Example Imports LLC",
    numDocumento: "EIN-123456",
    codPais: "US",
    nombrePais: "Estados Unidos",
    complemento: "100 Market Street, Miami, FL",
    tipoPersona: 2,
    descActividad: "Importación de productos",
    correo: "billing@example.com",
  },
  exportacion: { tipoItemExpor: 1 },
  items: [{ descripcion: "Producto de muestra", cantidad: 2, precioUni: 40 }],
});
```

```typescript title="Sujeto excluido (14)"
const compra = await facta.issue({
  tipoDte: "14",
  receptor: {
    nombre: "Proveedor independiente",
    numDocumento: "061234567",
    direccion: {
      departamento: "06",
      municipio: "20",
      complemento: "San Miguel",
    },
  },
  aplicarReteRenta: false,
  items: [{ descripcion: "Servicio profesional", cantidad: 1, precioUni: 100 }],
});
```

```typescript title="Emisión sin customerId ni cliente guardado"
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

Este ejemplo no usa `unlockKey` porque no consulta referencias del catálogo. Sí necesita la `signKey` para sign. Para una FE anónima, omita `receptor`; para una FE identificada, envíe en `receptor` los campos que quiera incluir.

## Métodos del cliente

### `status()`

**No manda la llave de firma.** Devuelve `Status`.

Lo primero que conviene llamar. Confirma que la llave sirve, dice para qué empresa emite, en qué ambiente, si puede sign y cuánto cupo le queda. Cuando existe registro público del certificado asociado, también incluye su huella, NIT y vigencia; nunca entrega la llave privada ni el contenido del vault. No exige ningún alcance.

```typescript
const estado = await facta.status();

console.log(estado.ambiente);              // "00" en pruebas, "01" en producción
console.log(estado.llave.alcances);        // ["issue", "query", "download"]
console.log(estado.limites.hora?.remaining);
```

### `diagnose(options?)`

Revisa la disponibilidad de la API, el emisor, el alcance para el tipo de DTE,
las revisiones de firma/destinos/catálogo y los datos públicos del certificado
cuando están registrados. Puede recibir `{ dteType, archive }` para comprobar
el tipo de DTE y el archivo local. No abre vaults ni reserva un correlativo.
También consulta la capacidad de almacenamiento administrado. Si el servidor
es anterior o falta el alcance, esa capacidad queda desconocida y no se reporta
como copia durable. Devuelve `storageReady` (`true`, `false` o `null`),
`canIssue`, `canQuery`, `canDownload`, `canIssueAndArchive`, las
comprobaciones y el conteo de operaciones pendientes del archivo; ese conteo
es `null` si no se pasó archivo o no se pudo leer su journal. Si falla la
consulta de estado, devuelve un informe bloqueado con el código seguro del
error.

```typescript
const informe = await facta.diagnose({ dteType: "03", archive });
if (!informe.canIssueAndArchive) {
  throw new Error(informe.checks.map((item) => item.message).join("; "));
}
```

### Clientes y productos sincronizados

El SDK descifra el snapshot en el proceso del integrador. Los métodos de
búsqueda filtran localmente los registros autorizados a esa llave; no exponen
un endpoint de escritura ni crean clientes/productos. Cada llamada compara la
revisión publicada con la revisión local y vuelve a sincronizar si cambió.
Requieren `unlockKey`.

```typescript
const cliente = await facta.getCustomer("cliente-id");
const clientes = await facta.searchCustomers("Comercial Ejemplo", { limit: 20 });
const productos = await facta.searchProducts("cafe");
const todoElCatalogoActivo = await facta.listProducts();
```

| Método | Resultado y comportamiento |
| --- | --- |
| `listCustomers(options?)` | Devuelve los clientes del snapshot autorizado; `allowStale` es opt-in. |
| `getCustomer(id, options?)` | Busca por ID y devuelve `null` si no existe en el snapshot. |
| `searchCustomers(query, options?)` | Busca nombre, documento, NRC y correo; límite 1–500, 50 por defecto. |
| `listProducts(options?)` | Devuelve productos activos; `includeInactive` los incluye todos. |
| `getProduct(id, options?)` | Devuelve `null` si no existe o está inactivo. |
| `searchProducts(query, options?)` | Busca descripción, código y código de barras de productos activos; límite 1–500, 50 por defecto. |

Las búsquedas ignoran mayúsculas y acentos, y solo consultan los campos
descargados en el snapshot local.

### `syncDestinations()`, `syncCatalog()` y `catalogState()`

El dueño sincroniza los destinos y el catálogo desde la aplicación web. El SDK
usa `unlockKey` para abrir las envolturas localmente en el proceso integrador;
la contraseña no se envía a Facta. `syncDestinations()` devuelve la
configuración descifrada en memoria y no sube facturas a esos destinos.
`syncCatalog()` reemplaza la copia local por el snapshot publicado más
reciente. Ambos fallan si falta `unlockKey` o la revisión que necesitan aún
no se publicó desde la aplicación. Un error criptográfico con una clave
incorrecta puede venir de Web Crypto; no es una respuesta de la API.

`catalogState()` compara la revisión local con el estado público y devuelve
`missing`, `fresh` o `stale`, las revisiones disponibles y un código de error
seguro; nunca devuelve datos de clientes o productos. Las llamadas de lectura
se actualizan al detectar una revisión nueva. `allowStale: true` sirve solo
para búsquedas y lecturas informativas cuando no se puede getDocumentStatus el estado;
el SDK nunca resuelve referencias fiscales con un snapshot viejo.

```typescript
const { destinos } = await facta.syncDestinations();
const { customers, products } = await facta.syncCatalog();
const estadoCatalogo = await facta.catalogState();
```

El paquete tiene adaptadores de archivo para S3/S3-compatible, Supabase
Storage, OneDrive, Google Drive y el bridge local FTP/SFTP. Son adaptadores
que usa el integrador desde su propio proceso. Facta-managed Storage sigue
siendo exclusivo de la aplicación web: su Worker exige un token de sesión de
usuario Supabase y no acepta `X-Facta-Key`. No reenvíe la sesión del usuario a
un proceso integrador. Para ofrecer ese destino desde el SDK hace falta un
contrato de capacidad de almacenamiento con alcance de llave API. El destino
FTP/SFTP necesita el bridge emparejado en el mismo equipo que corre Node o
Deno. Las credenciales descifradas permanecen en memoria y las renovaciones
OAuth pertenecen al runtime integrador.

### `issue(request, options?)`

**Manda la llave de firma.** Devuelve `SealedDte | DteInContingency`.

Prepara, firma y transmite en una sola operación. Es el camino normal. Devuelve una unión: `estado === "sellado"` trae `selloRecibido` y `totales`; `estado === "contingencia"` no, porque todavía no hay veredicto — y el tipo lo obliga. Errores propios: `mh_rejected`, `validation_failed`, `no_storage_destination`, `amount_limit`.

```typescript
import { Facta, FactaError } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  unlockKey: process.env.FACTA_UNLOCK_KEY!,
});

try {
  const dte = await facta.issue(
    {
      tipoDte: "03",
      receptor: { customerId: "374114b6-e957-4c7a-8911-dd6381b1e0ea" },
      items: [{ descripcion: "Integración de la API", cantidad: 1, precioUni: 25 }],
    },
    { idempotencyKey: "venta-2026-09-02-00417" },
  );

  console.log(dte.estado, dte.numeroControl);
  if (dte.estado === "sellado") console.log(dte.selloRecibido, dte.totales.totalPagar);
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    console.error("rechazado:", error.message, "· gastó:", error.spent?.numeroControl);
  } else throw error;
}
```

### `issueAndArchive(request, options)`

Emite y conserva una copia cifrada recuperable. Requiere un `InvoiceArchive`,
un `operationId` estable y un `idempotencyKey` estable. El SDK comprueba que el
archivo pueda escribir antes de pedir un correlativo y conserva los bytes
exactos del JSON firmado y del PDF devueltos por el servidor, sin volver a
solicitarlos. Deriva el JWS del JSON y solo descarga el ticket opcional. Las
respuestas antiguas de la API que no incluyan esos archivos usan la descarga
como compatibilidad. El guardado posterior puede fallar aunque Hacienda ya haya aceptado la factura: revise
`result.archive.state` y `result.archive.detail` por separado del resultado
fiscal.

El paquete incluye `FileInvoiceArchive` en `@facta-dte/api/file-archive` para Node
22+ y Deno 2. Configure su frase de cifrado como un secreto independiente de
`FACTA_UNLOCK_KEY`; deje un solo proceso escribiendo en cada directorio local.
En otros runtimes puede implementar `InvoiceArchive` con almacenamiento
transaccional.

```typescript
import { FileInvoiceArchive } from "@facta-dte/api/file-archive";

const archive = await FileInvoiceArchive.open({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!,
});
const archivada = await facta.issueAndArchive(solicitud, {
  archive,
  operationId: order.id,
  idempotencyKey: order.id,
  ticketPaperWidthMm: 80,
});
```

`remoteDestinations` puede replicar cada artefacto durante el flujo. Las copias
remotas tienen su propio estado por destino y tipo de archivo; una falla de
réplica nunca vuelve a issue el DTE.

### `recoverOperation(operationId, options?)`

Recupera una operación del journal después de un reinicio. Pase el mismo ID,
la solicitud original y el archivo que guardó el journal. Reutiliza la misma
clave de idempotencia; si ya conoce el código de generación, consulta el DTE y
descarga los bytes que falten. Si la emisión quedó sin confirmar y el plazo
conservador venció, se detiene para reconciliar en vez de enviar una emisión
nueva. También puede volver a intentar copias remotas pendientes.

Antes de recuperar, compara la identidad guardada (endpoint, ID público de la
llave, NIT emisor y ambiente) con `/v1/status`. Si cambia alguno, o el journal
antiguo no conserva esa identidad, la recuperación automática se detiene. Los
artefactos guardados se verifican y reutilizan; solo se descargan los que
faltan y nunca se reemplazan con versiones regeneradas.

### `replicateArchive(operationId, archive, destinations, options?)`

Envía los bytes ya archivados a los adaptadores remotos que proporciona el
runtime. Verifica sus hashes antes de la primera escritura y registra cada
resultado en el journal cifrado. Para un estado `unknown`, conserve el mismo
ID de operación y reconcilie con el `check()` del adaptador o vuelva a correr
la replicación idempotente. Este método nunca emite un DTE.

### `prepare(request, options?)`

**No manda la llave de firma.** Devuelve `PreparedDte`.

Reserva el correlativo y devuelve el documento canónico con sus totales, sin firma. Para quien quiere ver el documento antes de firmarlo. **Reserva el número**, así que un `prepare` sin su `sign` deja un correlativo entregado, y eso es un hueco que alguien tiene que explicar. Por eso el `prepareToken` vence a los 15 minutos.

```typescript
const preparado = await facta.prepare({
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 1.5 }],
});

console.log(preparado.totales.totalPagar);   // ya calculado por el servidor
console.log(preparado.numeroControl);        // el número ya está reservado
```

### `sign(prepared, options?)`

**Manda la llave de firma.** Devuelve `SealedDte | DteInContingency`.

Firma y transmite exactamente lo que devolvió `prepare`. Pase el documento **sin tocar un centavo**: el servidor comprueba un MAC sobre su hash canónico, y un cambio se rechaza con `prepare_token_invalid` en vez de firmarse.

```typescript
const dte = await facta.sign(preparado);
```

### `deliverEmail`, `deliverWhatsApp`, `getDelivery` y `waitForDelivery`

La entrega por correo y por WhatsApp la hace la API, nunca el SDK, y **nunca
bloquea la emisión**: `issue` solo marca los canales y devuelve un token de
entrega; cada canal es una petición aparte.

```typescript
const dte = await facta.issue(venta, {
  idempotencyKey: "venta-1042",
  deliver: { email: true, whatsapp: { number: "+50370000000", consent: true } },
});
if (dte.estado === "sellado" && dte.entrega?.token) {
  await facta.deliverEmail(dte.codigoGeneracion, dte.entrega.token);
  await facta.deliverWhatsApp(dte.codigoGeneracion, dte.entrega.token);
  const final = await facta.waitForDelivery(dte.codigoGeneracion);
  console.log(final.settled, final.canales);
}
```

* `deliver.email`: `true` usa `receptor.correo`; un texto lo reemplaza solo para
  la entrega. `deliver.whatsapp.consent: true` es **su** declaración de que el
  receptor aceptó recibir documentos por WhatsApp; el SDK lo exige.
* El token dura 5 minutos desde la emisión. Un documento en contingencia no
  trae token (`esperando_sello`).
* Un canal que no se puede entregar es un **estado**, no una excepción:
  `fallido`, `sin_credito`, `sin_consentimiento`, `no_permitido`, `vencido`,
  con `motivo` (`smtp_rejected`, `invalid_address`, `wallet_empty`,
  `provider_unavailable`, `quota_exceeded`). Un 202 (`en_proceso`) tampoco es
  error. Solo el vencimiento lanza `FactaError`: `entrega_vencida` (410),
  `entrega_token_invalido` o `canal_no_marcado`. El token se oculta en los
  mensajes de error.
* `waitForDelivery(codigoGeneracion, { channels?, timeoutMs = 60000, intervalMs = 2000, signal? })`
  devuelve `settled: false` al agotar el tiempo en vez de lanzar.
* `isDeliveryLimitReason(motivo)` (exportada de la raíz y de `/browser`) es
  `true` para `quota_exceeded` y `provider_unavailable`: se alcanzó el límite
  de envíos o el proveedor no respondió. El documento ya está emitido; trátelo
  como un aviso, ofrezca el PDF o el JSON y reintente más tarde. Ni `issue` ni
  `waitForDelivery` lanzan por estos motivos.

### `getDocumentStatus(generationCode)`

**No manda la llave de firma.** Devuelve `DocumentStatus`.

Un documento por su código de generación, en el estado en que esté. **Contesta también por los rechazados**, que no tienen fila de índice pero sí reserva: devolver 404 para un número que Hacienda negó mandaría a buscar un error que no existe.

```typescript
const uno = await facta.getDocumentStatus("7875BC7A-9580-441D-94E4-FA455E9D8BD0");
console.log(uno.estado);   // "rechazado", "sellado", "contingencia"…
```

### `listDocuments(filters?)`

**No manda la llave de firma.** Devuelve `DtePage`.

El libro de lo sellado, del más nuevo al más viejo, con filtros por fecha, estado y tipo. **La paginación es por cursor, no por página**: `?pagina=2` sobre una tabla que crece repite un documento y se salta otro. Un documento **rechazado no está aquí**. Si al reconciliar aparece un hueco en su numeración, pregunte por ese código con `getDocumentStatus`. Cada fila puede incluir el nombre y número de documento del receptor. En modo privado, la API abre esos campos para la llave autorizada: el cifrado en reposo no los oculta a la integración. Trata la respuesta como dato personal y evita copiarla a logs generales.

```typescript
let cursor: string | null = null;

do {
  const pagina = await facta.listDocuments({
    desde: "2026-09-01",
    hasta: "2026-09-30",
    estado: "sellado",
    limit: 100,
    ...(cursor ? { cursor } : {}),
  });

  for (const fila of pagina.documentos) {
    console.log(fila.numeroControl, fila.totales?.totalPagar);
  }
  cursor = pagina.siguiente;
} while (cursor !== null);
```

### `invalidate(generationCode, request, options?)`

**Manda la llave de firma.** Devuelve `InvalidationResult`.

Anula un documento que Hacienda ya selló. **No es un borrado**: es un evento, con su propio documento firmado, su propio código y su propio sello. No hay forma de deshacerla. Los tres tipos no son intercambiables: el `1` (error en el documento) y el `3` (otro) exigen `motivo` y `codigoGeneracionReemplazo` —emita primero el documento correcto—; el `2` (rescisión) prohíbe nombrar reemplazo. Pedir la anulación de algo ya anulado contesta 200 con `yaEstabaInvalidado: true`.

```typescript
const generationCode = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const anulado = await facta.invalidate(generationCode, {
  tipoAnulacion: 1,
  motivo: "El precio unitario iba sin el descuento pactado",
  codigoGeneracionReemplazo: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  responsable: { nombre: "Ana Rivas", tipoDocumento: "36", numDocumento: "06142803901121" },
  solicita: { nombre: "Beto Cruz", tipoDocumento: "13", numDocumento: "012345678" },
});

if (anulado.yaEstabaInvalidado) console.log("ya estaba anulado; no se mandó nada");
```

### `registerReturn(generationCode, request, options?)`

**Manda la llave de firma.** Devuelve `ReturnResult`.

Registra el evento de retorno de una factura (01), de exportación (11) o de sujeto excluido (14) que Hacienda ya selló y que esta API emitió. Es un evento aparte, con su propio código y su propio sello; **no gasta correlativo** y, una vez sellado, no se deshace. Se pueden registrar varias sobre el mismo documento hasta sumar lo que se vendió: `disponible`, en la respuesta y en `getDocumentStatus()`, dice cuánto queda de cada línea. Las líneas se cuentan **desde 1**, como en la factura impresa, y cada item lleva `cantidad` (unidades) o `noGravado` (cargo o abono que no afecta la base), una sola.

```typescript
const retorno = await facta.registerReturn(codigoGeneracion, {
  items: [{ linea: 1, cantidad: 1 }],
}, { idempotencyKey: "devolucion-1042-a" });

if (retorno.estado === "firmado") {
  // Hacienda no contestó (HTTP 202). Repita la llamada con la MISMA
  // idempotencyKey y el mismo cuerpo: se reenvía el mismo evento firmado.
  console.warn(retorno.detalle);
} else {
  console.log(retorno.selloRecibido, retorno.disponible);
}
```

Los rechazos llegan como `FactaError` con un código: `return_exceeds_available` (en `details.lineas`, cada línea con lo `solicitado` y lo `disponible`), `return_window_closed` y `return_type_not_allowed`. Anular un documento que ya tiene eventos de retorno contesta `has_return_events` (409). El JSON del evento se descarga con su propio código: `downloadDocument(retorno.codigoGeneracion, "json")`; la hoja carta viene en `representacionGrafica` (base64) y también se descarga con `downloadDocument(retorno.codigoGeneracion, "pdf")`.

### `invalidateAndArchive(generationCode, request, options)`

Envía una anulación y guarda su evento en el journal cifrado de
`FileInvoiceArchive`, separado de los artefactos de la factura original.
Persiste la solicitud y la clave de idempotencia antes de llamar a la API. La
llave de firma es necesaria en el primer envío o en una recuperación segura;
use la misma `operationId` y `idempotencyKey` para reanudar una operación.

```typescript
const generationCode = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const invalidacion = await facta.invalidateAndArchive(generationCode, {
  tipoAnulacion: 1,
  motivo: "El precio unitario iba sin el descuento pactado",
  codigoGeneracionReemplazo: codigoGeneracionReemplazo,
  responsable: { nombre: "Ana Rivas", tipoDocumento: "36", numDocumento: "06142803901121" },
  solicita: { nombre: "Beto Cruz", tipoDocumento: "13", numDocumento: "012345678" },
}, {
  archive,
  operationId: cancellation.id,
  idempotencyKey: cancellation.id,
});

if (invalidacion.archive.state === "needs_attention") {
  console.error("la anulación pudo completarse; revise el journal antes de reintentar");
}
```

### `recoverInvalidation(operationId, archive?, signal?)` y `listPendingInvalidations(archive?)`

`recoverInvalidation()` usa la solicitud y la clave guardadas.
`listPendingInvalidations()` devuelve resúmenes sin exponer la solicitud ni el
JWS. El SDK conserva el JWS exacto dentro del journal cifrado y verifica su
hash al leerlo. La recuperación solo vuelve a enviar la misma solicitud durante
una ventana conservadora de 23 horas. Si ya pasó esa ventana o la API responde
que el DTE ya estaba anulado sin entregar el JWS del evento,
`recoverInvalidation()` lanza `operation_outcome_unknown`; concilie el estado
fiscal antes de volver a actuar.

### `downloadDocument(generationCode, kind?, options?)`

**No manda la llave de firma.** Devuelve `DownloadedDocument`.

Devuelve los bytes exactos de `json`, `pdf` o `ticket`, sin parsearlos ni volver a serializarlos. El tipo predeterminado es `json`; exige el alcance `download`. **El JSON es el Archivo DTE por defecto** (documento + `firmaElectronica` + `selloRecibido`) y `jsonFormat` informa `archivo-dte` o `raw` según `X-Facta-Json-Format`; `raw: true` (solo JSON) devuelve el original guardado `{codigoGeneracion, ambiente, jws}`. Un documento sin sello (contingencia) contesta `409 not_sealed`; repita con `raw: true`. Un resultado sellado trae además `archivoDte`, y `archivoDteOf(resultado)` lo arma con `documento`, `jws` y `selloRecibido` cuando la API aún no lo envía. `storageSource` informa `managed`, `holding` o `archive` si el servidor identifica el origen. El ticket se genera desde un DTE ya sellado y admite `paperWidthMm` entero de 40 a 120 (80 por defecto), sin issue de nuevo. Esta regeneración está disponible para DTE emitidos por la API, no para los que se emitieron desde la app web. El área de retención dura una hora desde la firma, pero **pasada esa hora la ruta sigue contestando**: el documento se rearma desde la reserva, que guarda el JWS sellado.

```typescript
const archivo = await facta.downloadDocument(dte.codigoGeneracion, "json");

await writeFile(archivo.filename ?? `${dte.codigoGeneracion}.json`, archivo.bytes);
console.log(archivo.contentType);   // "application/json"
```

### `print(document, transport, options?)`

**No manda una solicitud a la API ni confirma una impresión física.** Entrega los bytes de un PDF de carta o ticket al transporte que proporciona la aplicación integradora y devuelve su estado (`submitted` o `unknown`). No reintenta trabajos con resultado incierto.

El SDK acepta documentos `pdf` o `ticket`; el JSON legal no se puede enviar a una impresora como PDF. La impresora, su descubrimiento, el spooler y la reconciliación de trabajos inciertos son responsabilidad del adaptador del integrador. Para tickets se conserva el ancho del documento descargado (80 mm por defecto, o el ancho pedido al descargarlo).

```typescript
const ticket = await facta.downloadDocument(dte.codigoGeneracion, "ticket", {
  paperWidthMm: 58,
});
const result = await facta.print(ticket, printerTransport);

if (result.state === "unknown") {
  // Concilia con la impresora o cola antes de pedirle al usuario que vuelva a intentarlo.
}
```

### `listHolding(limit?)`

**No manda la llave de firma.** Devuelve `HoldingPage`.

Qué hay en su área de retención ahora mismo. Evidencia de estado —dónde aterrizó, intentos, cuándo vence, cuántas veces se descargó—, nunca rutas de bucket ni contenido.

```typescript
const pagina = await facta.listHolding(50);

for (const fila of pagina.documentos) {
  console.log(fila.codigoGeneracion, fila.whereLanded, fila.expiresAt);
}
```

### `getContract()`

**No manda la llave de firma.** Devuelve el contrato OpenAPI.

El contrato que publica la propia API. El endpoint público no requiere una llave; si llama a `getContract()` desde una instancia `Facta`, el cliente adjunta su `apiKey` como en las demás peticiones.

```typescript
const contrato = await facta.getContract();
console.log(contrato.info?.version);
```

## `FactaError`

Los errores HTTP de Facta y de red se representan como `FactaError`; sus
códigos son la interfaz estable para decidir cómo continuar. También pueden
ocurrir errores locales de JavaScript/Web Crypto al validar opciones, abrir un
vault o usar el archivo. Los adaptadores de proveedores tienen sus propias
clases de error. No convierta todo `catch` en una decisión sobre `FactaError`:
compruebe el tipo y vuelva a lanzar lo que su integración no reconozca.

| Propiedad | Tipo | Qué es |
| --- | --- | --- |
| `code` | `FactaErrorCode` | Código estable del servidor o uno de los códigos locales descritos abajo. |
| `status` | número | El HTTP. `0` cuando el fallo ocurrió antes de salir. |
| `message` | texto | Español, para el humano que lee el registro. **Puede reescribirse**: un cliente que haga `switch` sobre el mensaje se rompe con una corrección de ortografía. |
| `details` | desconocido | Depende del código. `validation_failed` trae `issues`; `rate_limited`, la ventana y los segundos. |
| `isRejection` | sí/no | «Hacienda leyó el documento y lo negó», frente a «no llegamos a Hacienda». Es la diferencia que decide qué hacer después. |
| `spent` | objeto o `null` | El correlativo que este fallo ya gastó, cuando lo hay. El §167 permite corregir con ese mismo número. |
| `mhObservations` | lista de texto | Lo que dijo Hacienda, palabra por palabra, cuando rechazó. |

Estos códigos son propios del SDK y nunca aparecen en la tabla HTTP de la API:

| Código local | Significado y siguiente paso |
| --- | --- |
| `network_error` | La petición no recibió respuesta; reintente solo con la misma clave de idempotencia. |
| `operation_outcome_unknown` | No se pudo recuperar el evento de anulación de forma segura; concilie el estado fiscal antes de operar de nuevo. |
| `archive_integrity_error` | El journal cifrado no pasó la verificación de identidad o hash; conserve una copia y revise antes de repararlo. |

```typescript
import { FactaError } from "@facta-dte/api";

try {
  await facta.issue(venta);
} catch (error) {
  if (!(error instanceof FactaError)) throw error;

  switch (error.code) {
    case "mh_rejected":
      console.error(error.spent?.numeroControl, error.mhObservations);
      break;
    case "no_storage_destination":
      break;
    case "validation_failed":
      console.error(error.details);
      break;
    default:
      throw error;
  }
}
```

El SDK elimina los campos de credenciales de `error.details`, redacta las
llaves configuradas si aparecen en texto y usa un mensaje genérico para fallos
de red. Aun así, trate cualquier dato de error como información operativa y
no registre solicitudes o documentos completos.

## Reintentos y contingencia

El cliente reintenta **solo donde reintentar es seguro**, con espera creciente: `idempotency_in_flight` (la primera petición sigue trabajando), `service_unavailable`, `correlative_unavailable`, `mh_unreachable` y `network_error`. Nunca en un 4xx y **nunca en un rechazo**.

La `Idempotency-Key` se acuña **una vez, fuera del bucle**. Generar una nueva por intento es exactamente el error que esa cabecera existe para evitar: quemaría un segundo correlativo.

Y un `202` no es un error, así que no pasa por aquí: llega como un resultado con `estado: "contingencia"`. Lo cuenta entera la guía [Contingencia y resultados inciertos](/guias/contingencia-y-resultados-inciertos/).

## Tipos

Los tipos se leen del contrato TypeScript (`mod.ts`), no de un `.d.ts` generado. Los que se usan a diario:

- `DteRequest`, `LineItem`, `Recipient` — lo que se manda.
- `IssueResult = SealedDte | DteInContingency` — la unión que obliga a mirar el `estado` antes de leer `totales`.
- `PreparedDte`, `DocumentStatus`, `InvalidationResult`, `DtePage`, `HoldingPage`.
- `ManagedStorageStatus`, `ManagedStorageReceipt`, `ManagedDocumentCopy` — capacidad y copias administradas JSON/PDF, sin rutas ni enlaces.
- `Status`, `RateLimitWindow` — lo que devuelve `status()`.
- `FactaError`, `FactaErrorCode`, `SpentCorrelative`.

## Lo que este cliente no hace

1. **No calcula dinero.** Ni IVA, ni retenciones, ni totales, ni el número de control, ni fechas fiscales. Todo eso lo produce el servidor y el cliente lo transporta. Un SDK que calcule dinero es un segundo motor fiscal, y dos motores se desincronizan el primer martes.
2. **No firma.** El certificado no pasa por aquí en ningún momento. Lo que sí pasa, en las rutas que firman, es `X-Facta-Sign-Key`: la contraseña que abre el vault *en el servidor*. El cliente la reenvía y no hace nada con ella.
3. **No abre las credenciales de su almacenamiento administrado.** Facta guarda JSON/PDF de forma administrada en el servidor cuando el contrato API-key-scoped está disponible. `FileInvoiceArchive` conserva una copia cifrada local y los adaptadores BYOS replican bytes a proveedores del integrador. Sus estados son independientes; el SDK no recibe secretos R2. La impresora y el envío por WhatsApp requieren transportes separados.

Una prueba de arquitectura del propio paquete falla si alguna de las dos primeras deja de ser cierta.

Una respuesta fiscal exitosa puede incluir `storageErrorCode: "storage_contract_invalid"`
si el recibo de almacenamiento es inválido o no coincide con los bytes exactos
recibidos. Se omite ese recibo y se conserva el éxito fiscal. El archivo cifrado
mantiene la condición pendiente hasta obtener un recibo válido por reparación.
Facta listo satisface el destino duradero sin una bóveda BYOS; la firma y las
referencias del catálogo conservan sus comprobaciones. Una capacidad presente
pero inválida bloquea `diagnose()`; las rutas anteriores ausentes quedan como desconocidas.
