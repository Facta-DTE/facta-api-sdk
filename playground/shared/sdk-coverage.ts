// The SDK coverage list: ONE module that says, for every public export of `@facta-dte/api`, where the playground
// shows it working and where the documentation explains it.
//
// Marvin, 7-Oct-2026: «Lo que quiero es que cuando alguien quiere implementar algo, lo encuentre ahí, todo. Que no
// haya cosas del SDK que no estén y que haya que adivinar.»
//
// Two things use this file:
//   * the «Referencia del SDK» page (site/sections/referencia/) draws each entry as a card;
//   * `test/sdk-coverage.test.ts` enumerates the real surface of the package with the TypeScript compiler
//     (`test/sdk-surface.ts`) and FAILS when an export, a client method, an option, an error code or a handler
//     action is not covered by an entry, so the list cannot go stale when the SDK grows.
//
// A pattern in `covers` is a key with `*` wildcards. Key forms:
//   mod:Name  server:Name  browser:Name  react:Name  node:Name  file-archive:Name   (`*:Name` = any entry point)
//   Facta#member            a public method, getter or property of the client
//   FactaOptions.prop       a property of an option bag (FactaOptions, FactaConfigV1, FactaRuntimeConfigV1,
//                           CallOptions, IssueOptions, DownloadOptions, DebugOptions, FactaEmergencyApi, FactaHandlerOptions,
//                           CreateFactaSessionInput, CreateFactaInvalidationSessionInput, FactaClientOptions,
//                           IssueFlowOptions, UseFactaIssueOptions, FactaCapabilities)
//   error:code              a FactaErrorCode
//   action:name             an action of the server handler
// Every pattern must match something, and every key must be matched by at least one entry.
//
// Nothing here is secret and nothing imports the SDK or the site, so both the Worker tests and the page can read it.

export type GroupId =
  | "cliente" | "emitir" | "consultar" | "descargar" | "entrega" | "anular" | "retorno" | "catalogo"
  | "almacenamiento" | "emergencia" | "region" | "diagnostico" | "errores" | "servidor" | "navegador" | "react";

export interface Group {
  id: GroupId;
  label: string;
  blurb: string;
}

export const GROUPS: readonly Group[] = [
  { id: "cliente", label: "Cliente y opciones", blurb: "Crear el cliente, sus opciones y las de cada llamada." },
  { id: "emitir", label: "Emitir", blurb: "Emitir un DTE, en una llamada o en dos, y hacerlo de forma segura ante reintentos." },
  { id: "consultar", label: "Consultar", blurb: "Leer el estado de un documento y listar los que ya existen." },
  { id: "descargar", label: "Descargar", blurb: "El JSON, el PDF, el ticket y el Archivo DTE que recibe su cliente." },
  { id: "entrega", label: "Entrega", blurb: "Enviar el documento por correo o WhatsApp y seguir el estado de cada canal." },
  { id: "anular", label: "Anular", blurb: "Invalidar un documento sellado, y lo que hay que hacer si no se sabe si se anuló." },
  { id: "retorno", label: "Retorno", blurb: "Devolver unidades de una factura con el Evento de Retorno." },
  { id: "catalogo", label: "Catálogo", blurb: "Clientes y productos: leerlos, referirlos al emitir y, desde el SDK, administrarlos." },
  { id: "almacenamiento", label: "Almacenamiento y copias", blurb: "Copias administradas por Facta DTE y copias en almacenamiento propio." },
  { id: "emergencia", label: "Emergencia", blurb: "La función suya que guarda el documento cuando Facta DTE no pudo." },
  { id: "region", label: "Región, tiempos y reloj", blurb: "Dónde corre la API, cuánto tarda cada paso y el reloj de referencia." },
  { id: "diagnostico", label: "Diagnóstico", blurb: "Saber si una llave está lista para trabajar antes de la primera venta." },
  { id: "errores", label: "Errores", blurb: "Todos los códigos de error del SDK, cuáles se reintentan y qué hacer." },
  { id: "servidor", label: "Servidor", blurb: "@facta-dte/api/server: sesiones por venta y el manejador que guarda sus llaves." },
  { id: "navegador", label: "Navegador", blurb: "@facta-dte/api/browser: el flujo de emisión sin React, mensajes, formato y apariencia." },
  { id: "react", label: "React", blurb: "@facta-dte/api/react: ventanas, recibo, documentos, selectores y estado del servicio." },
];

/** Where a capability can be seen working. */
export type Demo =
  /** A server recipe that runs for real on staging: `/servidor?receta=<id>`. */
  | { kind: "recipe"; recipe: string; note?: string }
  /** A page of the playground that runs it live (a React screen or a headless example). */
  | { kind: "page"; path: string; label: string; note?: string }
  /** A recipe that runs a SIMULATION (a playground-only fake trigger, never real storage). */
  | { kind: "simulated"; recipe: string; note: string }
  /** The SDK has it, the playground does not run it, and says why. */
  | { kind: "documented"; reason: string };

/** The code shown on the card: the very file the playground runs, or an illustrative snippet. */
export type CodeRef =
  | { kind: "file"; path: string }
  | { kind: "snippet"; label: string; text: string };

export interface CoverageEntry {
  id: string;
  group: GroupId;
  /** The capability in plain words. */
  title: string;
  /** One paragraph, es-SV, usted. */
  summary: string;
  covers: string[];
  demo: Demo;
  code: CodeRef;
  /** Guide stems in `guides/` (see `GUIDES`). */
  guides: string[];
  /** Repository files that implement it. */
  sources: string[];
  /** Pages of sdk.factadte.com that explain it, when there is one. */
  portal?: string[];
}

/** The guides of the package. `es: false` guides exist in English only. */
export const GUIDES: Readonly<Record<string, { title: string; es: boolean }>> = {
  reference: { title: "Referencia de métodos", es: true },
  node: { title: "Integración con Node.js", es: true },
  deno: { title: "Integración con Deno", es: true },
  catalog: { title: "Catálogo y copias sin conexión", es: true },
  "catalog-write": { title: "Crear, editar y desactivar clientes y productos", es: true },
  "storage-adapters": { title: "Adaptadores de almacenamiento", es: true },
  emergency: { title: "Salvaguarda de emergencia", es: true },
  react: { title: "Pantallas de React", es: false },
  "react-server": { title: "Servidor de las pantallas de React", es: false },
  "archivo-dte": { title: "El Archivo DTE y el JSON original", es: true },
  region: { title: "Región de la API", es: true },
  timings: { title: "Tiempos por paso", es: true },
  delivery: { title: "Entrega por correo y WhatsApp", es: true },
  idempotency: { title: "Idempotencia y reintentos", es: true },
  "prepare-sign": { title: "Preparar y firmar por separado", es: true },
  "return-event": { title: "Evento de Retorno", es: true },
  "reference-clock": { title: "El reloj de referencia", es: true },
  diagnose: { title: "Diagnóstico", es: true },
  errors: { title: "Catálogo de errores", es: true },
  browser: { title: "El cliente de navegador", es: true },
};

const WRITE_REASON = "Disponible en el SDK; el playground no modifica el catálogo.";

export const COVERAGE: readonly CoverageEntry[] = [
  // ---------------------------------------------------------------- Cliente y opciones
  {
    id: "client",
    group: "cliente",
    title: "Crear el cliente: new Facta(options)",
    summary: "Un solo objeto concentra todas las llamadas. Recibe la llave de la API (apiKey, que fija el ambiente: facta_test_ es pruebas y facta_live_ es producción), la llave de firma solo para emitir y anular (signKey), la llave de desbloqueo para leer catálogos cifrados (unlockKey) y la dirección de la API. config guarda el comportamiento que no es secreto (ambiente esperado, alcances requeridos, plazos, reintentos) y runtime las piezas que usted aporta (archivo local, destinos, impresora, función de emergencia). Las llaves salen de su gestor de secretos, nunca de un archivo del repositorio.",
    covers: [
      "mod:Facta", "mod:FactaOptions", "mod:FactaConfigV1", "mod:FactaRuntimeConfigV1",
      "FactaOptions.apiKey", "FactaOptions.signKey", "FactaOptions.unlockKey", "FactaOptions.baseUrl", "FactaOptions.timeoutMs",
      "FactaOptions.maxRetries", "FactaOptions.fetch", "FactaOptions.config", "FactaOptions.runtime",
      "FactaConfigV1.*", "FactaRuntimeConfigV1.version",
    ],
    demo: { kind: "recipe", recipe: "service-info", note: "Cada receta crea su cliente con las llaves del Worker; esta muestra lo que el cliente sabe de su llave." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · el cliente con su configuración",
      text: `import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,    // facta_test_… (pruebas) o facta_live_… (producción)
  signKey: process.env.FACTA_SIGN_KEY!,  // solo para emitir y anular
  config: {
    version: 1,
    expectedEnvironment: "00",           // diagnose() avisa si la llave es de otro ambiente
    requiredScopes: ["issue", "query", "download"],
    timeoutMs: 60_000,
    maxRetries: 3,
  },
});`,
    },
    guides: ["reference", "node", "deno"],
    sources: ["src/client.ts", "src/config-validation.ts"],
    portal: ["/sdk/typescript/"],
  },
  {
    id: "call-options",
    group: "cliente",
    title: "Opciones de cada llamada: idempotencyKey, signal, debug",
    summary: "Los métodos que escriben reciben un segundo argumento. idempotencyKey es la identidad de la venta: use el número de su pedido y la operación será segura incluso si su proceso se reinicia. signal cancela la llamada y sus reintentos. debug pide a la API sus tiempos por paso. En emitir, deliver marca el correo o el WhatsApp del cliente. DownloadOptions agrega raw, source y paperWidthMm a las descargas.",
    covers: [
      "mod:CallOptions", "mod:IssueOptions", "CallOptions.*", "IssueOptions.*", "DownloadOptions.*",
    ],
    demo: { kind: "recipe", recipe: "issue-idempotent" },
    code: { kind: "file", path: "playground/server/recipes/issue-idempotent.ts" },
    guides: ["reference", "idempotency"],
    sources: ["src/client.ts"],
    portal: ["/guias/idempotencia-y-reintentos/"],
  },
  {
    id: "environment",
    group: "cliente",
    title: "Ambiente y estado: environment, status() y getContract()",
    summary: "facta.environment sale del prefijo de la llave y no hace ninguna llamada: \"00\" es pruebas y \"01\" es producción. status() es la comprobación de salud: dice si la API responde, qué alcances y tipos de documento tiene su llave, cómo llega al catálogo y cuánto cupo le queda; no cuenta contra el límite de la llave. getContract() devuelve el documento OpenAPI que publica el servidor, que es la autoridad sobre cada campo HTTP.",
    covers: [
      "Facta#environment", "Facta#status", "Facta#getContract",
      "mod:Status", "mod:RateLimitWindow", "mod:SyncState", "mod:SyncRevision", "mod:ApiSyncStatus",
      "action:service.status", "action:status", "action:storage.status",
    ],
    demo: { kind: "recipe", recipe: "service-info" },
    code: { kind: "file", path: "playground/server/recipes/service-info.ts" },
    guides: ["reference"],
    sources: ["src/client.ts", "src/types.ts"],
    portal: ["/api/v1/estado/", "/api/v1/contrato/"],
  },

  // ---------------------------------------------------------------- Emitir
  {
    id: "issue",
    group: "emitir",
    title: "Emitir un DTE: issue(request)",
    summary: "Describe la venta (quién, qué y cuánto) y el servidor hace todo lo fiscal: correlativo, totales, IVA, monto en letras, firma y transmisión a Hacienda. La respuesta es el documento sellado (con archivoDte, el PDF en base64 y los totales) o, si Hacienda no contestó, un documento en contingencia con su plazo. Cubre Factura (01), Crédito fiscal (03), notas de crédito y débito (05, 06), Exportación (11) y Sujeto excluido (14). El cliente nunca calcula dinero y nunca firma.",
    covers: [
      "Facta#issue", "mod:DteRequest", "mod:DteType", "mod:Recipient", "mod:ExportRecipient", "mod:ExcludedSubjectRecipient",
      "mod:Address", "mod:LineItem", "mod:RelatedDocument", "mod:ExportDetails", "mod:SealedDte", "mod:DteInContingency",
      "mod:IssueResult", "mod:Totals", "action:session.describe", "action:issue",
    ],
    demo: { kind: "recipe", recipe: "issue-idempotent" },
    code: { kind: "file", path: "playground/server/recipes/issue-idempotent.ts" },
    guides: ["reference", "node", "idempotency"],
    sources: ["src/client.ts", "src/types.ts"],
    portal: ["/guias/emitir/", "/api/v1/emitir/"],
  },
  {
    id: "prepare-sign",
    group: "emitir",
    title: "Preparar, revisar y firmar: prepare() y sign()",
    summary: "Dos llamadas en lugar de una. prepare() reserva el correlativo y devuelve el documento canónico sin firmar para que usted lo revise (o lo apruebe otra persona); sign() lo firma sin cambiarlo. Un documento editado entre las dos se rechaza con prepare_token_invalid. prepare no usa la llave de firma; sign sí.",
    covers: ["Facta#prepare", "Facta#sign", "mod:PreparedDte", "error:prepare_token_invalid"],
    demo: { kind: "recipe", recipe: "prepare-sign" },
    code: { kind: "file", path: "playground/server/recipes/prepare-sign.ts" },
    guides: ["prepare-sign", "reference"],
    sources: ["src/client.ts"],
    portal: ["/guias/preparar-y-firmar/", "/api/v1/preparar/", "/api/v1/firmar/"],
  },
  {
    id: "idempotency",
    group: "emitir",
    title: "Idempotencia y reintentos: una llave, un documento",
    summary: "La llave identifica la venta, no el clic. Repetir la misma solicitud con la misma llave devuelve el documento original en vez de emitir otro; si la primera llamada sigue en curso el API contesta idempotency_in_flight y se reintenta. Después de una respuesta incierta no se emite con una llave nueva: se repite con la misma y se consulta el documento por su código.",
    covers: ["error:idempotency_key_required", "error:idempotency_key_reuse", "error:idempotency_in_flight"],
    demo: { kind: "recipe", recipe: "status-recovery" },
    code: { kind: "file", path: "playground/server/recipes/status-recovery.ts" },
    guides: ["idempotency", "reference"],
    sources: ["src/client.ts", "src/errors.ts"],
    portal: ["/guias/idempotencia-y-reintentos/", "/guias/contingencia-y-resultados-inciertos/"],
  },
  {
    id: "order-webhook",
    group: "emitir",
    title: "Un pedido entra, un documento sale (webhook)",
    summary: "El patrón más común de un comercio: su tienda manda un pedido en JSON a su servidor, el servidor lo convierte en la solicitud fiscal y emite. El número de pedido es la llave de idempotencia, así que entregar el mismo pedido dos veces emite una sola factura.",
    covers: [],
    demo: { kind: "recipe", recipe: "order-webhook" },
    code: { kind: "file", path: "playground/server/recipes/order-webhook.ts" },
    guides: ["idempotency", "node"],
    sources: ["src/client.ts"],
  },
  {
    id: "issue-and-archive",
    group: "almacenamiento",
    title: "Emitir y conservar copia propia: issueAndArchive() y recuperación",
    summary: "issueAndArchive emite y, además, guarda el JSON, el PDF y la firma en un archivo que usted controla, y los replica a los destinos que usted configuró. Si el proceso se cae a medio camino, recoverOperation termina lo pendiente y listPendingOperations lo enumera; replicateArchive reintenta las copias. Un éxito fiscal nunca se convierte en error por una falla de copia: el resultado trae archive.state y advertencias.",
    covers: [
      "Facta#issueAndArchive", "Facta#recoverOperation", "Facta#listPendingOperations", "Facta#replicateArchive",
      "mod:FactaArchiveEmissionOptions", "mod:ArchiveEmissionOptions", "mod:ArchiveEmissionResult", "mod:ArchiveOperation",
      "mod:ArchiveOperationIdentity", "mod:ArchiveWarning", "mod:PendingArchiveOperation", "mod:RemoteReplicationReport",
    ],
    demo: { kind: "documented", reason: "Escribe en un archivo local cifrado y en almacenamiento de su propiedad. El playground corre en un Worker sin disco y no guarda destinos ni credenciales de nadie." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · emitir y archivar con recuperación (Node)",
      text: `import { Facta, FileInvoiceArchive } from "@facta-dte/api/node";

const archive = new FileInvoiceArchive({ directory: "./archivo-facturas", passphrase: process.env.ARCHIVE_PASSPHRASE! });
const facta = new Facta({ apiKey, signKey, unlockKey, runtime: { version: 1, archive } });

const out = await facta.issueAndArchive(request, { operationId: "pedido-1042", idempotencyKey: "pedido-1042" });
if (out.archive.state !== "complete") console.warn(out.archive); // el documento ya está sellado

// Al arrancar el proceso: terminar lo que quedó a medias.
for (const pending of await facta.listPendingOperations()) await facta.recoverOperation(pending.operationId);`,
    },
    guides: ["storage-adapters", "node", "reference"],
    sources: ["src/client.ts", "src/archive.ts", "src/byos-copies.ts"],
  },

  // ---------------------------------------------------------------- Consultar
  {
    id: "document-status",
    group: "consultar",
    title: "Estado de un documento: getDocumentStatus(code)",
    summary: "Busca un documento por su código de generación y contesta también por los rechazados, no solo por los sellados. Es la pieza de recuperación: después de una respuesta incierta, repetir con la misma llave y consultar por código dice qué pasó. Para un documento con retornos incluye el saldo disponible de cada línea.",
    covers: ["Facta#getDocumentStatus", "mod:DocumentStatus", "action:documents.get"],
    demo: { kind: "recipe", recipe: "status-recovery" },
    code: { kind: "file", path: "playground/server/recipes/status-recovery.ts" },
    guides: ["reference", "idempotency"],
    sources: ["src/client.ts"],
    portal: ["/api/v1/consultar/"],
  },
  {
    id: "list-documents",
    group: "consultar",
    title: "Listar documentos con cursor: listDocuments(filters)",
    summary: "Devuelve una página de documentos con el cursor (siguiente) de la que sigue. Filtra por tipo, fechas y estado. El receptor aparece con los datos mínimos; los rechazados se consultan por su código. En el playground la lista se limita a los documentos que usted emitió porque la llave es compartida.",
    covers: ["Facta#listDocuments", "mod:ListDocumentsFilters", "mod:ListedDte", "mod:DtePage", "action:documents.list"],
    demo: { kind: "recipe", recipe: "documents-storage" },
    code: { kind: "file", path: "playground/server/recipes/documents-storage.ts" },
    guides: ["reference"],
    sources: ["src/client.ts"],
    portal: ["/guias/consultar-y-listar/", "/api/v1/listar/"],
  },
  {
    id: "holding",
    group: "consultar",
    title: "El área de retención: listHolding()",
    summary: "Enumera los documentos que Facta DTE retiene temporalmente (unos 60 minutos) mientras los escribe en almacenamiento duradero, sin descargar sus bytes. Sirve para auditar que nada se quedó sin copia.",
    covers: ["Facta#listHolding", "mod:HoldingPage", "mod:RetainedDocument", "action:documents.holding"],
    demo: { kind: "documented", reason: "Lista lo retenido de TODA la llave, incluidos los documentos de otros visitantes del playground. El Worker cierra la acción documents.holding y no la expone en ninguna receta." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · auditar el área de retención",
      text: `const page = await facta.listHolding(50);
for (const doc of page.documentos) {
  console.log(doc.codigoGeneracion, doc.whereLanded, doc.expiresAt);
}`,
    },
    guides: ["reference", "emergency"],
    sources: ["src/client.ts"],
    portal: ["/api/v1/retencion/"],
  },

  // ---------------------------------------------------------------- Descargar
  {
    id: "download",
    group: "descargar",
    title: "Descargar archivos: downloadDocument(code, kind)",
    summary: "Baja el JSON, el PDF (hoja carta) o el ticket de un documento sin emitir de nuevo. El JSON es el Archivo DTE por defecto; el ticket se regenera al ancho de su rollo (paperWidthMm, de 40 a 120 mm). Con source: \"managed\" se exige la copia administrada y con raw: true el original almacenado. Devuelve bytes (Uint8Array) listos para escribir a disco o enviar al usuario.",
    covers: ["Facta#downloadDocument", "mod:DownloadedDocument", "server:FactaDownloadKind", "action:documents.download", "*:DownloadKind", "browser:DownloadedFile"],
    demo: { kind: "recipe", recipe: "documents-storage" },
    code: { kind: "file", path: "playground/server/recipes/documents-storage.ts" },
    guides: ["reference", "archivo-dte"],
    sources: ["src/client.ts"],
    portal: ["/guias/descargar-archivos/"],
  },
  {
    id: "archivo-dte",
    group: "descargar",
    title: "El Archivo DTE y el JSON original: archivoDte, archivoDteOf y raw",
    summary: "El Archivo DTE es lo que espera quien recibe el documento: el documento firmado más firmaElectronica (el JWS, byte por byte) y selloRecibido. La respuesta de emitir lo trae en archivoDte y downloadDocument lo devuelve por defecto. El original almacenado ({ codigoGeneracion, ambiente, jws }) se pide con raw: true y es el único JSON de un documento en contingencia, que todavía no tiene sello. archivoDteOf reconstruye el mismo texto a partir del JWS y el sello, para comprobarlo.",
    covers: ["mod:archivoDteOf", "mod:ArchivoDteSource", "*:archivoDteOf", "*:ArchivoDteSource", "error:not_sealed", "FactaCapabilities.rawJson"],
    demo: { kind: "recipe", recipe: "archivo-dte" },
    code: { kind: "file", path: "playground/server/recipes/archivo-dte.ts" },
    guides: ["archivo-dte", "reference"],
    sources: ["src/archivo-dte.ts", "src/client.ts"],
    portal: ["/guias/descargar-archivos/"],
  },
  {
    id: "print",
    group: "descargar",
    title: "Imprimir: print(document) y submitPrintJob",
    summary: "Envía un PDF ya descargado, una sola vez, a la impresora que usted conecte. El SDK no trae controlador: usted aporta un transporte (PrintTransport) que habla con su impresora o con su servicio de impresión, y el SDK controla que cada trabajo se envíe una vez y devuelve su estado.",
    covers: [
      "Facta#print", "mod:submitPrintJob", "mod:PrintJob", "mod:PrintJobState", "mod:PrintResult", "mod:PrintTransport",
      "mod:PrintTransportResponse", "FactaRuntimeConfigV1.printTransport",
    ],
    demo: { kind: "documented", reason: "Necesita una impresora conectada a su red o un servicio de impresión propio. Un Worker de Cloudflare no puede alcanzar ninguna." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · descargar el PDF y mandarlo a imprimir",
      text: `const pdf = await facta.downloadDocument(code, "pdf");
const result = await facta.print(pdf, {
  async submit(job) {
    // Hable con su impresora o con su servicio de impresión.
    const response = await fetch("http://impresora.local/jobs", { method: "POST", body: job.bytes });
    return { accepted: response.ok, reference: response.headers.get("x-job-id") };
  },
});
console.log(result.state);`,
    },
    guides: ["reference", "node"],
    sources: ["src/printing.ts", "src/client.ts"],
  },

  // ---------------------------------------------------------------- Entrega
  {
    id: "delivery",
    group: "entrega",
    title: "Entregar por correo: deliver, deliverEmail, getDelivery y waitForDelivery",
    summary: "Emitir marca los canales con deliver y no espera: la respuesta trae un token de entrega (entrega.token) que vale cinco minutos. deliverEmail lo usa para pedir el envío, getDelivery lee el estado de cada canal en cualquier momento y waitForDelivery lo sondea hasta que todos son finales. Un canal que no puede entregar es un estado (fallido, sin_credito, vencido…), nunca una excepción. El token existe para que nadie use el API como relevo de correo con documentos que no emitió.",
    covers: [
      "Facta#deliverEmail", "Facta#getDelivery", "Facta#waitForDelivery",
      "mod:DeliverOptions", "mod:DeliveryChannel", "mod:DeliveryChannelResult", "mod:DeliveryChannelState", "mod:DeliveryChannelStatus",
      "mod:DeliveryChannels", "mod:DeliveryOffer", "mod:DeliveryReason", "mod:DeliveryRequest", "mod:DeliveryStatus",
      "mod:WaitForDeliveryOptions", "mod:WaitedDelivery", "*:DELIVERY_LIMIT_REASONS", "*:isDeliveryLimitReason",
      "error:entrega_vencida", "error:entrega_token_invalido", "error:canal_no_marcado",
      "react:DeliveryRows", "*:DeliveryView",
    ],
    demo: { kind: "recipe", recipe: "deliver-email" },
    code: { kind: "file", path: "playground/server/recipes/deliver-email.ts" },
    guides: ["delivery", "reference"],
    sources: ["src/client.ts", "src/delivery.ts", "docs/api-delivery-tokens.md"],
  },
  {
    id: "delivery-status",
    group: "entrega",
    title: "Leer el estado de la entrega: getDelivery(code)",
    summary: "A diferencia del token, que vence a los cinco minutos, el estado de cada canal se puede leer siempre. Devuelve cada canal con su estado, el destino enmascarado (m•••@ejemplo.com), el motivo estable y la hora del último cambio.",
    covers: [],
    demo: { kind: "recipe", recipe: "delivery-status" },
    code: { kind: "file", path: "playground/server/recipes/delivery-status.ts" },
    guides: ["delivery"],
    sources: ["src/client.ts"],
  },
  {
    id: "delivery-whatsapp",
    group: "entrega",
    title: "Entregar por WhatsApp: deliverWhatsApp()",
    summary: "Igual que el correo, con su propio canal: se marca con deliver: { whatsapp: { number, consent: true } } (consent es la declaración suya de que el cliente aceptó), se inicia con el mismo token de cinco minutos y su estado se lee con getDelivery. Depende de un saldo de WhatsApp prepagado en la cuenta; sin saldo el canal queda en sin_credito.",
    covers: ["Facta#deliverWhatsApp"],
    demo: { kind: "documented", reason: "El playground nunca pide un envío por WhatsApp: cuesta saldo prepagado y sus mensajes son a números reales. El Worker rechaza cualquier solicitud que lo mencione y la pantalla de entrega lo muestra apagado." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · marcar WhatsApp al emitir y pedir el envío",
      text: `const result = await facta.issue(request, {
  idempotencyKey: "pedido-1042",
  deliver: { whatsapp: { number: "70001234", consent: true } },
});
const token = result.entrega?.token;
if (token) await facta.deliverWhatsApp(result.codigoGeneracion, token);`,
    },
    guides: ["delivery"],
    sources: ["src/client.ts"],
  },

  // ---------------------------------------------------------------- Anular
  {
    id: "invalidate",
    group: "anular",
    title: "Anular un documento sellado: invalidate(code, request)",
    summary: "Invalida un documento con un evento firmado y sellado por Hacienda. Pide el tipo de anulación (1 error en la información, que exige el código del documento de reemplazo; 2 rescindir la operación; 3 otro, que exige motivo) y quién responsable y quién solicita, con su tipo y número de documento. Repetir la llamada sobre un documento ya anulado contesta igual. Un documento con retornos sellados ya no se puede anular (has_return_events).",
    covers: [
      "Facta#invalidate", "mod:InvalidationRequest", "mod:InvalidationPerson", "mod:InvalidationResult", "mod:CompleteInvalidationResult",
      "mod:AlreadyInvalidatedResult", "action:invalidate", "action:invalidate.describe", "error:has_return_events",
    ],
    demo: { kind: "recipe", recipe: "invalidate" },
    code: { kind: "file", path: "playground/server/recipes/invalidate.ts" },
    guides: ["reference", "idempotency"],
    sources: ["src/client.ts"],
    portal: ["/guias/anular/", "/api/v1/anular/"],
  },
  {
    id: "invalidate-and-archive",
    group: "anular",
    title: "Anular con copia propia y recuperación: invalidateAndArchive()",
    summary: "La anulación es irreversible, así que el SDK la protege con un diario: invalidateAndArchive guarda la intención antes de llamar y, si el proceso se cae a medias, recoverInvalidation averigua si el evento se completó y listPendingInvalidations enumera lo pendiente. Si no se puede recuperar el evento firmado, el resultado es operation_outcome_unknown: hay que inspeccionar, no emitir un reemplazo.",
    covers: [
      "Facta#invalidateAndArchive", "Facta#recoverInvalidation", "Facta#listPendingInvalidations", "Facta#invalidationArchiveConfigured",
      "mod:FactaInvalidationArchiveOptions", "mod:InvalidationArchive", "mod:InvalidationArchiveResult", "mod:InvalidationOperation",
      "FactaRuntimeConfigV1.invalidationArchive", "error:operation_outcome_unknown", "error:archive_integrity_error",
    ],
    demo: { kind: "documented", reason: "Necesita un archivo de anulaciones local (un diario en disco) que el Worker no tiene. La anulación en sí sí corre en el playground, por la receta «Anular»." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · anular con diario y recuperar al arrancar",
      text: `const out = await facta.invalidateAndArchive(code, request, {
  operationId: "anular-1042",
  idempotencyKey: "anular-1042",
});
if (out.archive.state === "needs_attention") console.warn(out.archive.detail);

// Al arrancar: averiguar qué pasó con lo que quedó a medias.
for (const pending of await facta.listPendingInvalidations()) await facta.recoverInvalidation(pending.operationId);`,
    },
    guides: ["reference", "node", "errors"],
    sources: ["src/client.ts", "src/archive.ts"],
  },

  // ---------------------------------------------------------------- Retorno
  {
    id: "return-event",
    group: "retorno",
    title: "Evento de Retorno: registerReturn(code, request)",
    summary: "Devuelve unidades de las líneas de una Factura (01), Exportación (11) o Sujeto excluido (14) sellada que este API emitió. No gasta correlativo ni anula nada: es un evento con su propio documento, código y sello, firmado con el certificado del emisor. Se pueden registrar varios sobre un mismo documento hasta sumar lo vendido; disponible dice cuánto queda de cada línea. Cada línea se cuenta desde 1 y lleva cantidad o noGravado. Si Hacienda no contesta, el evento queda firmado (202) y se reintenta con la misma llave.",
    covers: [
      "Facta#registerReturn", "mod:ReturnItem", "mod:ReturnRequest", "mod:ReturnAvailability", "mod:ReturnTotals", "mod:ReturnSealed",
      "mod:ReturnPending", "mod:ReturnResult", "mod:ReturnSummary",
      "error:return_exceeds_available", "error:return_window_closed", "error:return_type_not_allowed", "error:return_pdf_unavailable",
    ],
    demo: { kind: "recipe", recipe: "register-return", note: "Corre contra el servicio de pruebas de Hacienda. Un retorno sellado impide anular ese documento." },
    code: { kind: "file", path: "playground/server/recipes/register-return.ts" },
    guides: ["return-event", "errors"],
    sources: ["src/client.ts", "src/types.ts"],
  },

  // ---------------------------------------------------------------- Catálogo
  {
    id: "catalog-read",
    group: "catalogo",
    title: "Leer clientes y productos: list, get y search",
    summary: "listCustomers, getCustomer y searchCustomers (y sus equivalentes de productos) leen el catálogo según como su llave llegue a él: cifrado (se descifra la copia de la llave con unlockKey), legible o plano (se lee por la API, sin unlockKey). Al emitir, un receptor { customerId } o una línea { productId } se resuelven solos, en el servidor o en el SDK. includeInactive trae también los desactivados.",
    covers: [
      "Facta#listCustomers", "Facta#getCustomer", "Facta#searchCustomers", "Facta#listProducts", "Facta#getProduct", "Facta#searchProducts",
      "mod:CatalogReadOptions", "mod:CatalogSearchOptions", "mod:CatalogCustomer", "mod:CatalogProduct", "mod:CatalogMode",
      "action:catalog.customers.search", "action:catalog.customers.get", "action:catalog.products.search", "action:catalog.products.get",
    ],
    demo: { kind: "recipe", recipe: "catalog-refs", note: "Necesita la llave de desbloqueo en el Worker." },
    code: { kind: "file", path: "playground/server/recipes/catalog-refs.ts" },
    guides: ["catalog", "reference"],
    sources: ["src/client.ts", "src/catalog.ts"],
  },
  {
    id: "catalog-state",
    group: "catalogo",
    title: "Estado del catálogo: catalogState() y syncCatalog()",
    summary: "catalogState() dice cómo llega la llave al catálogo (encrypted, readable, plain) y si la copia local está al día (fresh), atrasada (stale) o ausente (missing); no lanza excepciones: una falla se reporta en statusError. syncCatalog() descarga y descifra la copia de la llave; las lecturas la llaman cuando hace falta.",
    covers: ["Facta#catalogState", "Facta#syncCatalog", "mod:CatalogState", "mod:CatalogSnapshot", "FactaConfigV1.allowStaleCatalogReads"],
    demo: { kind: "recipe", recipe: "diagnose", note: "La receta de diagnóstico incluye catalogState()." },
    code: { kind: "file", path: "playground/server/recipes/diagnose.ts" },
    guides: ["catalog", "diagnose"],
    sources: ["src/client.ts", "src/catalog.ts"],
  },
  {
    id: "catalog-write-customers",
    group: "catalogo",
    title: "Administrar clientes: createCustomer, updateCustomer y deactivateCustomer",
    summary: "El SDK puede crear, editar y desactivar clientes por la API (no hay borrado: desactivar conserva el historial). Requiere tres cosas: que la empresa pase su catálogo a texto plano, que active «Permitir administrar clientes y productos desde el API» en Cuenta → API y una llave con el alcance catalog:write. Implicación de privacidad: con el catálogo en texto plano, Facta DTE puede leer los datos de sus clientes, por eso es una decisión explícita de la empresa. Los campos se validan en el SDK con las mismas reglas del servidor (DUI de 9 dígitos, NIT de 14) y un rechazo es validation_failed con details.issues.",
    covers: [
      "Facta#createCustomer", "Facta#updateCustomer", "Facta#deactivateCustomer", "mod:CustomerInput", "mod:CatalogWriteOptions",
      "server:CATALOG_WRITE_ACTIONS", "action:catalog.customers.create", "action:catalog.customers.update", "action:catalog.customers.deactivate",
      "error:catalog_write_disabled", "error:catalog_encrypted", "FactaCapabilities.catalog",
    ],
    demo: { kind: "documented", reason: WRITE_REASON + " El Worker lo impide: responde 403 a cualquier acción catalog.*.create/update/deactivate y su cliente rechaza los seis métodos de escritura." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · alta, cambio y baja de un cliente (no corre en el playground)",
      text: `const customer = await facta.createCustomer(
  { name: "Comercial Demo, S.A. de C.V.", doc_type: "36", doc_number: "06140101991014", nrc: "987654" },
  { idempotencyKey: "alta-cliente-77" },
);
await facta.updateCustomer(customer.id, { email: "facturas@comercial-demo.example" });
await facta.deactivateCustomer(customer.id); // no se borra: queda inactivo`,
    },
    guides: ["catalog-write", "catalog"],
    sources: ["src/catalog-write.ts", "src/client.ts", "src/server/capabilities.ts"],
  },
  {
    id: "catalog-write-products",
    group: "catalogo",
    title: "Administrar productos: createProduct, updateProduct y deactivateProduct",
    summary: "Igual que los clientes, para el catálogo de productos y servicios. El tipo (item_type: bien o servicio) es obligatorio y nunca se rellena por usted, porque decide el tratamiento del impuesto. Mismos requisitos: catálogo en texto plano, la casilla de Cuenta → API y el alcance catalog:write.",
    covers: [
      "Facta#createProduct", "Facta#updateProduct", "Facta#deactivateProduct", "mod:ProductInput",
      "action:catalog.products.create", "action:catalog.products.update", "action:catalog.products.deactivate",
    ],
    demo: { kind: "documented", reason: WRITE_REASON + " Mismo cerco del Worker que para los clientes." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · alta y cambio de un producto (no corre en el playground)",
      text: `const product = await facta.createProduct(
  { description: "Café de altura, bolsa de 1 lb", unit_price: 8.5, vat_included: true, item_type: 1 },
  { idempotencyKey: "alta-producto-12" },
);
await facta.updateProduct(product.id, { unit_price: 9 });
await facta.deactivateProduct(product.id);`,
    },
    guides: ["catalog-write", "catalog"],
    sources: ["src/catalog-write.ts", "src/client.ts"],
  },

  // ---------------------------------------------------------------- Almacenamiento y copias
  {
    id: "managed-storage",
    group: "almacenamiento",
    title: "Copias administradas por Facta DTE: getStorageStatus, getDocumentCopies y retryDocumentStorage",
    summary: "Si su plan incluye almacenamiento administrado, cada documento se guarda también en un bucket de Facta DTE. getStorageStatus dice si está listo y cuánto espacio queda; getDocumentCopies dice, documento por documento, si el JSON y el PDF quedaron guardados, pendientes o fallidos; retryDocumentStorage repite el intento de un documento cuyas copias fallaron.",
    covers: [
      "Facta#getStorageStatus", "Facta#getDocumentCopies", "Facta#retryDocumentStorage", "mod:Managed*", "FactaCapabilities.storage",
      "FactaCapabilities.retryStorage", "action:documents.copies", "action:documents.retryStorage", "error:no_storage_destination",
      "error:storage_unsupported", "error:storage_unavailable", "error:storage_contract_invalid",
    ],
    demo: { kind: "recipe", recipe: "documents-storage", note: "Lee el estado y las copias; el reintento no se ejecuta aquí para no tocar el almacenamiento de la llave." },
    code: { kind: "file", path: "playground/server/recipes/documents-storage.ts" },
    guides: ["storage-adapters", "reference"],
    sources: ["src/client.ts"],
    portal: ["/guias/almacenamiento-y-retencion/"],
  },
  {
    id: "sync-destinations",
    group: "almacenamiento",
    title: "Sus destinos de la cuenta: syncDestinations()",
    summary: "Descarga, con la llave de desbloqueo, la lista de destinos de almacenamiento que el dueño de la cuenta conectó en Facta DTE (S3, Drive, OneDrive, Supabase…), para que issueAndArchive y la replicación escriban en ellos con las credenciales cifradas de la cuenta.",
    covers: ["Facta#syncDestinations", "mod:DestinationSnapshot"],
    demo: { kind: "documented", reason: "Devuelve los destinos del dueño de la llave con sus credenciales. Exponerlo en una página pública no tiene sentido ni es seguro; el playground no lo ejecuta." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · leer los destinos de la cuenta",
      text: `const facta = new Facta({ apiKey, unlockKey });
const snapshot = await facta.syncDestinations();
console.log(snapshot.destinos.map((d) => \`\${d.kind} · \${d.label}\`));`,
    },
    guides: ["storage-adapters"],
    sources: ["src/client.ts"],
  },
  {
    id: "storage-adapters",
    group: "almacenamiento",
    title: "Destinos propios: S3, Supabase, OneDrive, Google Drive, puente local y adaptador genérico",
    summary: "Cada fábrica create…ArtifactDestination construye un destino al que el SDK escribe el JSON y el PDF de cada documento, lo verifica y avisa a Facta DTE de la copia. createStorageArtifactDestination adapta cualquier almacén suyo con tres funciones (ArtifactStore). diagnoseDestinations prueba cada destino sin escribir documentos. runtime.remoteDestinations y replicate controlan cuáles se usan.",
    covers: [
      "Facta#diagnoseDestinations", "mod:create*ArtifactDestination", "mod:*ArtifactDestinationOptions", "mod:*ArtifactStoreConfig",
      "mod:ArtifactStore", "mod:StorageArtifactDestinationOptions", "mod:BridgeArtifactStoreError", "mod:LocalBridgeArtifactConfig",
      "mod:S3ClockSource", "mod:RemoteArtifactDestination", "mod:RemoteCopyRecord", "mod:RemoteCopyState", "mod:RemoteDestinationProbe*",
      "mod:ArchiveArtifact", "FactaRuntimeConfigV1.remoteDestinations", "FactaRuntimeConfigV1.replicate",
    ],
    demo: { kind: "documented", reason: "Escriben en almacenamiento de su propiedad con credenciales suyas. El playground no recibe credenciales de nadie ni guarda destinos." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · un destino S3 propio",
      text: `import { createS3ArtifactDestination } from "@facta-dte/api";

const destination = createS3ArtifactDestination({
  id: "mi-bucket",
  config: { endpoint, bucket, region, accessKeyId, secretAccessKey },
  clock: facta.clock ?? false, // el reloj de referencia firma las subidas
});
const facta = new Facta({ apiKey, signKey, runtime: { version: 1, remoteDestinations: [destination] } });`,
    },
    guides: ["storage-adapters", "node"],
    sources: ["src/s3-artifact-destination.ts", "src/supabase-artifact-destination.ts", "src/onedrive-artifact-destination.ts", "src/gdrive-artifact-destination.ts", "src/bridge-artifact-destination.ts", "src/storage-adapter.ts"],
  },
  {
    id: "file-archive",
    group: "almacenamiento",
    title: "Archivo local cifrado (Node): FileInvoiceArchive y createFactaFromConfigFile",
    summary: "FileInvoiceArchive guarda en disco, cifrados y con permisos restrictivos, los bytes exactos del JSON, el PDF y la firma de cada documento, junto con el diario que permite recuperar operaciones a medias. createFactaFromConfigFile arma el cliente desde un archivo de configuración sin credenciales y las lee del entorno. Solo corre en Node.",
    covers: [
      "node:*", "file-archive:*", "Facta#archiveConfigured", "mod:InvoiceArchive", "FactaRuntimeConfigV1.archive",
    ],
    demo: { kind: "documented", reason: "Necesita un sistema de archivos y las funciones de Node (node:fs). El Worker no tiene disco." },
    code: {
      kind: "snippet",
      label: "Ilustrativo · cliente desde un archivo de configuración (Node)",
      text: `import { createFactaFromConfigFile } from "@facta-dte/api/node";

// facta.config.json: { "version": 1, "baseUrl": "…", "archive": { "directory": "./archivo" } }
const facta = await createFactaFromConfigFile("./facta.config.json", { env: process.env });`,
    },
    guides: ["node", "storage-adapters"],
    sources: ["src/file-archive.ts", "src/node-config.ts", "node.ts"],
  },

  // ---------------------------------------------------------------- Emergencia
  {
    id: "emergency",
    group: "emergencia",
    title: "Salvaguarda de emergencia: runtime.emergencyStore",
    summary: "Facta DTE retiene cada documento sellado una hora mientras lo escribe en almacenamiento duradero. Si no pudo guardarlo en ningún sitio, o toda la replicación falló, esa copia temporal es la única. emergencyStore es una función suya, que el SDK llama una sola vez por documento, solo en esa emergencia, con el Archivo DTE, el JSON original, el PDF y lo ocurrido. Es opcional (sin ella, Facta DTE envía una copia al correo del dueño) y nunca convierte un documento sellado en un error. facta.emergency.replicate reintenta la replicación normal con los archivos que su función guardó.",
    covers: [
      "FactaOptions.runtime", "FactaRuntimeConfigV1.emergencyStore", "FactaRuntimeConfigV1.onEmergency", "Facta#emergency", "FactaEmergencyApi.*",
      "mod:FactaEmergencyApi", "mod:Emergency*", "mod:emergencyWarningCodes",
    ],
    demo: { kind: "simulated", recipe: "emergency-store", note: "Simulada: una API en memoria responde con la advertencia que usted elija. El playground nunca provoca una emergencia real ni escribe en ningún almacenamiento." },
    code: { kind: "file", path: "playground/server/recipes/emergency-store.ts" },
    guides: ["emergency", "storage-adapters"],
    sources: ["src/emergency.ts", "src/client.ts"],
  },

  // ---------------------------------------------------------------- Región, tiempos y reloj
  {
    id: "region",
    group: "region",
    title: "Región de la API: region() y servedRegion",
    summary: "Las funciones de la API corren junto a la base de datos, no junto a quien llama: fijar cada petición a esa región (x-region) bajó POST /v1/dte de 7.2 s a 4.3 s. El cliente la aprende una vez de /v1/status; usted puede fijarla (region: \"us-west-2\", config.region o la variable FACTA_API_REGION) o apagarla (region: false). region() lee el ajuste y servedRegion dice qué región respondió la última llamada.",
    covers: ["Facta#region", "Facta#servedRegion", "FactaOptions.region"],
    demo: { kind: "recipe", recipe: "region-timings" },
    code: { kind: "file", path: "playground/server/recipes/region-timings.ts" },
    guides: ["region", "reference"],
    sources: ["src/client.ts"],
  },
  {
    id: "timings",
    group: "region",
    title: "Tiempos por paso: debug: { timings: true }",
    summary: "Una ayuda para depurar, apagada por defecto y nunca para el tráfico de producción: con debug: { timings: true } en el cliente (o en una sola llamada) la API contesta con sus tiempos por paso, que el SDK expone en result.debug como { timings: [{ step, ms }], totalMs }. Si el cuerpo no los trae, se leen del encabezado Server-Timing. El interruptor «Mostrar tiempos» del playground usa exactamente esto.",
    covers: ["FactaOptions.debug", "DebugOptions.*", "mod:DebugOptions", "mod:DebugInfo", "mod:DebugTiming"],
    demo: { kind: "recipe", recipe: "region-timings", note: "Active además «Mostrar tiempos» en cualquier receta para ver el desglose completo." },
    code: { kind: "file", path: "playground/server/recipes/region-timings.ts" },
    guides: ["timings", "reference"],
    sources: ["src/debug.ts", "src/client.ts"],
  },
  {
    id: "reference-clock",
    group: "region",
    title: "El reloj de referencia: facta.clock y createReferenceClock",
    summary: "El SDK escribe marcas de tiempo propias (los registros del archivo local y las firmas de las subidas a S3) y no quiere depender de un reloj desajustado. Por defecto calibra un reloj local contra clock.factadte.com (tres muestras, al estilo NTP) y después mide con el reloj monotónico, sin más peticiones durante horas. La fecha y la hora de un documento las pone siempre el servidor de Facta DTE; este reloj nunca las toca. Si el servicio no responde, usa el reloj del equipo y no falla ninguna operación.",
    covers: [
      "Facta#clock", "FactaOptions.clock", "FactaOptions.clockFetch", "mod:createReferenceClock", "mod:ReferenceClock", "mod:ReferenceClockOptions",
      "mod:ClockState", "mod:ClockStatus", "mod:DEFAULT_CLOCK_URL",
    ],
    demo: { kind: "recipe", recipe: "reference-clock" },
    code: { kind: "file", path: "playground/server/recipes/reference-clock.ts" },
    guides: ["reference-clock", "reference"],
    sources: ["src/reference-clock.ts", "src/clock-config.ts"],
  },

  // ---------------------------------------------------------------- Diagnóstico
  {
    id: "diagnose",
    group: "diagnostico",
    title: "Diagnóstico: diagnose()",
    summary: "Responde «¿está esta llave lista para trabajar?» con una lista de revisiones (ok, aviso o bloqueado) y qué hacer en cada caso: la llave y su ambiente, los alcances, la llave de firma, el certificado, las revisiones del catálogo y los destinos, la función de emergencia. Solo lee /v1/status: no abre bóvedas, no reserva correlativos ni envía documentos. Úselo al arrancar y en un endpoint de salud; con config.expectedEnvironment y requiredScopes avisa de una llave de pruebas en producción antes de la primera venta.",
    covers: ["Facta#diagnose", "mod:DiagnoseOptions", "mod:DiagnosticCheck", "mod:DiagnosticRevisions", "mod:DiagnosticsReport", "mod:DiagnosticState"],
    demo: { kind: "recipe", recipe: "diagnose" },
    code: { kind: "file", path: "playground/server/recipes/diagnose.ts" },
    guides: ["diagnose", "reference"],
    sources: ["src/diagnostics.ts", "src/client.ts"],
  },

  // ---------------------------------------------------------------- Errores
  {
    id: "errors",
    group: "errores",
    title: "FactaError y todos los códigos de error",
    summary: "Todo fallo del SDK es un FactaError con un code estable, el status HTTP y details. Ramifique siempre por code: el mensaje es prosa para quien lee un registro y puede reescribirse. Si Hacienda rechazó un documento, spent trae el correlativo que se gastó y mhObservations lo que Hacienda dijo. Se reintentan solos (hasta maxRetries) idempotency_in_flight, mh_unreachable, service_unavailable, correlative_unavailable, storage_unavailable y network_error; el resto requiere actuar.",
    covers: ["mod:FactaError", "mod:FactaErrorCode", "mod:SpentCorrelative", "error:*"],
    demo: { kind: "recipe", recipe: "issue-idempotent", note: "Pruebe un tipo que Hacienda rechace, o emita sin completar un campo, para ver un FactaError con su código." },
    code: { kind: "file", path: "playground/server/recipes/status-recovery.ts" },
    guides: ["errors", "reference"],
    sources: ["src/errors.ts", "src/client.ts"],
  },

  // ---------------------------------------------------------------- Servidor
  {
    id: "server-session",
    group: "servidor",
    title: "Una sesión por venta: createFactaSession y verifyFactaSession",
    summary: "Su servidor describe la venta una vez y firma un token de sesión (HMAC con un secreto suyo): la solicitud fiscal, la llave de idempotencia, el correo a entregar y lo que la ventana debe mostrar. El navegador solo recibe el token y no puede editar el documento. Dura 15 minutos por defecto. createFactaInvalidationSession hace lo mismo para una anulación; verify… comprueba un token recibido.",
    covers: [
      "server:createFactaSession", "server:verifyFactaSession", "server:FactaSession", "server:FactaSessionDisplay", "server:FactaSessionError",
      "server:CreateFactaSessionInput", "CreateFactaSessionInput.*", "server:DEFAULT_SESSION_TTL_SECONDS",
      "server:createFactaInvalidationSession", "server:verifyFactaInvalidationSession", "server:FactaInvalidationSession",
      "server:CreateFactaInvalidationSessionInput", "CreateFactaInvalidationSessionInput.*",
    ],
    demo: { kind: "page", path: "/pantallas?c=dialog", label: "Ver la venta y la sesión en Pantallas React" },
    code: { kind: "file", path: "playground/server/sale.ts" },
    guides: ["react-server", "react"],
    sources: ["src/server/session.ts"],
  },
  {
    id: "server-handler",
    group: "servidor",
    title: "El manejador de su servidor: createFactaHandler",
    summary: "Una función Request → Response que usted monta en una ruta POST de su servidor, donde viven apiKey y signKey. Atiende lo que las pantallas y el cliente de navegador piden: emitir con el token de sesión, estado, documentos, descargas, catálogo, almacenamiento y anulación. capabilities decide qué acciones existen (todo lo que no declare, no existe), authorize es su puerta (quién puede pedir qué) y onIssued le avisa de cada emisión para que la registre. toNodeHandler lo adapta a Express o http de Node.",
    covers: [
      "server:createFactaHandler", "server:FactaHandlerOptions", "FactaHandlerOptions.*", "FactaCapabilities.*", "server:FactaCapabilities",
      "server:FactaHandlerEvent", "server:FactaHandlerErrorBody", "server:FactaIssuedContext", "server:FactaAuthorizeContext", "server:FactaLike",
      "server:FactaArchiveMode", "server:FactaListScope", "server:FactaServiceState", "server:FactaStorageSummary", "server:FactaFieldIssue",
      "server:extractFieldIssues", "server:normalizeFieldPath", "server:summarizeStorage", "server:statusTokenFor", "server:ON_ISSUED_FAILED",
      "server:maskDocumentNumber", "server:NodeRequestLike", "server:NodeResponseLike", "server:toNodeHandler",
    ],
    demo: { kind: "page", path: "/pantallas?c=list", label: "Ver el manejador atendiendo las pantallas" },
    code: { kind: "file", path: "playground/server/facta.ts" },
    guides: ["react-server", "react"],
    sources: ["src/server/handler.ts", "src/server/capabilities.ts", "src/server/data-actions.ts", "src/server/delivery-handle.ts"],
  },

  // ---------------------------------------------------------------- Navegador
  {
    id: "browser-client",
    group: "navegador",
    title: "El cliente de navegador: createFactaClient",
    summary: "Habla con el manejador de su servidor (nunca con la API de Facta DTE) y no guarda ninguna llave. Entrega los mismos datos que las pantallas de React, ya proyectados para mostrarse: sesión, documentos, detalle, copias, catálogo, estado del servicio y anulación. FactaClientError trae el código del error del manejador.",
    covers: [
      "browser:createFactaClient", "browser:FactaClientError", "browser:FactaClient", "browser:FactaClientOptions", "FactaClientOptions.*",
      "browser:FactaDataClient", "browser:FactaFullClient", "browser:HandlerErrorCode", "browser:WireErrorCode", "browser:WireError",
      "browser:WireFieldIssue", "browser:Action", "browser:Environment", "browser:Draft*", "browser:Session*", "browser:StorageSummary",
      "browser:IssueSummary", "browser:SpentInfo", "browser:StatusSummary", "browser:Document*", "browser:CopyRow", "browser:StorageRetryResult",
      "browser:HoldingRow", "browser:CustomerOption", "browser:ProductOption", "browser:ServiceState", "browser:ServiceStatusView",
      "browser:StorageView", "browser:Invalidation*", "browser:IssueResult",
    ],
    demo: { kind: "page", path: "/implementacion", label: "Ver el checkout de la tienda (sin React)" },
    code: { kind: "file", path: "playground/site/sections/headless/checkout-form.tsx" },
    guides: ["browser", "react-server"],
    sources: ["src/browser/client.ts", "src/browser/wire.ts"],
  },
  {
    id: "browser-flow",
    group: "navegador",
    title: "El flujo de emisión sin React: createIssueFlow",
    summary: "La máquina de estados de una emisión, sin interfaz: revisar, emitir, verificar, sellada, contingencia, rechazada o sesión vencida, con reintento y el seguimiento de la entrega. Usted la conecta a su propio diseño con subscribe(). run decide si espera su confirmación (manual) o emite de inmediato (auto).",
    covers: [
      "browser:createIssueFlow", "browser:initialFlowState", "browser:FlowFailure", "browser:FlowState", "browser:FlowStep", "browser:IssueFlow",
      "browser:IssueFlowOptions", "IssueFlowOptions.*", "browser:IssuePhase", "browser:RunMode",
    ],
    demo: { kind: "page", path: "/implementacion", label: "Ver el flujo en tres interfaces propias" },
    code: { kind: "file", path: "playground/site/sections/headless/checkout-form.tsx" },
    guides: ["browser"],
    sources: ["src/browser/flow.ts"],
  },
  {
    id: "browser-messages",
    group: "navegador",
    title: "Mensajes y errores en español: esMessages, explainError, describeFields",
    summary: "Todos los textos de las ventanas están en un catálogo (esMessages) que usted puede sobrescribir con mergeMessages. explainError convierte el código de un error en una explicación y una acción; describeFields y describeFieldPath nombran los campos que el servidor rechazó («Receptor · NRC») en lugar de rutas técnicas. fill rellena las variables de un mensaje.",
    covers: [
      "browser:esMessages", "browser:explainError", "browser:fill", "browser:mergeMessages", "browser:describeFieldPath", "browser:describeFields",
      "browser:FactaMessages", "browser:FactaMessagesOverride", "browser:FieldIssue", "react:FactaMessagesOverride",
    ],
    demo: { kind: "page", path: "/pantallas?c=studio", label: "Ver los mensajes en el estudio de apariencia" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/appearance-studio.tsx" },
    guides: ["browser", "react"],
    sources: ["src/browser/messages.es.ts", "src/browser/fields.ts"],
  },
  {
    id: "browser-appearance",
    group: "navegador",
    title: "Apariencia: tema, densidad, movimiento y colores",
    summary: "FactaAppearance describe el aspecto (tema claro, oscuro o institucional, densidad, movimiento, color de acento, radio y tipografía). mergeAppearance combina capas, appearanceToCssVariables lo convierte en variables CSS y pickAccentInk elige negro o blanco con contraste suficiente sobre su color de marca. resolveMotion respeta «reducir movimiento» del sistema.",
    covers: [
      "browser:appearanceToCssVariables", "browser:colorToSrgb", "browser:mergeAppearance", "browser:pickAccentInk", "browser:resetAppearanceWarnings",
      "browser:resolveAccentInk", "browser:resolveMotion", "browser:FactaAppearance", "browser:FactaDensity", "browser:FactaMotion", "browser:FactaSlot",
      "browser:FactaStyles", "browser:FactaTheme", "browser:InkChoice", "browser:FactaVariables",
    ],
    demo: { kind: "page", path: "/pantallas?c=studio", label: "Probar la apariencia en el estudio" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/appearance-studio.tsx" },
    guides: ["browser", "react"],
    sources: ["src/browser/appearance.ts"],
  },
  {
    id: "browser-format",
    group: "navegador",
    title: "Formato de dinero, fechas y cantidades",
    summary: "formatMoney, formatQuantity y formatDateTime escriben cantidades y fechas como las lee una persona en El Salvador; lineAmount calcula el importe de una línea para mostrarlo (el servidor decide los montos fiscales), truncateMiddle acorta códigos largos sin perder el principio ni el final y storageTone da el color del medidor de almacenamiento.",
    covers: ["browser:formatDateTime", "browser:formatMoney", "browser:formatQuantity", "browser:lineAmount", "browser:truncateMiddle", "browser:storageTone", "browser:StorageTone"],
    demo: { kind: "page", path: "/implementacion", label: "Ver formatMoney en el punto de venta" },
    code: { kind: "file", path: "playground/site/sections/headless/pos-keypad.tsx" },
    guides: ["browser"],
    sources: ["src/browser/format.ts", "src/browser/storage.ts"],
  },
  {
    id: "browser-download",
    group: "navegador",
    title: "Guardar archivos en el navegador: downloadPdf, downloadJson y saveBlob",
    summary: "Convierten los bytes que entrega el manejador en un archivo descargado: downloadPdf y downloadJson ponen el nombre correcto, saveBlob guarda cualquier Blob y base64ToBytes decodifica el PDF que viene en base64.",
    covers: ["browser:base64ToBytes", "browser:downloadJson", "browser:downloadPdf", "browser:saveBlob"],
    demo: { kind: "page", path: "/pantallas?c=download", label: "Descargar el PDF y el JSON de un documento" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/receipt.tsx" },
    guides: ["browser", "react"],
    sources: ["src/browser/download.ts"],
  },
  {
    id: "browser-cache",
    group: "navegador",
    title: "Caché de lecturas: createFactaCache",
    summary: "Un caché en memoria con vencimiento para las lecturas del cliente (listas, detalle, catálogo), que evita repetirle la misma pregunta al servidor mientras el dato sigue vigente. Los hooks de React lo usan por usted.",
    covers: ["browser:createFactaCache", "browser:CacheEntry", "browser:FactaCache"],
    demo: { kind: "page", path: "/pantallas?c=list", label: "Ver la lista de documentos, que lee con caché" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/document-list.tsx" },
    guides: ["browser"],
    sources: ["src/browser/cache.ts"],
  },

  // ---------------------------------------------------------------- React
  {
    id: "react-provider",
    group: "react",
    title: "FactaProvider y useFactaWindow",
    summary: "FactaProvider recibe el cliente (o la dirección de su manejador) y la apariencia, y alimenta a todos los componentes. useFactaWindow abre una ventana de emisión desde cualquier parte de su aplicación con una sesión y devuelve sus eventos (FactaEvent), que usted puede escuchar. Los estilos se importan con @facta-dte/api/react/styles.css.",
    covers: [
      "react:FactaProvider", "react:FactaProviderProps", "react:FactaWindowError", "react:useFactaWindow", "react:OpenWindowOptions",
      "react:FactaEvent", "react:FactaEventType", "react:AutoCloseOn", "react:AutoCloseState",
    ],
    demo: { kind: "page", path: "/pantallas?c=window", label: "Abrir una ventana con useFactaWindow" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/window-hook.tsx" },
    guides: ["react", "react-server"],
    sources: ["src/react/provider.tsx", "src/react/windows.tsx"],
  },
  {
    id: "react-issue-hook",
    group: "react",
    title: "useFactaIssue: su interfaz, el flujo de Facta DTE",
    summary: "El hook que emite y reporta cada estado, para quien dibuja su propia pantalla sin usar ningún componente visual del SDK: un punto de venta, un checkout, un teclado. Con run: \"auto\" emite apenas hay sesión. Devuelve el estado del flujo, la confirmación y el reintento.",
    covers: ["react:useFactaIssue", "react:UseFactaIssue", "react:UseFactaIssueOptions", "UseFactaIssueOptions.*", "react:FlowFailure", "react:RunMode", "react:IssueResult"],
    demo: { kind: "page", path: "/implementacion", label: "Ver el punto de venta propio" },
    code: { kind: "file", path: "playground/site/sections/headless/pos-keypad.tsx" },
    guides: ["react", "browser"],
    sources: ["src/react/use-issue.ts"],
  },
  {
    id: "react-windows",
    group: "react",
    title: "Ventanas de emisión: FactaInvoiceDialog, Drawer, Inline y Window",
    summary: "La misma ventana en tres formatos (diálogo, panel lateral o incrustada en la página) y el componente base FactaInvoiceWindow. Muestran la revisión, la emisión con cada fase, el recibo con las descargas, la contingencia con su plazo y el rechazo explicado. run: \"manual\" pide confirmación; \"auto\" emite al abrir; \"auto-close\" además se cierra sola.",
    covers: [
      "react:FactaInvoiceDialog", "react:FactaInvoiceDrawer", "react:FactaInvoiceInline", "react:FactaInvoiceWindow", "react:FactaInlineProps",
      "react:FactaInvoiceWindowProps", "react:FactaLayerProps", "react:FactaWindowProps", "react:FactaWindowView", "react:FactaWindowViewProps",
      "react:CardVariant", "react:FactaRoot",
    ],
    demo: { kind: "page", path: "/pantallas?c=dialog", label: "Emitir una factura con FactaInvoiceDialog" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/dialog.tsx" },
    guides: ["react"],
    sources: ["src/react/windows.tsx", "src/react/card.tsx", "src/react/screens.tsx"],
  },
  {
    id: "react-issue-button",
    group: "react",
    title: "FactaIssueButton",
    summary: "Un botón que abre la ventana de emisión con una sesión. Muestra su estado (emitiendo, sellada…) y se puede reemplazar por completo con IssueButtonView si quiere su propio botón.",
    covers: ["react:FactaIssueButton", "react:FactaIssueButtonProps", "react:IssueButtonView", "react:IssueButtonViewProps"],
    demo: { kind: "page", path: "/pantallas?c=button", label: "Probar FactaIssueButton" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/issue-button.tsx" },
    guides: ["react"],
    sources: ["src/react/button.tsx"],
  },
  {
    id: "react-receipt",
    group: "react",
    title: "Recibo, estado y descargas: FactaReceipt, FactaStatusBadge, FactaDownloadButton",
    summary: "FactaReceipt dibuja el recibo de un documento sellado con su sello, sus totales, la entrega y los botones de descarga; FactaStatusBadge muestra el estado como una etiqueta y FactaDownloadButton baja el PDF, el JSON o el ticket. rawJson agrega la descarga del JSON original.",
    covers: [
      "react:FactaReceipt", "react:FactaReceiptProps", "react:FactaStatusBadge", "react:FactaStatusBadgeProps", "react:FactaDownloadButton",
      "react:FactaDownloadButtonProps",
    ],
    demo: { kind: "page", path: "/pantallas?c=receipt", label: "Ver FactaReceipt con un documento suyo" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/receipt.tsx" },
    guides: ["react"],
    sources: ["src/react/receipt.tsx", "src/react/status-badge.tsx", "src/react/download-button.tsx"],
  },
  {
    id: "react-documents",
    group: "react",
    title: "Documentos: FactaDocumentList, FactaDocumentDetail y sus hooks",
    summary: "La lista de documentos con filtros por período y la ficha de uno (receptor, líneas, totales, copias y estado). Los hooks useFactaDocuments, useFactaDocument y useFactaDocumentCopies entregan los mismos datos para que dibuje su propia lista. periodRange calcula el rango de fechas de un mes o un año.",
    covers: [
      "react:FactaDocumentList", "react:FactaDocumentListProps", "react:FactaDocumentDetail", "react:FactaDocumentDetailProps", "react:periodRange",
      "react:useFactaDocument", "react:useFactaDocumentCopies", "react:useFactaDocuments", "react:UseFactaDocumentOptions", "react:UseFactaDocuments",
      "react:UseFactaDocumentsOptions", "react:QueryState", "react:copyText", "react:CopyRow", "react:Document*",
    ],
    demo: { kind: "page", path: "/pantallas?c=list", label: "Ver FactaDocumentList" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/document-list.tsx" },
    guides: ["react"],
    sources: ["src/react/document-list.tsx", "src/react/document-detail.tsx", "src/react/data-hooks.ts"],
  },
  {
    id: "react-pickers",
    group: "react",
    title: "Selectores de catálogo: FactaCustomerPicker y FactaProductPicker",
    summary: "Buscadores de clientes y productos del catálogo de la llave, con búsqueda mientras escribe. Entregan el id elegido, que viaja en la sesión como customerId o productId; el servidor lo resuelve al emitir. Los hooks useFactaCustomers y useFactaProducts dan la misma búsqueda sin interfaz.",
    covers: [
      "react:FactaCustomerPicker", "react:FactaCustomerPickerProps", "react:FactaProductPicker", "react:FactaProductPickerProps",
      "react:useFactaCustomers", "react:useFactaProducts", "react:CatalogSearch", "react:UseCatalogSearchOptions", "react:CustomerOption", "react:ProductOption",
    ],
    demo: { kind: "page", path: "/pantallas?c=pickers", label: "Buscar en el catálogo con los selectores" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/pickers.tsx" },
    guides: ["react", "catalog"],
    sources: ["src/react/pickers.tsx"],
  },
  {
    id: "react-service-status",
    group: "react",
    title: "Estado del servicio y del almacenamiento: FactaServiceStatus y FactaStorageMeter",
    summary: "FactaServiceStatus muestra si la API, Hacienda y el almacenamiento están respondiendo, y FactaStorageMeter el espacio usado del almacenamiento administrado. Los hooks useFactaServiceStatus y useFactaStorage entregan los datos; formatStorageBytes escribe los tamaños.",
    covers: [
      "react:FactaServiceStatus", "react:FactaServiceStatusProps", "react:useFactaServiceStatus", "react:UseFactaServiceStatus",
      "react:FactaStorageMeter", "react:FactaStorageMeterProps", "react:formatStorageBytes", "react:useFactaStorage", "react:UseFactaStorage", "react:ServiceState", "react:StorageView",
    ],
    demo: { kind: "page", path: "/pantallas?c=status", label: "Ver FactaServiceStatus" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/service-status.tsx" },
    guides: ["react"],
    sources: ["src/react/service-status.tsx", "src/react/storage-meter.tsx", "src/react/data-hooks.ts"],
  },
  {
    id: "react-invalidate",
    group: "react",
    title: "Anular desde la pantalla: FactaInvalidateDialog y useFactaActions",
    summary: "El diálogo de anulación: pide el motivo y a las personas responsables y solicitante con su tipo de documento, comprueba el número antes de enviar y explica el resultado. Solo funciona con una sesión de anulación creada en su servidor. useFactaActions da las mismas operaciones (anular, reintentar copias) sin interfaz.",
    covers: ["react:FactaInvalidateDialog", "react:FactaInvalidateDialogProps", "react:useFactaActions", "react:UseFactaActions", "react:Invalidation*"],
    demo: { kind: "page", path: "/pantallas?c=invalidate", label: "Anular un documento suyo" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/invalidate.tsx" },
    guides: ["react", "react-server"],
    sources: ["src/react/invalidate-dialog.tsx"],
  },
  {
    id: "react-look",
    group: "react",
    title: "Marca y estilos: FactaLook, FactaBranding y classNames",
    summary: "FactaLook reúne la apariencia, el nombre y logo de su marca (FactaBranding), las clases CSS por parte de la ventana (FactaClassNames, con una ranura por elemento) y estilos en línea (FactaSlotStyles). Así las ventanas se ven como su aplicación y no como un componente ajeno.",
    covers: ["react:FactaBranding", "react:FactaClassNames", "react:FactaClassNameSlot", "react:FactaLook", "react:FactaSlotStyles", "react:FactaAppearance", "react:FactaDensity", "react:FactaMotion", "react:FactaSlot", "react:FactaTheme", "react:FactaVariables"],
    demo: { kind: "page", path: "/pantallas?c=studio", label: "Diseñar la apariencia y copiar el código" },
    code: { kind: "file", path: "playground/site/sections/screens/examples/appearance-studio.tsx" },
    guides: ["react"],
    sources: ["src/react/look.tsx", "src/react/parts.tsx"],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers shared by the page and the test.

/** `*` matches any run of characters; everything else is literal. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\#]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

/** The keys one entry covers, out of the real list of keys. */
export function keysCoveredBy(entry: CoverageEntry, keys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const pattern of entry.covers) {
    const wanted = patternToRegExp(pattern);
    for (const key of keys) if (wanted.test(key)) out.add(key);
  }
  return [...out];
}

export const groupOf = (id: GroupId): Group => GROUPS.find((g) => g.id === id)!;

/** Text a search box matches against: title, summary, ids of what it covers, the recipe and the guides. */
export function searchTextOf(entry: CoverageEntry): string {
  const demo = entry.demo.kind === "recipe" || entry.demo.kind === "simulated" ? entry.demo.recipe : "";
  const names = entry.covers.map((c) => c.replace(/^[a-z-]+:|^\*:/, "")).join(" ");
  return `${entry.title} ${entry.summary} ${names} ${demo} ${entry.guides.join(" ")}`.toLowerCase();
}

export const RAW_FILE_BASE = "https://github.com/Facta-DTE/facta-api-sdk/blob/main/";
export const PORTAL_BASE = "https://sdk.factadte.com";
