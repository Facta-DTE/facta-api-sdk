// What the page needs to draw each recipe: pure data, shared by the Worker (which
// validates the same names) and the site. No secrets, no Worker imports.

export type FieldKind = "select" | "text" | "textarea" | "checkbox" | "number" | "issued";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: string; label: string }>;
  default?: string | boolean | number;
  help?: string;
  /** Shown only while this checkbox field is unchecked. */
  hideWhen?: string;
  /** `issued` pickers: the document is required to run. */
  required?: boolean;
}

export interface StageSpec {
  id: string;
  label: string;
}

export interface RecipeSpec {
  id: string;
  title: string;
  summary: string;
  /** File under `server/recipes/` (the one shown and executed). */
  file: string;
  fields: FieldSpec[];
  /** Ordered stages when one run needs more than one call (`prepare` → `sign`). */
  stages?: StageSpec[];
  /** True when running it issues or invalidates a document (it counts against the quota). */
  consumesQuota: boolean;
  /** Offer «Reintentar con la misma llave» after a run. */
  retry?: boolean;
  /** The run issues a document keyed by the visitor's order number (the page shows «Número de orden»). */
  orders?: boolean;
  /** Needs the key's unlock key (catalog). */
  needsCatalog?: boolean;
  /** A notice shown above the form (for example: «this recipe is a simulation»). */
  notice?: string;
}

// Every type the API issues. Notes need a document issued here; the others use the demo receivers.
const TYPE_OPTIONS = [
  { value: "01", label: "01 · Factura" },
  { value: "03", label: "03 · Crédito fiscal (receptor contribuyente)" },
  { value: "05", label: "05 · Nota de crédito (corrige un documento suyo)" },
  { value: "06", label: "06 · Nota de débito (corrige un documento suyo)" },
  { value: "11", label: "11 · Exportación (receptor extranjero)" },
  { value: "14", label: "14 · Sujeto excluido (receptor con documento)" },
];

/** Notes relate a document the visitor issued here. */
const RELATED_FIELD: FieldSpec = {
  name: "related",
  label: "Documento que corrige (solo 05 y 06)",
  kind: "issued",
  help: "Las notas de crédito y débito se relacionan con un documento que usted emitió aquí.",
};

export const RECIPE_SPECS: RecipeSpec[] = [
  {
    id: "issue-idempotent",
    title: "Emitir con llave de idempotencia",
    summary: "Emite una Factura o un Crédito Fiscal con una llave propia. Repetir la misma llave devuelve el mismo documento.",
    file: "issue-idempotent.ts",
    fields: [{ name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" }, RELATED_FIELD],
    orders: true,
    consumesQuota: true,
    retry: true,
  },
  {
    id: "prepare-sign",
    title: "Preparar, revisar y firmar",
    summary: "prepare reserva el correlativo y devuelve el documento canónico sin firmar; sign lo firma sin cambiarlo.",
    file: "prepare-sign.ts",
    fields: [{ name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" }, RELATED_FIELD],
    stages: [{ id: "prepare", label: "1. Preparar" }, { id: "sign", label: "2. Firmar" }],
    orders: true,
    consumesQuota: true,
  },
  {
    id: "status-recovery",
    title: "Consultar estado y recuperar",
    summary: "Qué hacer cuando una llamada no responde: repetir con la misma llave y consultar el documento por su código.",
    file: "status-recovery.ts",
    fields: [
      { name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" },
      RELATED_FIELD,
      {
        name: "simulateTimeout", label: "Simular una respuesta que no llega", kind: "checkbox", default: true,
        help: "Solo acorta la espera de este cliente (250 ms). El API no cambia: el documento puede haberse emitido igual.",
      },
    ],
    orders: true,
    consumesQuota: true,
  },
  {
    id: "invalidate",
    title: "Anular un documento emitido aquí",
    summary: "Invalida un documento que usted emitió desde el playground. Es irreversible incluso en pruebas.",
    file: "invalidate.ts",
    fields: [
      { name: "code", label: "Documento a anular", kind: "issued", required: true },
      {
        name: "tipoAnulacion", label: "Tipo de anulación", kind: "select", default: "2",
        options: [
          { value: "2", label: "2 · Rescindir la operación" },
          { value: "3", label: "3 · Otro (requiere motivo)" },
          { value: "1", label: "1 · Error en la información (requiere el código de reemplazo)" },
        ],
      },
      { name: "motivo", label: "Motivo", kind: "text", default: "Operación rescindida" },
      { name: "replacement", label: "Código de generación del documento de reemplazo", kind: "text", help: "Solo para el tipo 1." },
      { name: "responsableNombre", label: "Responsable · nombre", kind: "text", required: true },
      {
        name: "responsableTipo", label: "Responsable · tipo de documento", kind: "select", default: "13",
        options: [{ value: "13", label: "DUI" }, { value: "36", label: "NIT" }, { value: "37", label: "Otro" }],
      },
      { name: "responsableNumero", label: "Responsable · número", kind: "text", required: true, help: "DUI: 9 dígitos. NIT: 14 dígitos." },
    ],
    consumesQuota: true,
  },
  {
    id: "documents-storage",
    title: "Listar y descargar documentos",
    summary: "Lista la primera página, lee el estado del almacenamiento administrado y, si elige un documento suyo, descarga el archivo.",
    file: "documents-storage.ts",
    fields: [
      { name: "code", label: "Documento a descargar (opcional)", kind: "issued" },
      { name: "kind", label: "Archivo", kind: "select", default: "pdf", options: [{ value: "pdf", label: "PDF" }, { value: "json", label: "JSON" }] },
      {
        name: "limit", label: "Documentos por página", kind: "select", default: "10",
        options: [{ value: "5", label: "5" }, { value: "10", label: "10" }, { value: "25", label: "25" }],
      },
    ],
    consumesQuota: false,
  },
  {
    id: "catalog-refs",
    title: "Referencias del catálogo",
    summary: "Lista clientes y productos del catálogo y emite una Factura con customerId y productId en lugar de copiar sus datos. Con un catálogo legible, el API resuelve los identificadores; si no, el SDK los resuelve con la llave de desbloqueo.",
    file: "catalog-refs.ts",
    fields: [
      { name: "customerId", label: "customerId (opcional)", kind: "text" },
      { name: "productId", label: "productId (déjelo vacío para solo listar)", kind: "text" },
      { name: "cantidad", label: "Cantidad", kind: "number", default: 1 },
    ],
    consumesQuota: false,
    retry: true,
    needsCatalog: true,
  },
  {
    id: "order-webhook",
    title: "Un pedido entra, una factura sale",
    summary: "Su tienda en línea avisa a su servidor cuando alguien compra (un webhook). Su servidor traduce el pedido con su propia lista de precios y emite. El número de pedido es la llave de idempotencia: si la tienda manda el mismo aviso dos veces —pasa seguido—, sale una sola factura.",
    file: "order-webhook.ts",
    fields: [
      { name: "order", label: "Pedido (JSON)", kind: "textarea", required: true, help: "sku es un código de la lista de precios de la Tienda de ejemplo (por ejemplo CAF-250); customerRef es un código de cliente de esa tienda (por ejemplo CLI-01)." },
    ],
    consumesQuota: true,
    retry: true,
  },
  {
    id: "deliver-email",
    title: "Emitir y enviar por correo, en dos llamadas",
    summary: "Dos llamadas separadas: facta.issue marca el correo y devuelve un token de entrega (cinco minutos); facta.deliverEmail lo usa para pedir el envío y waitForDelivery sigue el estado. El token existe para que nadie use el API como relevo de correo con documentos que no emitió.",
    file: "deliver-email.ts",
    fields: [
      {
        name: "email", label: "Correo del cliente", kind: "text",
        help: "Se envía el documento de prueba estándar de Facta DTE, sin texto suyo. Límites: 5 por hora y 20 por día, y 2 por día a una misma dirección.",
      },
      {
        name: "code", label: "O un documento suyo emitido hace menos de 5 minutos con correo (opcional)", kind: "issued",
        help: "Con un documento elegido se salta el paso 1: se usa el correo marcado al emitirlo y no se emite otro.",
      },
    ],
    stages: [{ id: "issue", label: "1. Emitir y marcar el correo" }, { id: "send", label: "2. Enviar con el token" }],
    orders: true,
    consumesQuota: true,
    retry: true,
  },
  {
    id: "archivo-dte",
    title: "El Archivo DTE y el JSON original",
    summary: "Descarga de un documento suyo el Archivo DTE (el JSON que recibe su cliente: documento, firma y sello) y el original almacenado con raw: true, y comprueba con archivoDteOf que se pueden reconstruir los mismos bytes.",
    file: "archivo-dte.ts",
    fields: [{ name: "code", label: "Documento", kind: "issued", required: true, help: "Un documento en contingencia no tiene sello: la descarga normal contesta not_sealed y solo existe el original." }],
    consumesQuota: false,
  },
  {
    id: "region-timings",
    title: "Región y tiempos de la API",
    summary: "region() y servedRegion dicen dónde corre la API y cuál región respondió; debug: { timings: true } pide a la API sus tiempos por paso y los devuelve en result.debug. Es una ayuda para depurar, apagada por defecto.",
    file: "region-timings.ts",
    fields: [],
    consumesQuota: false,
  },
  {
    id: "diagnose",
    title: "Diagnóstico y estado del catálogo",
    summary: "diagnose() revisa si esta llave puede emitir, consultar, descargar y archivar, y dice qué hacer; catalogState() dice cómo llega la llave al catálogo y si la copia local está al día. Ninguna abre bóvedas ni reserva correlativos.",
    file: "diagnose.ts",
    fields: [],
    consumesQuota: false,
  },
  {
    id: "delivery-status",
    title: "Estado de la entrega",
    summary: "getDelivery lee el estado de cada canal (correo, WhatsApp) de un documento suyo. A diferencia del token de entrega, que dura cinco minutos, el estado se puede consultar siempre.",
    file: "delivery-status.ts",
    fields: [{ name: "code", label: "Documento", kind: "issued", required: true }],
    consumesQuota: false,
  },
  {
    id: "register-return",
    title: "Registrar un retorno",
    summary: "El Evento de Retorno devuelve unidades de una línea de una Factura (01), Exportación (11) o Sujeto excluido (14) que usted emitió aquí. No gasta correlativo, no anula nada y se firma con el certificado del emisor. Después de un retorno sellado el documento ya no se puede anular.",
    file: "register-return.ts",
    fields: [
      { name: "code", label: "Documento (01, 11 o 14)", kind: "issued", required: true },
      { name: "linea", label: "Línea que regresa (se cuenta desde 1)", kind: "number", default: 1 },
      { name: "cantidad", label: "Unidades que regresan", kind: "number", default: 1 },
    ],
    consumesQuota: true,
    retry: true,
  },
  {
    id: "reference-clock",
    title: "El reloj de referencia",
    summary: "El SDK calibra un reloj contra clock.factadte.com para las marcas de tiempo que escribe él mismo (archivos locales, firmas de S3). Nunca toca la fecha ni la hora de un documento, que las pone el servidor de Facta.",
    file: "reference-clock.ts",
    fields: [],
    consumesQuota: false,
  },
  {
    id: "service-info",
    title: "Estado, llave y contrato",
    summary: "status() es la comprobación de salud (sin costo para el límite de la llave), environment sale del prefijo de la llave sin ninguna llamada, y getContract() devuelve el documento OpenAPI que publica el servidor.",
    file: "service-info.ts",
    fields: [],
    consumesQuota: false,
  },
  {
    id: "emergency-store",
    title: "Salvaguarda de emergencia (simulada)",
    summary: "runtime.emergencyStore es una función suya que el SDK llama solo cuando Facta no pudo guardar un documento en almacenamiento duradero. Aquí la emergencia es simulada: una API en memoria responde con la advertencia que usted elija y se ve qué recibe su función.",
    file: "emergency-store.ts",
    fields: [
      {
        name: "scenario", label: "Advertencia que simula el servidor", kind: "select", default: "sin_almacenamiento_duradero",
        options: [
          { value: "sin_almacenamiento_duradero", label: "sin_almacenamiento_duradero · solo queda la copia temporal" },
          { value: "copia_solo_temporal", label: "copia_solo_temporal · falló la escritura administrada" },
          { value: "sin_copia_en_servidor", label: "sin_copia_en_servidor · crítica: ni la copia temporal" },
        ],
      },
      { name: "storeFails", label: "Que su función falle", kind: "checkbox", default: false, help: "Se ve emergency_failed y reason store_failed; el documento sellado no se pierde ni se convierte en error." },
      { name: "notConfigured", label: "Sin función configurada", kind: "checkbox", default: false, help: "emergencyStore es opcional: sin ella, reason es not_configured." },
    ],
    consumesQuota: false,
    notice: "Simulación: no usa la API de Facta, no emite nada y no escribe en ningún almacenamiento. El playground nunca provoca una emergencia real.",
  },
];

export const specOf = (id: string) => RECIPE_SPECS.find((spec) => spec.id === id);
