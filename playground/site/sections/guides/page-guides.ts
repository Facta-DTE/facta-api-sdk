// «Cómo funciona esta pantalla»: the light guide at the top of every «Pantallas React» component, of
// «Mi propia implementación» and of «Registro». Same rules as server/guides.ts: each claim comes from the
// example's source, the React guides in guides/ or the SDK, and test/guides.test.ts checks what it can.

import { REACT_GUIDE_URL, REACT_SERVER_GUIDE_URL, SDK_REFERENCE } from "./links.ts";
import type { PageGuide } from "./types.ts";

const REACT = { label: "Guía de React: la ventana de emisión →", href: REACT_GUIDE_URL };
const REACT_SERVER = { label: "Guía del lado del servidor →", href: REACT_SERVER_GUIDE_URL };

/** The five windows share their story; only the shape differs. */
const WINDOW_LOOK = [
  "Tres modos con el selector «Modo»: `manual` (usted revisa y pulsa Emitir), `auto` (emite al abrir) y `auto-close` (emite, muestra el resultado y se cierra).",
  "Los estados de la ventana: revisión, emitiendo, verificando, sellado, contingencia, rechazado, fallido o vencido.",
];

export const PAGE_GUIDES: Record<string, PageGuide> = {
  // ---------------------------------------------------------------- Pantallas React: Emitir
  dialog: {
    problem: "Quiere que su cliente o su cajero confirme y emita sin salir de la pantalla en la que está, sin escribir usted la revisión, el progreso ni el resultado.",
    what: "`FactaInvoiceDialog` es una ventana modal: un diálogo centrado en el escritorio y una hoja desde abajo en el teléfono. Su servidor crea una **sesión** con la venta ya armada; la ventana solo la muestra, la emite y enseña el resultado. El navegador nunca escribe el documento fiscal.",
    look: ["Prepare una venta arriba y abra el diálogo.", ...WINDOW_LOOK, "«Respuesta» en el código muestra lo que el servidor contestó, sin llaves ni archivos."],
    sdk: ["FactaInvoiceDialog"],
    more: [REACT, REACT_SERVER],
  },
  drawer: {
    problem: "Su pantalla tiene que seguir visible mientras se emite: la lista de productos, el carrito, el detalle del pedido.",
    what: "`FactaInvoiceDrawer` es la misma ventana que el diálogo, pero como panel lateral. Cambia la forma, no el comportamiento: sesión creada por su servidor, mismos modos y mismos estados.",
    look: ["Abra el panel con una venta preparada.", ...WINDOW_LOOK],
    sdk: ["FactaInvoiceDrawer"],
    more: [REACT, REACT_SERVER],
  },
  inline: {
    problem: "No quiere ventanas flotantes: quiere el flujo de emisión como una parte más de su página.",
    what: "`FactaInvoiceInline` pinta la ventana dentro de su propio diseño, sin fondo oscuro ni capa encima. Con `run=\"auto\"` empieza a emitir en cuanto se monta, por eso este ejemplo solo la monta cuando usted lo pide.",
    look: ["Pulse «Mostrar la ventana en línea» con una venta preparada.", ...WINDOW_LOOK],
    sdk: ["FactaInvoiceInline"],
    more: [REACT, REACT_SERVER],
  },
  button: {
    problem: "En un punto de venta no hay sitio para una ventana: hay un botón y un cobro que no puede esperar.",
    what: "`FactaIssueButton` es un solo botón: se vuelve un indicador de progreso y luego una marca de verificación, y un globo pequeño lleva el resultado. Con `auto` y `auto-close` empieza al montarse, y `auto-close` no muestra el globo de éxito.",
    look: ["Pulse «Mostrar el botón» con una venta preparada.", "Cambie el «Modo»: con `auto` y `auto-close` el botón empieza a emitir en cuanto se monta."],
    sdk: ["FactaIssueButton"],
    more: [REACT, REACT_SERVER],
  },
  window: {
    problem: "Quiere abrir la ventana desde su código, por ejemplo al terminar un formulario, sin dejar un componente en su JSX esperando.",
    what: "`useFactaWindow().open(sesión, opciones)` abre la ventana y devuelve una promesa con el resultado. Si la persona la cierra sin emitir, la promesa se rechaza con `FactaWindowError`: su código decide qué hacer en cada caso.",
    look: ["Pulse el botón y emita: debajo aparece «Emitida:» con el número de control.", "Cierre la ventana sin emitir: aparece «Sin documento:» con el motivo."],
    sdk: ["useFactaWindow"],
    more: [REACT, REACT_SERVER],
  },

  // ---------------------------------------------------------------- Después de emitir
  receipt: {
    problem: "Después de emitir, su cliente necesita ver que el documento quedó sellado, con su número y su total, sin que usted vuelva a llamar al API.",
    what: "`FactaReceipt` dibuja un comprobante compacto a partir de un resultado que usted ya tiene en la mano: no hace ninguna llamada. Si todavía no emitió nada en esta visita, usa su último documento del playground para que no se vea vacío.",
    look: ["El comprobante, el estado y los botones de descarga en una sola fila.", "Cuando la venta pidió correo, aparece la fila «Entrega»."],
    sdk: ["FactaReceipt"],
    more: [REACT, REACT_SERVER],
  },
  badge: {
    problem: "En una lista o una cabecera necesita decir en una palabra en qué estado está un documento.",
    what: "`FactaStatusBadge` recibe el `estado` del documento (sellado, rechazado, contingencia, invalidado…) y dibuja la etiqueta con su color y su texto. No llama al API.",
    look: ["La etiqueta junto al comprobante de la página.", "Cambia de color y de texto según el estado del último documento."],
    sdk: ["FactaStatusBadge"],
    more: [REACT, REACT_SERVER],
  },
  download: {
    problem: "Su cliente quiere el PDF, el JSON o el ticket, y usted no quiere armar tres rutas de descarga.",
    what: "`FactaDownloadButton` pide a su servidor el archivo del documento (`pdf`, `json` o `ticket` de 80 mm) y lo guarda. El botón de JSON entrega el Archivo DTE: el documento con su firma y su sello. Con la propiedad `rawJson` también puede ofrecer el JSON original, y el servidor solo lo atiende si usted lo habilitó.",
    look: ["Los tres botones juntos y el de JSON suelto, en versión pequeña.", "El archivo sale de su servidor: este playground solo sirve códigos que usted emitió."],
    sdk: ["FactaDownloadButton"],
    more: [REACT, REACT_SERVER],
  },

  // ---------------------------------------------------------------- Entrega
  delivery: {
    problem: "Su cliente espera su factura en el correo y usted no quiere que la venta se quede esperando a que el correo salga.",
    what: "Su servidor **marca** el canal al crear la sesión (`deliver: { email }`) y la ventana solo sigue el estado con `onDelivery`: una fila por canal, «Enviando correo…» y después «Correo enviado a…» o el motivo. Cerrar la ventana nunca depende de la entrega. El navegador no puede añadir ni cambiar `deliver`.",
    look: ["Una dirección que usted escribe y el aviso de límites del playground.", "La fila «Entrega» dentro de la ventana, con la dirección enmascarada.", "La pestaña «Solo servidor» del código lleva a la receta de las dos llamadas, sin navegador."],
    sdk: ["FactaInvoiceDialog"],
    more: [
      { label: "Guía: entrega por correo y WhatsApp →", href: REACT_SERVER_GUIDE_URL },
      { label: "Receta 8: Entregar por correo →", to: "/servidor?receta=deliver-email" },
    ],
  },

  // ---------------------------------------------------------------- Datos
  list: {
    problem: "Necesita una pantalla de documentos con filtros, descargas y detalle, y no quiere construirla tabla por tabla.",
    what: "`FactaDocumentList` es una tabla (tarjetas en el teléfono) con filtros, descargas y un panel de detalle. Su servidor decide qué puede leer el navegador. «Anular» no anula desde el navegador: le pide a SU servidor una sesión de anulación, que solo la concede para documentos de este visitante.",
    look: ["La lista con los documentos de la cuenta de pruebas.", "Una fila de otra persona contesta con el mensaje de su servidor, no con un fallo del API."],
    sdk: ["FactaDocumentList"],
    more: [REACT, REACT_SERVER],
  },
  detail: {
    problem: "Quiere abrir un documento y ver su estado, sus totales y sus acciones sin escribir esa pantalla.",
    what: "`FactaDocumentDetail` muestra un documento por su código de generación, en línea o como panel lateral. Lee del servidor lo que su manejador le permita y ofrece la anulación por el mismo camino que la lista.",
    look: ["Elija uno de los documentos que usted emitió aquí.", "Compare la vista en línea con «Abrir como panel lateral»: es el mismo contenido."],
    sdk: ["FactaDocumentDetail"],
    more: [REACT, REACT_SERVER],
  },
  pickers: {
    problem: "Al armar una venta, la persona tiene que elegir un cliente y productos de un catálogo que puede tener cientos de filas.",
    what: "`FactaCustomerPicker` y `FactaProductPicker` son dos buscadores sobre el catálogo de la cuenta. El navegador solo recibe el `id` elegido; su servidor arma la venta con `customerId` y `productId`. Necesitan una llave con catálogo legible; sin una, el playground muestra sus datos de demostración.",
    look: ["Escriba para buscar y elija: debajo aparecen el id del cliente y los de los productos.", "Si el catálogo no está disponible, la página lo dice y lista los datos de demostración."],
    sdk: ["FactaCustomerPicker", "FactaProductPicker"],
    more: [REACT, { label: "Receta 6: Referencias del catálogo →", to: "/servidor?receta=catalog-refs" }],
  },
  status: {
    problem: "Antes de cobrar quiere saber si el servicio de Facta DTE está respondiendo, y mostrárselo al cajero sin que él tenga que preguntar.",
    what: "`FactaServiceStatus` dice lo que el API informa de sí mismo: una pastilla para una página y un punto para la cabecera de un punto de venta. Es público, consulta cada 60 segundos y se pausa mientras la pestaña está oculta.",
    look: ["La pastilla y el punto, uno junto al otro.", "El color y el texto siguen el estado del servicio: en línea, contingencia, degradado o sin conexión."],
    sdk: ["FactaServiceStatus"],
    more: [REACT, REACT_SERVER],
  },

  // ---------------------------------------------------------------- Más
  invalidate: {
    problem: "Hay que anular un documento sellado, y una anulación es irreversible: el navegador no debe poder pedirla por su cuenta.",
    what: "La anulación nunca nace en el navegador. Su servidor comprueba que el documento sea de este visitante, pone el nombre de los responsables y contesta una sesión; `useFactaActions().invalidate(sesión)` solo la presenta y muestra lo que contestó Hacienda. Es irreversible incluso en pruebas.",
    look: ["Elija un documento emitido aquí y, si quiere, escriba un motivo.", "El resultado trae el sello del evento, o «El documento ya estaba anulado»."],
    sdk: ["useFactaActions"],
    more: [REACT, { label: "Receta 4: Anular un documento →", to: "/servidor?receta=invalidate" }],
  },
  studio: {
    problem: "La ventana tiene que parecerse a su marca, no a la de Facta DTE, y usted quiere saber qué se puede cambiar sin escribir CSS desde cero.",
    what: "El estudio ajusta la apariencia en tres capas, de lo grueso a lo fino: **tokens** (`appearance`: tema, densidad, movimiento y variables como `accent` o `radius`), **`styles` y `classNames`** por pieza, y **atributos `data-facta-*`** para su propio CSS. Mientras cambia las opciones, el código de abajo se actualiza.",
    look: ["Cambie un preset o un color y vea la ventana y el comprobante al instante.", "Copie el código que genera para su propio proyecto."],
    sdk: ["FactaProvider"],
    more: [REACT],
  },

  // ---------------------------------------------------------------- Other pages
  headless: {
    problem: "Ya tiene su propio diseño, sus propios botones y su propio teclado, y solo necesita el flujo de emisión de Facta DTE.",
    what: "Los tres ejemplos no usan ningún componente visual del SDK. El primero usa `createFactaClient` y `createIssueFlow`, sin React; el segundo usa `useFactaIssue` con su teclado y sus estados; el tercero deja que una casilla decida si su servidor arma una Factura o un Crédito fiscal. En los tres el servidor arma el documento y el navegador solo sigue el flujo.",
    look: ["Cada ejemplo emite de verdad contra staging.", "Todos muestran los mismos estados del flujo: emitiendo, sellada, contingencia, rechazada y sesión vencida.", "«Ver el código» abre el archivo que corre, de menos de 60 líneas."],
    sdk: ["createFactaClient", "createIssueFlow", "useFactaIssue"],
    more: [REACT, REACT_SERVER, { label: "Referencia del SDK →", href: SDK_REFERENCE.href }],
  },
  registro: {
    problem: "Después de varias pruebas necesita ver qué emitió, en qué estado quedó cada documento y bajar sus archivos.",
    what: "El Registro es su propio historial en el playground: solo los documentos que usted emitió aquí, los últimos 200. Cada uno guarda su total al emitirse; el estado solo se consulta al API cuando puede haber cambiado. Los archivos salen por el manejador del SDK, que solo sirve códigos suyos.",
    look: [
      "«PDF», «JSON DTE» (el Archivo DTE: documento, firma y sello) y «Raw» (el JSON original almacenado).",
      "Un documento rechazado explica el motivo de Hacienda sin que usted pulse nada; uno en contingencia ofrece «Consultar estado».",
      "«Anular» envía un evento irreversible, también en pruebas.",
    ],
    more: [
      { label: "Receta 5: Listar y descargar →", to: "/servidor?receta=documents-storage" },
      { label: "Receta 4: Anular un documento →", to: "/servidor?receta=invalidate" },
    ],
  },
};
