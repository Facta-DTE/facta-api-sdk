// «Cómo funciona» for each server recipe. Every claim here was read from the recipe source
// (server/recipes/*.ts), the SDK (src/client.ts, src/errors.ts, src/types.ts) or the API contract
// (openapi.yaml), and test/guides.test.ts checks the parts a machine can: method names, routes, error codes.
// Copy is Spanish (es-SV), always «usted», written the way a person would explain it to someone at the keyboard.
//
// What is deliberately NOT here: any timing the sources do not state, and any behaviour of contingency
// beyond «no token, channel `esperando_sello`».

import { CATALOG_GUIDE_URL, DELIVERY_DOC_URL, recipeLink, REACT_SERVER_GUIDE_URL, referenceLink, STORAGE_GUIDE_URL } from "../guides/links.ts";
import type { RecipeGuide } from "../guides/types.ts";

export const RECIPE_GUIDES: Record<string, RecipeGuide> = {
  "issue-idempotent": {
    problem:
      "Usted pide una factura y la llamada se corta, el servidor tarda o alguien pulsa el botón dos veces. Si nada identifica la venta, cada intento es una venta nueva: salen **dos facturas** por lo mismo y se gastan dos correlativos, que no se devuelven.",
    steps: [
      {
        title: "Elija la llave.",
        text: "Use algo que no cambie nunca para esa venta, como el número de su pedido. Aquí el playground le antepone una etiqueta suya para que dos visitantes que escriben el mismo número no choquen. La misma llave siempre nombra la misma venta.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
      },
      {
        title: "Emita.",
        text: "En una sola llamada Facta DTE reserva el correlativo, firma con su certificado, transmite a Hacienda y le contesta. Un sello es definitivo; la contingencia es una respuesta aceptada (HTTP 202) que todavía hay que reconciliar; un rechazo de Hacienda llega como error 422.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
      {
        title: "Repita con la misma llave y la misma solicitud.",
        text: "Con «Reintentar igual» el API no le pide nada otra vez a Hacienda: responde con el documento original, el mismo `codigoGeneracion`, y marca la respuesta con la cabecera `Idempotency-Replayed: true`. Si el original fue un rechazo, repite el mismo 422 sin gastar otro número.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
    ],
    look: [
      "Después de «Reintentar igual», el mismo código de generación. Si fuera otro, la página lo avisa con «El documento es distinto».",
      "El estado de la respuesta: sellado, o contingencia si Hacienda no contestó a tiempo.",
      "En el Registro, una sola fila para esa venta aunque la haya pedido dos veces.",
    ],
    use: [
      "Siempre que su proceso pueda repetirse: un botón de pagar, un webhook, un trabajo en una cola.",
      "Cuando ya tiene un número de pedido, de ticket o de factura interna que no cambia.",
      "Es la forma normal de emitir, no un extra para casos raros.",
    ],
    dont:
      "no genere una llave nueva en cada intento (un UUID aleatorio por clic equivale a no tener llave) ni reutilice una llave para una venta distinta: el API la rechaza con `idempotency_key_reuse` antes que devolverle la factura de ayer.",
    rule: "una venta, una llave, y la llave sale de algo que no cambia.",
    concepts: [
      {
        title: "Qué es una llave de idempotencia",
        text: "Es un texto que usted elige para identificar una operación. El SDK lo envía en la cabecera `Idempotency-Key` de cada POST. Si el API ya vio esa llave con esa misma solicitud, devuelve lo que contestó la primera vez. Si usted no da ninguna, el SDK inventa una aleatoria por llamada: sus reintentos internos sí la comparten, pero dos llamadas suyas serán dos ventas.",
      },
      {
        title: "Cuánto dura",
        text: "24 horas, por llave de API. Pasado ese tiempo, repetir la llave ya es una venta nueva, no un reintento. Dos integraciones distintas pueden usar el mismo texto sin pisarse.",
      },
      {
        title: "Qué cuenta contra su límite",
        text: "En el playground cada llave nueva que emite cuenta una vez; repetir la misma no cuenta otra vez. El formulario ofrece Factura (01), Crédito fiscal (03), notas de crédito y débito (05 y 06, que corrigen un documento que usted emitió aquí), Exportación (11) y Sujeto excluido (14).",
      },
    ],
    errors: [
      { code: "idempotency_key_reuse", text: "la misma llave con otro contenido. Revise que no esté reusando el número de otro pedido." },
      { code: "idempotency_in_flight", text: "la primera llamada con esa llave sigue en curso. El SDK reintenta solo hasta 3 veces; si aun así llega, espere unos segundos y repita." },
      { code: "mh_rejected", text: "Hacienda leyó el documento y lo negó. Sí gastó el correlativo: `error.spent` lo nombra y `error.mhObservations` trae lo que dijo Hacienda." },
      { code: "validation_failed", text: "no cumple el esquema oficial. No se gastó correlativo; `details.issues` dice qué campo." },
      { code: "rate_limited", text: "la llave llegó a su techo por hora o por día. `details.retryAfterSeconds` dice cuánto esperar." },
    ],
    more: [
      recipeLink("Receta 3: Consultar estado y recuperar →", "status-recovery"),
      referenceLink("issue", "issue"),
    ],
  },

  "prepare-sign": {
    problem:
      "A veces una persona, o una regla de su negocio, tiene que ver el documento **antes** de que quede firmado y enviado a Hacienda: el total con IVA, el receptor, cada línea. Con `issue` todo pasa en una sola llamada y ya no hay vuelta atrás. Partirla en dos le da un punto de revisión.",
    steps: [
      {
        title: "Preparar.",
        text: "Facta DTE valida la solicitud, **reserva el número de control** y devuelve el documento canónico sin firmar (`documento`), sus `totales` y un `prepareToken`. Todavía no hay firma ni sello, y para preparar no hace falta la contraseña de firma.",
        sdk: ["facta.prepare(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte/prepare"],
      },
      {
        title: "Revisar.",
        text: "Este paso es suyo, no del SDK: muestre `prepared.documento` y `prepared.totales` a una persona, o pásele sus propias reglas. Aquí el playground guarda el documento preparado 10 minutos; el token del API vale 15.",
      },
      {
        title: "Firmar.",
        text: "Devuelva el objeto **tal como lo recibió**. El servidor comprueba un código (MAC) sobre el hash del documento: si cambió un centavo, contesta `prepare_token_invalid` y no firma nada. Si coincide, firma con su certificado, transmite y devuelve el mismo resultado que `issue`.",
        sdk: ["facta.sign(preparado, { idempotencyKey })"],
        http: ["POST /v1/dte/sign"],
      },
    ],
    look: [
      "Tras «1. Preparar»: estado «preparado», el número de control y los totales, sin sello.",
      "Tras «2. Firmar»: el mismo número de control que dio prepare, ahora con sello de Hacienda.",
      "El playground cuenta la emisión contra su límite al firmar, no al preparar.",
    ],
    use: [
      "Su negocio pide una aprobación antes de emitir: monto alto, cliente nuevo, descuento fuera de lo normal.",
      "Quiere enseñarle al cliente el total final antes de comprometer el correlativo.",
      "Quien prepara y quien firma no son la misma persona ni el mismo servicio: preparar no necesita la contraseña de firma.",
    ],
    dont:
      "no cambie nada de `documento` entre preparar y firmar, ni un centavo ni una descripción. Si algo tiene que cambiar, prepare otra vez. Y no lo trate como un borrador: preparar ya reservó un número de control.",
    rule: "lo que se firma tiene que ser exactamente lo que obtuvo el número.",
    concepts: [
      {
        title: "Qué significan prepare y sign",
        text: "`prepare` arma el documento fiscal y le asigna su número de control, pero no lo firma. `sign` le pone la firma electrónica y lo transmite a Hacienda. `issue` hace las dos cosas seguidas; esta receta las separa para que alguien mire en medio.",
      },
      {
        title: "Por qué se revisa antes de firmar",
        text: "Un documento sellado ya existe para Hacienda y solo se corrige con una anulación o una nota. Revisar antes de firmar es lo único que no deja rastro.",
      },
      {
        title: "Una llave por llamada",
        text: "Son dos operaciones, así que cada una lleva su llave: el playground termina la llave con `.prepare` y `.sign`. Repetir una de las dos con la misma llave devuelve su resultado guardado.",
      },
    ],
    errors: [
      { code: "prepare_token_invalid", text: "el token venció (15 minutos), es de otra llave, o el documento cambió. Prepare de nuevo." },
      { code: "validation_failed", text: "la solicitud no cumple el esquema oficial. No se gastó correlativo." },
      { code: "no_storage_destination", text: "la empresa no tiene un destino de almacenamiento conectado y verificado en los últimos 30 días. No gasta correlativo." },
      { code: "sign_key_required", text: "falta la contraseña de firma al llamar `sign`." },
      { code: "idempotency_key_reuse", text: "la misma llave con otra solicitud. Use una llave nueva para un pedido distinto." },
    ],
    more: [
      recipeLink("Receta 1: Emitir con idempotencia →", "issue-idempotent"),
      referenceLink("prepare, sign", "prepare-sign"),
    ],
  },

  "status-recovery": {
    problem:
      "Un corte de red, un servidor lento o una conexión cerrada y su sistema se queda sin respuesta. La factura **puede haberse emitido igual**. Si la pide otra vez con un número de orden nuevo, salen **dos facturas** por la misma venta y se gastan dos correlativos.",
    steps: [
      {
        title: "Primera llamada.",
        text: "Pide la factura con su número de orden. Con «Simular una respuesta que no llega», el playground deja de esperar a los 250 ms; el API sigue trabajando y la factura puede emitirse igual.",
        sdk: ["facta.issue(solicitud, { idempotencyKey, signal })"],
        http: ["POST /v1/dte"],
      },
      {
        title: "Repetir con la misma orden.",
        text: "Hasta 5 intentos. Si la primera ya terminó, el API devuelve la factura original. Si sigue en proceso, responde `idempotency_in_flight` y la receta espera 2 s antes del siguiente.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
      {
        title: "Confirmar por código.",
        text: "Consulta el documento por su código de generación y muestra su estado: sellado, rechazado o en contingencia, entre otros. La consulta también responde por documentos que Hacienda rechazó.",
        sdk: ["facta.getDocumentStatus(codigo)"],
        http: ["GET /v1/dte/{codigo}"],
      },
    ],
    look: [
      "«La primera llamada no respondió a tiempo: no sabemos si el documento se emitió».",
      "«Reintento 1 con la misma llave: el API devolvió el documento original», con el mismo código de generación.",
      "El estado final del documento, y en el Registro una sola factura para esa orden.",
    ],
    use: [
      "Una llamada termina por tiempo de espera o por error de red.",
      "Su proceso se reinició a mitad de una emisión.",
      "Un webhook o una cola entrega el mismo pedido dos veces.",
    ],
    dont:
      "volver a emitir con un número de orden nuevo, o dar la venta por fallida sin consultar. Las dos cosas terminan en facturas dobles o en ventas sin factura.",
    rule: "ante una respuesta dudosa, misma orden y luego consulta por código.",
    concepts: [
      {
        title: "Qué es una respuesta incierta",
        text: "Es cuando la llamada termina sin que usted sepa el resultado: no hubo respuesta, no que Hacienda la haya negado. Un rechazo sí es una respuesta (`mh_rejected`) y se arregla cambiando los datos; una respuesta incierta se arregla preguntando.",
      },
      {
        title: "Qué simula el playground",
        text: "Solo acorta la espera de SU cliente con una señal de cancelación de 250 ms (`AbortSignal.timeout`). El API no se entera y sigue: por eso el documento puede existir aunque su llamada haya abandonado. Cancelar del lado suyo nunca deshace nada del lado del API.",
      },
      {
        title: "El SDK ya reintenta solo",
        text: "Cuando falla la red, el SDK repite hasta 3 veces con la misma llave antes de lanzar `network_error`. Esta receta es lo que hace usted después de eso, o cuando usted mismo canceló la espera.",
      },
    ],
    errors: [
      { code: "network_error", text: "no hubo respuesta. Reintente con la misma orden." },
      { code: "idempotency_in_flight", text: "la primera sigue en curso. Espere y repita." },
      { code: "idempotency_key_reuse", text: "misma orden con otro contenido. Revise su pedido." },
    ],
    more: [
      recipeLink("Receta 1: Emitir con idempotencia →", "issue-idempotent"),
      referenceLink("issue, getDocumentStatus", "document-status"),
    ],
  },

  invalidate: {
    problem:
      "Un documento sellado tiene un error, o la venta se deshizo. No puede borrarlo ni editarlo: un DTE sellado ya existe para Hacienda. Lo que sí puede hacer es **anularlo**, y eso es un evento fiscal con consecuencias, no un botón de deshacer.",
    steps: [
      {
        title: "Elegir el documento y el tipo.",
        text: "Solo se anula un documento con sello: uno rechazado nunca existió para Hacienda. El tipo 2, rescindir la operación, no lleva documento de reemplazo. El tipo 1, error en la información, pide el código del documento que lo reemplaza y un motivo, así que emita primero el correcto.",
      },
      {
        title: "Decir quién responde.",
        text: "El evento nombra a la persona responsable y a quien solicita, cada una con su tipo de documento (DUI de 9 dígitos, NIT de 14, u otro) y su número. El playground pone a la misma persona en los dos lugares.",
      },
      {
        title: "Anular.",
        text: "Facta DTE arma el evento, lo firma con el certificado del emisor (por eso hace falta la contraseña de firma) y lo envía a Hacienda. No gasta correlativo, pero exige llave de idempotencia.",
        sdk: ["facta.invalidate(codigo, solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte/{codigo}/invalidate"],
      },
      {
        title: "Leer la respuesta.",
        text: "Llega el estado «invalidado» y el sello del evento (`evento.selloRecibido`), que no es el sello del documento: la anulación tiene su propio código de generación y su propio sello.",
      },
    ],
    look: [
      "El estado «invalidado» y el sello del evento de anulación.",
      "En el Registro el documento sigue en la lista, ahora como «Anulada». No desaparece.",
      "Con un documento que ya estaba anulado, la respuesta lo dice (`yaEstabaInvalidado`) en vez de fallar.",
    ],
    use: [
      "La venta se canceló después de emitir.",
      "Se emitió con un dato equivocado y usted ya emitió el documento correcto.",
      "El cliente desistió de la compra (rescisión).",
    ],
    dont:
      "no anule «para probar» ni para deshacer un rechazo. Un documento rechazado no se anula: se corrige y se vuelve a emitir reutilizando su número. Y una anulación no se revierte, tampoco en ambiente de pruebas.",
    rule: "una anulación no se deshace: confirme el documento y el tipo antes de enviarla.",
    concepts: [
      {
        title: "Qué le pasa al documento en Hacienda",
        text: "No desaparece de ningún registro: cambia de estado a invalidado, y el evento queda con su propio sello. No hay forma de revertirlo. Por eso el playground solo le deja anular documentos que usted emitió aquí.",
      },
      {
        title: "Los tres tipos no son intercambiables",
        text: "1, error en la información, y 3, otro, piden motivo y código de reemplazo en el API. El 2, rescisión, no admite reemplazo: nombrarlo es un error. El formulario del playground solo envía el código de reemplazo con el tipo 1.",
      },
      {
        title: "Anular dos veces",
        text: "Pedir la anulación de algo que ya está anulado contesta 200 con `yaEstabaInvalidado: true`. Un reintento que recibiera un error enseñaría a hacer algo peor.",
      },
      {
        title: "Documentos con retornos",
        text: "Un documento que ya tiene un Evento de Retorno no se puede anular: el API contesta `has_return_events` (409).",
      },
    ],
    errors: [
      { code: "invalid_request", text: "falta un dato del evento o tiene mala forma; `details.field` señala cuál." },
      { code: "has_return_events", text: "el documento ya tiene retornos y no se puede anular." },
      { code: "idempotency_key_reuse", text: "esta llave ya se usó con otro motivo o tipo. Aquí la llave es la del documento: cámbiela solo si de verdad es otra operación." },
      { code: "sign_key_required", text: "falta la contraseña de firma." },
      { code: "not_found", text: "ese documento no existe, o es de otra empresa (el API contesta igual en los dos casos)." },
    ],
    more: [
      recipeLink("Receta 3: Consultar estado y recuperar →", "status-recovery"),
      referenceLink("invalidate", "invalidate"),
    ],
  },

  "documents-storage": {
    problem:
      "Su sistema tiene que mostrar facturas anteriores, volver a entregar el PDF a un cliente que lo perdió, o comprobar que cada documento tiene su copia guardada. Eso es leer, no emitir: no gasta correlativos ni cuenta contra su límite.",
    steps: [
      {
        title: "Listar.",
        text: "Devuelve una página de resúmenes (tipo, número de control, estado, fecha) y un cursor `siguiente` para pedir la que sigue. La receta pide la primera página con el tamaño que usted elija y le quita el receptor, que casi ninguna pantalla necesita. Aquí solo ve lo que emitió en el playground.",
        sdk: ["facta.listDocuments({ limit })"],
        http: ["GET /v1/dte"],
      },
      {
        title: "Leer el estado del almacenamiento administrado.",
        text: "Dice si Facta DTE guarda copias de sus documentos, cuánto espacio ocupan y si su almacenamiento propio (BYOS) está listo.",
        sdk: ["facta.getStorageStatus()"],
        http: ["GET /v1/storage/status"],
      },
      {
        title: "Si elige un documento: copias y descarga.",
        text: "Lista las copias del JSON y del PDF, cada una guardada, pendiente o fallida, con su tamaño y su huella sha256, y después descarga el archivo: PDF carta, JSON, o el ticket de rollo térmico, al ancho que elija (de 40 a 120 mm; los rollos comunes son 58 y 80).",
        sdk: ["facta.getDocumentCopies({ generationCode })", "facta.downloadDocument(codigo, \"pdf\")", "facta.downloadDocument(codigo, \"ticket\", { paperWidthMm: 80 })"],
        http: ["GET /v1/storage/copies", "GET /v1/dte/{codigo}/file"],
      },
    ],
    look: [
      "`documents`: la lista sin receptor, y `next` si hay más páginas.",
      "`storage`: si el almacenamiento administrado está listo y cuánto espacio usa.",
      "`copies`: el JSON y el PDF del documento elegido, idealmente en «stored».",
      "Si una parte no está disponible para su llave, aparece su código de error en lugar de romper toda la receta.",
    ],
    use: [
      "Una pantalla de historial de facturas.",
      "Un cliente pide otra vez su factura.",
      "Quiere comprobar que cada documento sellado tiene su copia.",
    ],
    dont:
      "no trate la lista como su contabilidad: son resúmenes y llevan datos personales del receptor, así que manténgalos fuera de los registros generales. Los rechazados no aparecen en el listado; se consultan por su código.",
    rule: "pida una página, siga el cursor `siguiente` tal cual y descargue solo lo que va a usar.",
    concepts: [
      {
        title: "Qué son las copias administradas",
        text: "Cuando Facta DTE sella un documento, además de devolvérselo guarda su JSON y su PDF en un almacenamiento administrado: una copia que usted puede consultar y reparar (`retryDocumentStorage`) sin volver a emitir nada. Es independiente de sus propios destinos (S3, Drive y otros), que se llaman BYOS: «traiga su propio almacenamiento».",
      },
      {
        title: "Archivo DTE y JSON original",
        text: "El **Archivo DTE** es el JSON que recibe su cliente: el documento, su `firmaElectronica` y el `selloRecibido`. El **JSON original** (`raw: true`) es lo que Facta DTE guarda: código, ambiente y la firma. Un documento sin sello, como uno en contingencia, no tiene Archivo DTE: la descarga normal contesta `not_sealed` y solo existe el original. El Archivo DTE como descarga por defecto llega con la próxima versión publicada del SDK; mientras tanto el playground lo arma con documento, firma y sello.",
      },
      {
        title: "Páginas",
        text: "Cada página trae 50 documentos si no pide otra cosa, y el API acepta hasta 100. Siga `siguiente` exactamente como llega.",
      },
    ],
    errors: [
      { code: "forbidden_scope", text: "a la llave le falta un alcance (`query` para listar, `download` para el almacenamiento administrado)." },
      { code: "storage_unsupported", text: "ese API no ofrece copias administradas." },
      { code: "not_sealed", text: "pidió el JSON de un documento sin sello. Use `raw: true` para su original." },
      { code: "not_found", text: "el documento no existe o es de otra empresa." },
    ],
    more: [
      { label: "Guía: almacenamiento y copias →", href: STORAGE_GUIDE_URL },
      referenceLink("listDocuments, downloadDocument", "list-documents"),
    ],
  },

  "catalog-refs": {
    problem:
      "Su catálogo de clientes y productos ya vive en Facta DTE. Copiar nombres, NIT, descripciones y precios en cada solicitud es repetir datos que pueden cambiar. Con identificadores, la solicitud dice **a quién** y **qué**, y el catálogo pone el resto.",
    steps: [
      {
        title: "Ver cómo llega su llave al catálogo.",
        text: "La respuesta de estado dice en `llave.catalogMode` si el dueño de la llave activó el **catálogo legible por la API** o si el catálogo sigue **cifrado** (también existe `plain`, un catálogo guardado sin cifrar que se lee y se escribe por el API).",
        sdk: ["facta.status()"],
        http: ["GET /v1/status"],
      },
      {
        title: "Listar clientes y productos.",
        text: "Lee la copia local del catálogo, que el SDK abre con su `unlockKey`, y muestra los primeros 25 de cada uno con **todos sus campos** (cliente: documento, NRC, actividad, dirección, correo y teléfono; producto: código, unidad, precio, IVA). Aquí los datos personales salen enmascarados; en su servidor llegan completos. Pulse uno para ver su detalle y usar su id.",
        sdk: ["facta.listCustomers()", "facta.listProducts()"],
        http: ["GET /v1/vault/destinations"],
      },
      {
        title: "Emitir con ids.",
        text: "La solicitud lleva `receptor: { customerId }` e `items: [{ productId, cantidad }]` en lugar de nombre, documento, descripción y precio. Con catálogo legible el SDK manda los ids tal cual y el servidor los resuelve; con catálogo cifrado el SDK los sustituye por los datos de su copia local, que tiene que estar al día.",
        sdk: ["facta.issue({ receptor: { customerId }, items: [{ productId, cantidad }] }, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
    ],
    look: [
      "`catalogMode`: «readable» o «encrypted».",
      "Las listas de clientes y productos con su id.",
      "`result`: el documento emitido, si usted eligió un producto. Sin producto, la receta solo lista.",
      "Un dato que usted escriba a mano en la solicitud gana sobre el del catálogo.",
    ],
    use: [
      "Su sistema ya mantiene clientes y productos en Facta DTE.",
      "No quiere copiar precios ni datos de clientes en su propia base.",
      "Quiere que un cambio de precio hecho en Facta DTE se refleje en la siguiente venta.",
    ],
    dont:
      "no espere emitir con un catálogo desactualizado: para un documento fiscal el SDK exige una copia fresca y falla con `not_found` si el id no existe o el producto está inactivo. Además, la Exportación (11) y el Sujeto excluido (14) no tienen `customerId`.",
    rule: "mande ids, no copias: el catálogo manda.",
    concepts: [
      {
        title: "Catálogo cifrado y catálogo legible",
        text: "Por defecto el catálogo está **cifrado**: el servidor lo guarda y solo el SDK, con su `unlockKey`, lo abre en memoria. Si el dueño de la llave activa «Catálogo legible por la API», el servidor puede leerlo y resolver los ids por su cuenta: ya no hace falta `unlockKey` para emitir, y un cambio en el catálogo nunca deja al SDK con una copia vieja.",
      },
      {
        title: "Qué compran customerId y productId",
        text: "Menos datos que mantener en su sistema, un solo lugar donde cambiar un precio o una dirección, y una factura que sale con exactamente lo que dice el catálogo. Los datos escritos a mano en la solicitud siguen ganando, por si una venta necesita una excepción.",
      },
      {
        title: "Listar no emite",
        text: "Solo listar no cuenta contra su límite. Emitir con un producto sí cuenta, y el playground comprueba en el Worker que cada id exista antes de enviarlo.",
      },
    ],
    errors: [
      { code: "not_found", text: "el cliente o el producto no existe, o el producto está inactivo; los detalles nombran el id." },
      { code: "validation_failed", text: "con los datos del catálogo, el documento no cumple el esquema oficial." },
      { code: "idempotency_key_reuse", text: "misma llave con otra cantidad u otro producto. Use una llave nueva." },
    ],
    more: [
      { label: "Guía: catálogo y lecturas sin conexión →", href: CATALOG_GUIDE_URL },
      referenceLink("listCustomers, listProducts, issue", "catalog-read"),
    ],
  },

  "order-webhook": {
    problem:
      "Esto es un **ejemplo de integración**, no una función de Facta DTE: Facta DTE no tiene pedidos. La receta simula el aviso (el webhook) que una tienda en línea de terceros, como Shopify, WooCommerce o la suya propia, envía cuando alguien compra, y muestra cómo el servidor de quien integra lo convierte en una factura con el SDK. Ese aviso suele llegar **más de una vez**; si cada aviso emite, el cliente recibe dos facturas por una sola compra. Aquí la tienda es la «Tienda de ejemplo (ficticia)».",
    steps: [
      {
        title: "Arme el pedido en la tienda de ejemplo.",
        text: "En «1 · Arme el pedido en la tienda de ejemplo» agregue productos de la lista (CAF-250, TAZ-01, ENV-SV), cambie las cantidades, y elija el número de pedido y, si quiere, un cliente. Debajo, «Lo que la tienda manda a su servidor» muestra el JSON que se enviaría, con `orderId` y `lines` (cada una con `sku` y `qty`); puede verlo o editarlo. Pulse «Enviar el pedido».",
      },
      {
        title: "Recibe el aviso.",
        text: "En «2 · Lo que hace su servidor», el primer paso lee el pedido. Un webhook es, simplemente, un aviso que la tienda envía por internet a una dirección de su servidor cuando pasa algo, aquí una compra.",
      },
      {
        title: "Traduce.",
        text: "Su servidor busca cada SKU en SU lista de precios para sacar la descripción y el precio, y el cliente en SU lista para sacar los datos del receptor. Los precios y el total salen siempre de su lista, nunca del aviso.",
      },
      {
        title: "Emite.",
        text: "Con el número de pedido como llave de idempotencia (aquí, `order-ORD-1042`). «La solicitud que salió hacia Facta» muestra lo que se envió, y en «3 · Lo que su servidor responde a la tienda» aparece «200 · Factura sellada» con el número de control.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
      {
        title: "Enviar el mismo aviso otra vez.",
        text: "Simula una doble entrega del mismo pedido: el servidor repite la llamada con la misma llave y le devuelve la misma factura, sin emitir otra.",
        sdk: ["facta.issue(solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte"],
      },
    ],
    look: [
      "En «2 · Lo que hace su servidor», los tres pasos en verde y la solicitud que realmente salió hacia Facta, con las descripciones y precios de su lista.",
      "En «3», «200 · Factura sellada» y su número de control.",
      "Después de «Enviar el mismo aviso otra vez», el aviso azul y el mismo número de control: la misma factura.",
      "En «Si algo no cuadra», los mensajes que da su servidor cuando un SKU o un cliente no existen.",
    ],
    use: [
      "Una tienda en línea, propia o de una plataforma, que avisa cada pedido por webhook.",
      "Una cola de trabajos que puede entregar un mensaje más de una vez.",
      "Cualquier flujo donde «el pedido» ya tiene un identificador estable.",
    ],
    dont:
      "no tome precios ni totales del cuerpo del aviso, no use una llave aleatoria ni la hora de recepción, y no dé por bueno un aviso solo porque llegó a su dirección. Reusar el número de un pedido con otro contenido termina en `idempotency_key_reuse`.",
    rule: "el número de pedido es la llave: el aviso puede llegar dos veces y la factura sale una.",
    concepts: [
      {
        title: "Por qué una tienda manda el mismo aviso dos veces",
        text: "Si su servidor tarda en contestar o la conexión se corta, la tienda no sabe si el aviso llegó, y por seguridad lo reenvía. Prefiere avisar de más que dejar un pedido sin avisar. Por eso su servidor tiene que estar listo para recibir el mismo pedido varias veces.",
      },
      {
        title: "Por qué el número de pedido es la llave",
        text: "El API identifica una operación por su llave dentro de su cuenta. Si la llave es el número de pedido, «este pedido» y «esta operación» son lo mismo, y cualquier repetición cae sobre el documento que ya salió. Una llave aleatoria o la hora de llegada haría de cada reintento una venta nueva.",
      },
      {
        title: "Lo que su servidor debe validar",
        text: "Que cada SKU exista en su lista de precios y que el cliente exista en su lista; si no, rechace el pedido antes de llamar al API, con un mensaje claro, para que no se envíe ni se gaste nada (los dos mensajes de «Si algo no cuadra»). Que las cantidades sean enteros positivos. Y que el total lo calcule usted con sus precios, no la tienda.",
      },
      {
        title: "En una integración real: verifique la firma",
        text: "Cualquiera que conozca la dirección de su servidor podría enviarle un aviso falso. Las tiendas firman cada webhook con un secreto compartido; su servidor debería verificar esa firma antes de hacer nada. El playground no la verifica porque no hay una tienda real detrás.",
      },
      {
        title: "Las 24 horas",
        text: "Una llave se recuerda 24 horas. Si su tienda puede reintentar un aviso días después, guarde también en su base el código de generación de cada pedido y consúltelo antes de emitir: pasado el plazo, la misma llave ya sería una venta nueva.",
      },
    ],
    errors: [
      { code: "idempotency_key_reuse", text: "el mismo número de pedido llegó con otro contenido. Revise qué cambió antes de emitir." },
      { code: "idempotency_in_flight", text: "la entrega anterior del mismo pedido sigue procesándose. Espere y repita." },
      { code: "validation_failed", text: "la solicitud armada no cumple el esquema oficial." },
      { code: "amount_limit", text: "el documento pasa del monto máximo de la llave. Se comprueba antes de reservar: no gasta correlativo." },
    ],
    more: [
      recipeLink("Receta 1: Emitir con idempotencia →", "issue-idempotent"),
      recipeLink("Receta 3: Consultar estado y recuperar →", "status-recovery"),
      referenceLink("issue", "order-webhook"),
    ],
  },

  "deliver-email": {
    problem:
      "Quiere que su cliente reciba el JSON y el PDF por correo sin montar su propio servidor de correo ni hacer esperar la venta. Y quiere que nadie pueda usar su llave del API como relevo para mandar correo con documentos que usted no emitió.",
    steps: [
      {
        title: "Emitir y marcar el correo.",
        text: "`issue` con `deliver: { email }` sella el documento y deja marcado el canal. No espera a que el correo salga. Si el documento se selló, la respuesta trae `entrega.token` y `entrega.venceEn`, cinco minutos después de emitir.",
        sdk: ["facta.issue(solicitud, { idempotencyKey, deliver: { email } })"],
        http: ["POST /v1/dte"],
      },
      {
        title: "Pedir el envío con el token.",
        text: "`deliverEmail` presenta el token. Si Facta DTE ya terminó contesta con el estado final del canal; si todavía trabaja, contesta `en_proceso` (HTTP 202), que no es un error.",
        sdk: ["facta.deliverEmail(codigo, token)"],
        http: ["POST /v1/dte/{codigo}/entrega/correo"],
      },
      {
        title: "Seguir el estado.",
        text: "`waitForDelivery` pregunta cada 2 s, hasta 20 s, hasta que el canal queda final: enviado, fallido y similares. Si se acaba el tiempo devuelve lo último que supo con `settled: false`, sin lanzar error.",
        sdk: ["facta.waitForDelivery(codigo, { channels: [\"correo\"] })"],
        http: ["GET /v1/dte/{codigo}/entrega"],
      },
    ],
    look: [
      "Tras el paso 1: el documento sellado, ya emitido, aunque el correo no haya salido.",
      "Tras el paso 2: el estado del canal, puede ser «en_proceso» al principio.",
      "Al final: «enviado» con la dirección enmascarada, o el motivo si no se pudo entregar.",
      "Con un documento suyo emitido hace menos de 5 minutos y con correo marcado, la receta salta el paso 1.",
    ],
    use: [
      "Quiere que el correo salga solo después de cobrar, no antes.",
      "Quiere separar quién emite de quién envía.",
      "Necesita saber, y mostrar, si el correo llegó a salir.",
    ],
    dont:
      "no guarde el token en el navegador ni en registros: durante cinco minutos es un permiso de envío. Y no espere a `deliverEmail` para dar la venta por emitida: la factura ya estaba sellada en el paso 1.",
    rule: "primero la factura, después el correo, y el correo siempre con el token del documento que acaba de emitir.",
    concepts: [
      {
        title: "Por qué son dos llamadas",
        text: "El token demuestra que quien pide el correo acaba de emitir ese mismo documento: está atado al documento y a su llave de idempotencia. Sin él, cualquiera con una llave del API podría apuntar `deliverEmail` a cualquier código y usarlo para mandar correo con documentos que nunca emitió.",
      },
      {
        title: "Qué protege el token de cinco minutos",
        text: "Pasados los cinco minutos `deliverEmail` contesta `entrega_vencida` (410). El documento sigue sellado y válido; solo se pierde el permiso de ese envío, y `getDelivery` sigue sirviendo para leer el estado. Llamar `deliverEmail` dos veces con el token vigente devuelve el estado actual sin mandar un segundo mensaje.",
      },
      {
        title: "Un canal que falla es un estado",
        text: "Una dirección rechazada o un correo que no pudo salir llega como estado del canal («fallido» y su motivo), no como excepción: el documento ya está emitido y nada de esto lo cambia. Un documento en contingencia no trae token; su canal queda en «esperando_sello».",
      },
      {
        title: "Qué recibe el cliente",
        text: "El documento y su PDF. En el playground se envía el documento de prueba estándar de Facta DTE, sin texto suyo, con límites de 5 por hora, 20 por día y 2 por día a una misma dirección.",
      },
    ],
    errors: [
      { code: "entrega_vencida", text: "pasaron los cinco minutos. El documento sigue sellado; para otro envío tendría que emitir un documento nuevo." },
      { code: "entrega_token_invalido", text: "el token no corresponde a ese documento." },
      { code: "canal_no_marcado", text: "la solicitud de emisión no marcó el correo." },
      { code: "idempotency_key_reuse", text: "esta llave ya emitió otra solicitud. Use una llave nueva para otro documento." },
    ],
    more: [
      { label: "Guía: entrega por correo y WhatsApp →", href: REACT_SERVER_GUIDE_URL },
      { label: "Diseño de los tokens de entrega →", href: DELIVERY_DOC_URL },
      referenceLink("deliverEmail, waitForDelivery", "delivery"),
    ],
  },
  "archivo-dte": {
    problem:
      "Su cliente, su contador o las herramientas de Hacienda esperan un archivo concreto: el **Archivo DTE**. Si usted guarda o entrega otro JSON, a ellos no les sirve, y si más adelante necesita el original firmado, no sabrá cuál de los dos tiene.",
    steps: [
      {
        title: "Leer el estado.",
        text: "La receta consulta el documento para saber si está sellado y cuál es su `selloRecibido`.",
        sdk: ["facta.getDocumentStatus(codigo)"],
        http: ["GET /v1/dte/{codigo}"],
      },
      {
        title: "Descargar el JSON normal.",
        text: "`downloadDocument(codigo, \"json\")` devuelve el Archivo DTE: el documento firmado, su `firmaElectronica` (el JWS, byte por byte) y el `selloRecibido`. Un documento sin sello contesta `not_sealed` (HTTP 409) y la receta lo anota en vez de fallar.",
        sdk: ["facta.downloadDocument(codigo, \"json\")"],
        http: ["GET /v1/dte/{codigo}/file"],
      },
      {
        title: "Pedir el original con raw.",
        text: "Con `{ raw: true }` llega lo que Facta DTE guardó: `{ codigoGeneracion, ambiente, jws }`. Es el único JSON que tiene un documento en contingencia.",
        sdk: ["facta.downloadDocument(codigo, \"json\", { raw: true })"],
        http: ["GET /v1/dte/{codigo}/file"],
      },
      {
        title: "Reconstruir y comparar.",
        text: "`archivoDteOf` arma el mismo texto a partir del JWS y del sello. Si coincide con lo que mandó el servidor, el resultado dice `rebuiltMatches: true`.",
      },
    ],
    look: [
      "`jsonFormat`: «archivo-dte» para la descarga normal.",
      "`rebuiltMatches`: true cuando el texto reconstruido es idéntico al descargado. Solo se calcula en documentos sellados.",
      "`notSealed`: true si el documento no tiene sello todavía; entonces solo existe `archivoJson`.",
      "En la página aparecen dos archivos: `<código>.json` (Archivo DTE) y `<código>.raw.json` (original).",
    ],
    use: [
      "Va a entregar el JSON a un cliente o a un contador.",
      "Guarda copias propias y quiere saber cuál archivo guardar para cada fin.",
      "Quiere comprobar que lo que guardó es exactamente lo que firmó Hacienda.",
    ],
    dont:
      "no entregue el JSON original a un receptor como si fuera el Archivo DTE, ni vuelva a serializar el documento por su cuenta: la firma se calcula sobre bytes exactos y una copia reescrita ya no coincide.",
    rule: "al receptor, el Archivo DTE; para su archivo, el original con `raw: true`.",
    concepts: [
      {
        title: "Qué contiene cada archivo",
        text: "El **Archivo DTE** es el documento más `firmaElectronica` y `selloRecibido`: lo que espera quien recibe. El **original** guarda el código, el ambiente y la firma (`jws`), de donde sale el documento. Los dos dicen lo mismo; solo el primero lleva el sello de Hacienda a la vista.",
      },
      {
        title: "Y si el documento está en contingencia",
        text: "Todavía no tiene sello de Hacienda, así que no hay Archivo DTE: la descarga normal contesta `not_sealed` y solo existe el original.",
      },
    ],
    errors: [
      { code: "not_sealed", text: "el documento no tiene sello (por ejemplo, en contingencia). Use `raw: true` para su original." },
      { code: "not_found", text: "el documento no existe o es de otra empresa." },
      { code: "forbidden_scope", text: "a la llave le falta el alcance para consultar o descargar." },
    ],
    more: [
      referenceLink("el Archivo DTE y raw", "archivo-dte"),
      recipeLink("Receta 5: Listar y descargar →", "documents-storage"),
    ],
  },

  "region-timings": {
    problem:
      "Una emisión tarda más de lo que usted esperaba y no sabe si es su red, la API o Hacienda. Sin medir, es adivinar; y si su servidor está lejos de donde corre la API, cada llamada paga ese viaje extra.",
    steps: [
      {
        title: "Leer la región.",
        text: "`region()` dice qué región manda el cliente en el encabezado `x-region`: la que usted fijó o la que la API anunció en `/v1/status`.",
        sdk: ["facta.region()"],
        http: ["GET /v1/status"],
      },
      {
        title: "Pedir tiempos solo en una llamada.",
        text: "La receta llama `status` con `debug: { timings: true }`. El interruptor del cliente sigue apagado: lo pedido vale para esa llamada.",
        sdk: ["facta.status({ debug: { timings: true } })"],
        http: ["GET /v1/status"],
      },
      {
        title: "Ver quién respondió.",
        text: "`servedRegion` dice qué región atendió la última llamada. Con los tiempos, la API devuelve sus pasos en `result.debug`.",
        sdk: ["facta.servedRegion"],
      },
    ],
    look: [
      "`functionsRegion`: la región que el cliente fija en cada petición.",
      "`servedFrom`: la región que respondió de verdad.",
      "`apiRegion`: la región que reporta el estado de la API.",
      "`debug`: cada paso con sus milisegundos y el total, si la API los devolvió.",
    ],
    use: [
      "Su integración corre en otra región y las emisiones le parecen lentas.",
      "Quiere saber en qué paso se va el tiempo antes de optimizar.",
      "Va a fijar la región en su configuración y quiere confirmarla.",
    ],
    dont:
      "no deje los tiempos encendidos en tráfico de producción: son una ayuda para depurar y están apagados por defecto. Pídalos en la llamada que quiere medir.",
    rule: "fije la región cerca de la API y mida con tiempos solo cuando lo necesite.",
    concepts: [
      {
        title: "Por qué importa la región",
        text: "Las funciones de la API corren junto a la base de datos, no junto a quien llama. En una medición del equipo, fijar cada petición a esa región bajó `POST /v1/dte` de 7.2 s a 4.3 s. El cliente la aprende solo la primera vez; puede fijarla con `region: \"us-west-2\"`, con `config.region` o con la variable `FACTA_API_REGION`, o apagarla con `region: false`.",
      },
      {
        title: "Dónde se ven los tiempos",
        text: "El resultado trae `{ timings: [{ step, ms }], totalMs }`. Si el cuerpo de la respuesta no los trae, el SDK los lee del encabezado `Server-Timing`. El interruptor «Mostrar tiempos» de las otras recetas usa exactamente esto.",
      },
    ],
    errors: [
      { code: "invalid_api_key", text: "la llave no sirve; sin ella no hay lectura de estado." },
      { code: "service_unavailable", text: "algo de Facta DTE no contestó. El SDK reintenta solo; si persiste, repita en unos segundos." },
      { code: "network_error", text: "no hubo respuesta de la API." },
    ],
    more: [
      referenceLink("región", "region"),
      referenceLink("tiempos por paso", "timings"),
    ],
  },

  diagnose: {
    problem:
      "Descubrir que una llave de pruebas está en producción, que le falta un alcance o que el certificado no está registrado **en la primera venta** es descubrirlo con un cliente esperando. Conviene saberlo al arrancar.",
    steps: [
      {
        title: "Diagnosticar.",
        text: "`diagnose()` revisa la llave y su ambiente, los alcances, la llave de firma, el certificado, las revisiones del catálogo y de los destinos, y la función de emergencia. Cada revisión sale en `ok`, `warning`, `blocked` o `unknown`, con un mensaje de qué hacer.",
        sdk: ["facta.diagnose()"],
        http: ["GET /v1/status"],
      },
      {
        title: "Ver el estado del catálogo.",
        text: "`catalogState()` dice cómo llega la llave al catálogo (`encrypted`, `readable` o `plain`) y si la copia local está `fresh`, `stale` o `missing`.",
        sdk: ["facta.catalogState()"],
        http: ["GET /v1/status"],
      },
    ],
    look: [
      "Las revisiones en `diagnostics`: busque las que no están en «ok».",
      "`catalog.catalogMode` y `catalog.freshness`.",
      "Ninguna de las dos llamadas abre bóvedas, reserva correlativos ni envía documentos.",
    ],
    use: [
      "Al arrancar su servicio, antes de aceptar ventas.",
      "En un endpoint de salud que su monitoreo consulta.",
      "Con `config.expectedEnvironment` y `requiredScopes`, para que una llave de pruebas en producción aparezca aquí y no en la primera venta.",
    ],
    dont:
      "no confunda «ok» con «puede emitir hoy»: el diagnóstico lee el estado, no emite. Una venta real puede fallar por datos del documento aunque todas las revisiones estén en verde.",
    rule: "diagnostique al arrancar y trate cada «blocked» como una venta que todavía no falló.",
    concepts: [
      {
        title: "Lo que diagnose no hace",
        text: "Solo lee `/v1/status`. No desencripta nada, no reserva números de control y no manda documentos, así que puede llamarlo con la frecuencia que su monitoreo necesite sin efectos fiscales.",
      },
    ],
    errors: [],
    noErrors:
      "`diagnose()` no lanza el fallo de la API: lo devuelve como una revisión bloqueada dentro del informe, y `catalogState()` informa el suyo en el resultado.",
    more: [
      referenceLink("diagnóstico", "diagnose"),
      referenceLink("estado del catálogo", "catalog-state"),
    ],
  },

  "delivery-status": {
    problem:
      "Emitió un documento con correo marcado y quiere saber, ahora o mañana, si el correo salió. El token de entrega vence a los cinco minutos, pero la pregunta «¿llegó?» no vence.",
    steps: [
      {
        title: "Elegir un documento suyo.",
        text: "Es el único dato de la receta. Funciona con cualquiera que usted haya emitido aquí, con o sin canales marcados.",
      },
      {
        title: "Leer el estado de la entrega.",
        text: "`getDelivery` devuelve cada canal marcado con su estado, el destino enmascarado (`m•••@ejemplo.com`), un motivo estable y la hora del último cambio.",
        sdk: ["facta.getDelivery(codigo)"],
        http: ["GET /v1/dte/{codigo}/entrega"],
      },
    ],
    look: [
      "`canales`: un estado por canal. Los no finales son `pendiente` y `en_proceso`; el resto ya es definitivo.",
      "`destino` enmascarado: la dirección completa nunca vuelve.",
      "`motivo`: la razón estable cuando el estado no es `enviado`.",
    ],
    use: [
      "Una pantalla de «Estado del envío» en su sistema.",
      "Después de que venció el token de cinco minutos.",
      "Para decidir si avisarle al cliente que su correo no salió.",
    ],
    dont:
      "no trate un canal fallido como un error de su programa: es un estado del documento, que ya está emitido, y nada de eso lo cambia.",
    rule: "el token vence, el estado se puede leer siempre.",
    concepts: [
      {
        title: "Los estados de un canal",
        text: "`pendiente` y `en_proceso` son los únicos que todavía pueden cambiar. Los finales son `enviado`, `fallido`, `sin_credito`, `sin_consentimiento`, `no_permitido` y `vencido`; `esperando_sello` es el de un documento en contingencia, que aún no tiene sello.",
      },
      {
        title: "Esperar a que termine",
        text: "`waitForDelivery` consulta el mismo estado cada cierto tiempo hasta que cada canal queda final; la receta 8 lo usa.",
      },
    ],
    errors: [
      { code: "not_found", text: "el documento no existe o es de otra empresa." },
      { code: "forbidden_scope", text: "a la llave le falta el alcance para consultar." },
    ],
    more: [
      recipeLink("Receta 8: Entregar por correo →", "deliver-email"),
      referenceLink("estado de la entrega", "delivery-status"),
    ],
  },

  "register-return": {
    problem:
      "El cliente devuelve parte de lo que compró. No es una anulación (la venta existió), ni un documento nuevo: es un **Evento de Retorno** sobre la factura original, que descuenta unidades de una línea.",
    steps: [
      {
        title: "Elegir el documento, la línea y la cantidad.",
        text: "Solo sirve para una Factura (01), una Exportación (11) o un Sujeto excluido (14), sellada y emitida por este API. Las líneas se cuentan desde 1, como las lee una persona en la factura.",
      },
      {
        title: "Registrar el retorno.",
        text: "Facta DTE arma el evento con su propio código y su propio sello, lo firma con el certificado del emisor (por eso hace falta la contraseña de firma) y lo envía a Hacienda. No gasta correlativo, pero exige llave de idempotencia.",
        sdk: ["facta.registerReturn(codigo, solicitud, { idempotencyKey })"],
        http: ["POST /v1/dte/{codigo}/return"],
      },
      {
        title: "Leer lo que queda.",
        text: "La respuesta trae `disponible`: cuánto queda por devolver de cada línea. Si Hacienda no contestó, llega `estado: \"firmado\"` (HTTP 202): repita la llamada con la **misma** llave y se reenvía el mismo evento.",
      },
    ],
    look: [
      "El evento sellado, con su propio sello, distinto del de la factura.",
      "`disponible` por línea: la próxima devolución no puede pasar de ahí.",
      "Si queda en `firmado`, use «Reintentar igual» y verá que sale el mismo evento.",
    ],
    use: [
      "El cliente devuelve unidades de una venta ya facturada.",
      "Quiere registrar varias devoluciones parciales sobre el mismo documento.",
      "No quiere anular ni emitir una nota de crédito para esa devolución.",
    ],
    dont:
      "no lo use para corregir un documento de otro tipo (se corrige con una nota de crédito) ni espere deshacerlo: un retorno sellado impide anular ese documento después.",
    rule: "devuelva solo lo disponible, con una llave por devolución y la misma llave al reintentar.",
    concepts: [
      {
        title: "Cuánto tiempo hay para registrarlo",
        text: "El plazo es de tres meses desde que se generó o selló el documento (lo que termine primero), o dos años para facturas de ciertas actividades económicas. Fuera de ese plazo contesta `return_window_closed`.",
      },
      {
        title: "Cantidad o no gravado",
        text: "Cada línea del retorno lleva **una** de dos cosas: `cantidad` (las unidades que regresan) o `noGravado` (un cargo o crédito fuera de la base gravada). El formulario de la receta usa cantidad.",
      },
    ],
    errors: [
      { code: "return_exceeds_available", text: "pidió más de lo que queda de esa línea; `details.lineas` dice cuánto." },
      { code: "return_window_closed", text: "la fecha del evento es anterior al documento, futura o fuera del plazo." },
      { code: "return_type_not_allowed", text: "el documento no es 01, 11 ni 14. Use una nota de crédito." },
      { code: "has_return_events", text: "al intentar anular un documento que ya tiene retornos." },
      { code: "idempotency_key_reuse", text: "la misma llave con otra devolución. Use una llave nueva para cada una." },
    ],
    more: [
      recipeLink("Receta 4: Anular un documento →", "invalidate"),
      referenceLink("Evento de Retorno", "return-event"),
    ],
  },

  "reference-clock": {
    problem:
      "El SDK escribe sus propias marcas de tiempo (los registros de un archivo local, las firmas de las subidas a S3). Si el reloj de su servidor se desajustó, esas marcas salen mal y las firmas pueden ser rechazadas.",
    steps: [
      {
        title: "Tomar el reloj del cliente.",
        text: "`facta.clock` es el reloj de referencia; vale `null` si lo apagó con `clock: false`.",
        sdk: ["facta.clock"],
      },
      {
        title: "Calibrar si hace falta.",
        text: "`ensure()` consulta `clock.factadte.com` solo cuando sus reglas lo piden, con tres muestras al estilo NTP, y después mide con el reloj monotónico. Ninguna de las dos llamadas, `ensure()` ni `calibrate()`, lanza error.",
      },
      {
        title: "Comparar.",
        text: "La receta muestra la hora corregida junto a la del equipo, y el estado del reloj: `calibrated`, `provisional` o `device`.",
      },
    ],
    look: [
      "`corrected` y `device`: la diferencia es la corrección que aplicó el reloj.",
      "`state.status`: «calibrated» tras calibrar; «device» si el servicio no respondió y usó el reloj del equipo.",
      "`state.offsetMs` y `state.uncertaintyMs`: cuánto se corrigió y cuánto error puede quedar.",
    ],
    use: [
      "Su servidor corre en un equipo cuyo reloj no controla.",
      "Usa archivo local o subidas a S3 y quiere marcas confiables.",
      "Quiere compartir un mismo reloj con otros adaptadores.",
    ],
    dont:
      "no espere que este reloj cambie la fecha o la hora de un documento: eso lo pone siempre el servidor de Facta DTE.",
    rule: "el reloj de referencia es para lo que escribe el SDK, no para lo que firma Hacienda.",
    concepts: [
      {
        title: "Qué pasa si el servicio no responde",
        text: "El SDK usa el reloj del equipo y ninguna operación falla; después de un fallo no reintenta durante un tiempo. Por eso `state.status` puede decir «device».",
      },
      {
        title: "Compartirlo",
        text: "`createReferenceClock` construye un reloj independiente, y puede pasarle `facta.clock` a otros adaptadores, por ejemplo `createS3ArtifactDestination({ clock: facta.clock ?? false })`.",
      },
    ],
    errors: [],
    noErrors: "El reloj nunca lanza errores: si no puede calibrar, sigue con el reloj del equipo y lo dice en `state.status`.",
    more: [
      referenceLink("el reloj de referencia", "reference-clock"),
    ],
  },

  "service-info": {
    problem:
      "Antes de integrar, o cuando algo falla, necesita saber lo básico sin emitir nada: si la API está viva, qué ambiente es esta llave, qué puede hacer y qué documento publica el servidor como contrato.",
    steps: [
      {
        title: "Saber el ambiente sin llamar a nadie.",
        text: "`facta.environment` sale del prefijo de la llave (`facta_test_` es «00», pruebas; `facta_live_` es «01», producción) y no hace ninguna petición.",
        sdk: ["facta.environment"],
      },
      {
        title: "Leer el estado.",
        text: "`status()` es la comprobación de salud: ambiente, alcances y tipos de documento de la llave, cómo llega al catálogo, los límites que le quedan y la región de la API. Tiene su propia ventana de límite, aparte de la de emitir.",
        sdk: ["facta.status()"],
        http: ["GET /v1/status"],
      },
      {
        title: "Pedir el contrato.",
        text: "`getContract()` devuelve el documento OpenAPI que publica el servidor, la autoridad sobre cada campo HTTP.",
        sdk: ["facta.getContract()"],
        http: ["GET /v1/openapi.json"],
      },
    ],
    look: [
      "`environment`: «00» o «01», igual que el de `health.ambiente`.",
      "`key`: los alcances, los tipos de DTE y el `catalogMode` de su llave.",
      "`limits`: lo que queda de cada techo.",
      "`contract`: título, versión y las rutas que ofrece la API.",
    ],
    use: [
      "Como comprobación de salud de su integración.",
      "Para mostrar en pantalla con qué llave y qué ambiente está trabajando.",
      "Para descargar el contrato y generar su propio cliente o probarlo en Postman.",
    ],
    dont:
      "no use el contrato como sustituto de los tipos del SDK al escribir código: el SDK ya conoce sus campos. El contrato es la referencia cuando algo no cuadra.",
    rule: "preguntar el estado es barato y seguro; hágalo antes de suponer.",
    errors: [
      { code: "invalid_api_key", text: "la llave no sirve." },
      { code: "key_expired", text: "la llave venció; `venceEl` en el estado dice cuándo." },
      { code: "rate_limited", text: "alcanzó la ventana propia de consulta de estado; espere lo que indique `details.retryAfterSeconds`." },
    ],
    more: [
      referenceLink("estado, llave y contrato", "environment"),
      recipeLink("Receta 11: Diagnóstico y estado del catálogo →", "diagnose"),
    ],
  },

  "emergency-store": {
    problem:
      "Facta DTE guarda cada documento sellado en almacenamiento duradero. Si por alguna razón no pudo guardarlo en ningún sitio, la única copia es una temporal que dura una hora. Esa es la emergencia: sin su ayuda, el documento puede perderse.",
    steps: [
      {
        title: "Usted escribe una función.",
        text: "`runtime.emergencyStore` recibe el Archivo DTE, el JSON original, el PDF y lo que pasó, y los guarda donde usted quiera. El SDK no trae almacenamiento propio.",
      },
      {
        title: "El SDK la llama solo en emergencia.",
        text: "Una sola vez por documento, y solo si el servidor avisó que no pudo guardar (por ejemplo `sin_almacenamiento_duradero`) o toda la replicación falló. Aquí la emergencia es simulada: una API en memoria contesta con la advertencia que usted elija.",
        sdk: ["facta.issue(solicitud)"],
      },
      {
        title: "Leer el informe.",
        text: "El resultado de emitir trae `emergency`: si se guardó (`saved`), por qué (`reason`) y un texto de qué hacer si no. Si su función falla, el documento sellado sigue sellado y el informe dice `store_failed`.",
      },
    ],
    look: [
      "`report.saved` y `report.reason`: el disparador cuando se guardó, o `not_configured` / `store_failed` cuando no.",
      "`calledYourFunction`: lo que recibió su función, con los tamaños de cada archivo.",
      "Con `sin_copia_en_servidor`, el informe es crítico: ni siquiera quedó la copia temporal.",
    ],
    use: [
      "Su integración no puede perder un documento sellado bajo ninguna circunstancia.",
      "Quiere un último recurso propio, además del que Facta DTE ofrece.",
      "Quiere ver, sin riesgo, cómo se comporta su función antes de una emergencia real.",
    ],
    dont:
      "no la use como almacenamiento normal: es el último recurso. Y no la haga lanzar error para «detener» la emisión: un fallo suyo no convierte un documento sellado en un error.",
    rule: "guarde primero, y deje que el informe le diga si lo logró.",
    concepts: [
      {
        title: "Esta receta no es real",
        text: "El playground nunca provoca una emergencia real ni escribe en ningún almacenamiento: no usa la API de Facta DTE, no emite nada y solo muestra lo que recibiría su función.",
      },
      {
        title: "Opcional",
        text: "Sin función configurada, el informe dice `not_configured` y Facta DTE envía una copia al correo del dueño. Los archivos del resultado quedan igualmente en su mano; guárdelos.",
      },
      {
        title: "Y después",
        text: "`facta.emergency.replicate` reintenta la replicación normal con los archivos que su función guardó.",
      },
    ],
    errors: [],
    noErrors: "La emergencia nunca se vuelve un error del SDK: un fallo de su función aparece como `store_failed` en el informe.",
    more: [
      referenceLink("salvaguarda de emergencia", "emergency"),
      { label: "Guía: adaptadores de almacenamiento →", href: STORAGE_GUIDE_URL },
    ],
  },

};
