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
  /** Needs the key's unlock key (catalog). */
  needsCatalog?: boolean;
}

const TYPE_OPTIONS = [
  { value: "01", label: "Factura (01)" },
  { value: "03", label: "Comprobante de crédito fiscal (03)" },
];

export const RECIPE_SPECS: RecipeSpec[] = [
  {
    id: "issue-idempotent",
    title: "Emitir con llave de idempotencia",
    summary: "Emite una Factura o un Crédito Fiscal con una llave propia. Repetir la misma llave devuelve el mismo documento.",
    file: "issue-idempotent.ts",
    fields: [{ name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" }],
    consumesQuota: true,
    retry: true,
  },
  {
    id: "prepare-sign",
    title: "Preparar, revisar y firmar",
    summary: "prepare reserva el correlativo y devuelve el documento canónico sin firmar; sign lo firma sin cambiarlo.",
    file: "prepare-sign.ts",
    fields: [{ name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" }],
    stages: [{ id: "prepare", label: "1. Preparar" }, { id: "sign", label: "2. Firmar" }],
    consumesQuota: true,
  },
  {
    id: "status-recovery",
    title: "Consultar estado y recuperar",
    summary: "Qué hacer cuando una llamada no responde: repetir con la misma llave y consultar el documento por su código.",
    file: "status-recovery.ts",
    fields: [
      { name: "type", label: "Tipo de documento", kind: "select", options: TYPE_OPTIONS, default: "01" },
      {
        name: "simulateTimeout", label: "Simular una respuesta que no llega", kind: "checkbox", default: true,
        help: "Solo acorta la espera de este cliente (250 ms). El API no cambia: el documento puede haberse emitido igual.",
      },
    ],
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
    summary: "Lista clientes y productos del catálogo y emite una Factura con customerId y productId en lugar de copiar sus datos.",
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
    title: "Webhook: un pedido entra, un documento sale",
    summary: "Su tienda envía un pedido en JSON; el servidor lo convierte en solicitud y emite. El número de pedido es la llave de idempotencia.",
    file: "order-webhook.ts",
    fields: [
      { name: "order", label: "Pedido (JSON)", kind: "textarea", required: true, help: "sku es el id de un producto de demostración; customerRef es el id de un cliente de demostración." },
    ],
    consumesQuota: true,
    retry: true,
  },
];

export const specOf = (id: string) => RECIPE_SPECS.find((spec) => spec.id === id);
