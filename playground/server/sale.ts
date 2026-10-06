// The sale builder: a small, validated description in, a fiscal request out.
// The browser never authors the raw request (docs/playground.md §2): it sends
// this description to POST /api/session and the server builds the DteRequest.
//
// The receiver and every line come from one of three sources, chosen explicitly:
//   catalog  the key's real catalog. The request carries `customerId` / `productId`
//            and the SDK resolves them (server-side for a readable key, from the
//            decrypted snapshot otherwise). The router first confirms each id exists
//            in the catalog (`sale-catalog.ts`); this module never sees a browser id
//            that was not confirmed.
//   demo     the fixtures (FACTA_DTE_FIXTURES_JSON).
//   custom   typed by the visitor, validated field by field (`receptor.ts`).
//
// Extension point: add a type to BUILDERS to open it to the playground.

import type { CatalogCustomer, CatalogProduct, DteRequest, ExcludedSubjectRecipient, ExportRecipient, LineItem, Recipient } from "../../src/types.ts";
import type { PlaygroundFixtures } from "./fixtures.ts";
import { buildCustomReceptor, ReceptorError } from "./receptor.ts";

export const MAX_LINES = 10;
export const MAX_TOTAL = 500;

export type SaleSource = "catalog" | "demo" | "custom";
const SOURCES: readonly string[] = ["catalog", "demo", "custom"];

export interface SaleLineInput {
  source?: SaleSource;
  /** A demo product id (source `demo`) or a catalog id (source `catalog`). */
  productId?: string;
  descripcion?: string;
  cantidad: number;
  precioUni?: number;
  /** Custom lines only, chosen by the visitor: 1 = bien, 2 = servicio. Never defaulted. */
  tipoItem?: number;
  /** Custom lines only: optional product code. */
  codigo?: string;
}

export interface SaleReceptorInput {
  source: SaleSource;
  /** Demo customer id (source `demo`) or catalog id (source `catalog`). */
  customerId?: string;
  /** Source `custom`: the typed fields; validated by `receptor.ts`. */
  custom?: Record<string, unknown>;
}

export interface SaleInput {
  tipoDte: string;
  /** Absent: Factura without a receiver, or the type's built-in demo receiver. */
  receptor?: SaleReceptorInput;
  lines: SaleLineInput[];
  /** Deliver the document by e-mail to the verified visitor. WhatsApp is never offered. */
  sendEmail?: boolean;
  /** 05/06: generation code of a document THIS visitor issued here (checked against the ledger). */
  relatedCode?: string;
}

/** Catalog records the router confirmed exist for this key, by id. */
export interface CatalogLookup {
  customers: Map<string, CatalogCustomer>;
  products: Map<string, CatalogProduct>;
}

export const EMPTY_CATALOG: CatalogLookup = { customers: new Map(), products: new Map() };

/** What a builder may read besides the description. */
export interface SaleContext {
  fixtures: PlaygroundFixtures;
  /** Generation codes the visitor issued in the playground (upper-case). */
  ownedCodes: string[];
  catalog: CatalogLookup;
}

export interface BuiltSale {
  request: DteRequest;
  total: number;
  title: string;
}

export class SaleError extends Error {
  override readonly name = "SaleError";
  constructor(readonly code: string, message: string, readonly field?: string) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Ids the browser names in the catalog source, for the router to confirm. Pure. */
export function collectCatalogRefs(raw: unknown): { customerId: string | null; productIds: string[] } {
  const refs = { customerId: null as string | null, productIds: [] as string[] };
  if (!isRecord(raw)) return refs;
  if (isRecord(raw.receptor) && raw.receptor.source === "catalog" && typeof raw.receptor.customerId === "string") refs.customerId = raw.receptor.customerId;
  if (Array.isArray(raw.lines)) {
    for (const line of raw.lines.slice(0, MAX_LINES)) {
      if (isRecord(line) && line.source === "catalog" && typeof line.productId === "string" && !refs.productIds.includes(line.productId)) refs.productIds.push(line.productId);
    }
  }
  return refs;
}

const CATALOG_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const isCatalogId = (value: unknown): value is string => typeof value === "string" && CATALOG_ID.test(value);

/** Catalog price basis, the rule the SDK enforces when it resolves a product (src/catalog.ts). */
function catalogProduct(product: CatalogProduct, type: string): { price: number } {
  const itemType = Number(product.item_type);
  if (itemType !== 1 && itemType !== 2 && itemType !== 3) {
    throw new SaleError("product_item_type_invalid", "Ese producto del catálogo no tiene un tipo (bien o servicio). Corríjalo en Facta antes de emitir.");
  }
  const price = product.unit_price;
  if (typeof price !== "number" || !Number.isFinite(price) || !(price > 0)) {
    throw new SaleError("product_price_missing", "Ese producto del catálogo no tiene un precio válido.");
  }
  if (type !== "14" && product.vat_included !== (type === "01")) {
    throw new SaleError(
      "product_vat_basis",
      type === "01"
        ? "El precio de ese producto está sin IVA y la Factura (01) lleva el IVA incluido. Use otro producto o una línea personalizada."
        : "El precio de ese producto incluye IVA y este documento lleva el precio sin IVA. Use otro producto o una línea personalizada.",
    );
  }
  return { price };
}

export function buildLines(input: unknown[], context: Pick<SaleContext, "fixtures"> & Partial<Pick<SaleContext, "catalog">>, type = "01"): { items: LineItem[]; total: number } {
  const { fixtures } = context;
  const catalog = context.catalog ?? EMPTY_CATALOG;
  if (input.length < 1 || input.length > MAX_LINES) {
    throw new SaleError("lines_invalid", `Agregue entre 1 y ${MAX_LINES} líneas.`);
  }
  const items: LineItem[] = [];
  let total = 0;
  for (const raw of input) {
    if (!isRecord(raw)) throw new SaleError("lines_invalid", "Una línea no es válida.");
    const quantity = raw.cantidad;
    if (typeof quantity !== "number" || !(quantity >= 1) || quantity > 1000 || !Number.isInteger(quantity)) {
      throw new SaleError("quantity_invalid", "La cantidad debe ser un entero entre 1 y 1000.");
    }
    // A line without a source keeps the earlier meaning: a product id is a demo product.
    const source = raw.source ?? (raw.productId !== undefined ? "demo" : "custom");
    if (typeof source !== "string" || !SOURCES.includes(source)) throw new SaleError("line_source_invalid", "El origen de la línea no es válido.");
    let item: LineItem;
    let price: number;
    if (source === "catalog") {
      if (!isCatalogId(raw.productId)) throw new SaleError("product_not_in_catalog", "Ese producto no está en el catálogo de la llave.");
      const product = catalog.products.get(raw.productId);
      if (product === undefined) throw new SaleError("product_not_in_catalog", "Ese producto no está en el catálogo de la llave.");
      price = catalogProduct(product, type).price;
      // Ids only: the SDK resolves description, price, code, item type and unit.
      item = { productId: raw.productId, cantidad: quantity };
    } else if (source === "demo") {
      const product = fixtures.products.find((p) => p.id === raw.productId);
      if (!product) throw new SaleError("product_unknown", "Ese producto de demostración no existe.");
      price = product.precioUni;
      item = { descripcion: product.descripcion, cantidad: quantity, precioUni: product.precioUni, ...(product.productId === undefined ? {} : { productId: product.productId }) };
    } else {
      const text = typeof raw.descripcion === "string" ? raw.descripcion.trim() : "";
      if (text === "" || text.length > 100) throw new SaleError("description_invalid", "La descripción es obligatoria (hasta 100 caracteres).");
      if (typeof raw.precioUni !== "number" || !(raw.precioUni >= 0.01) || raw.precioUni > 1000) {
        throw new SaleError("price_invalid", "El precio debe estar entre $0.01 y $1,000.00.");
      }
      if (raw.tipoItem !== 1 && raw.tipoItem !== 2) {
        throw new SaleError("item_type_required", "Elija si la línea es un bien o un servicio.", "tipoItem");
      }
      let codigo: string | undefined;
      if (raw.codigo !== undefined && raw.codigo !== null && raw.codigo !== "") {
        // eslint-disable-next-line no-control-regex
        if (typeof raw.codigo !== "string" || raw.codigo.trim().length > 25 || /[\u0000-\u001f\u007f]/.test(raw.codigo)) {
          throw new SaleError("code_invalid", "El código del producto admite hasta 25 caracteres.", "codigo");
        }
        codigo = raw.codigo.trim();
      }
      price = cents(raw.precioUni);
      item = { descripcion: text, cantidad: quantity, precioUni: price, tipoItem: raw.tipoItem, ...(codigo === undefined || codigo === "" ? {} : { codigo }) };
    }
    items.push(item);
    total = cents(total + quantity * price);
  }
  if (total > MAX_TOTAL) throw new SaleError("total_too_high", `El total de una venta de prueba no puede pasar de $${MAX_TOTAL}.`);
  return { items, total };
}

const has = (receptor: Record<string, unknown>, ...keys: string[]) =>
  keys.every((k) => typeof receptor[k] === "string" && (receptor[k] as string).trim() !== "");

/** An excluded subject has a document and an address and is not a contribuyente (no NRC). */
const fitsExcluded = (r: Record<string, unknown>) =>
  has(r, "numDocumento", "nombre") && typeof r.direccion === "object" && r.direccion !== null && !has(r, "nrc");

/** Which document types a demo customer's receiver can serve. Used by the page to filter its list. */
export function customerFits(receptor: Record<string, unknown>): string[] {
  const types = ["01"];
  if (has(receptor, "nrc", "numDocumento")) types.push("03", "05", "06");
  if (has(receptor, "codPais", "numDocumento")) types.push("11");
  if (fitsExcluded(receptor)) types.push("14");
  return types;
}

/** How a type treats its receiver. */
interface ReceiverRule {
  /** Factura only: no receiver at all is allowed. */
  optional?: boolean;
  /** Does the demo customer's receiver suit the type? */
  fits(receptor: Record<string, unknown>): boolean;
  /** What to tell the visitor when nothing suits. */
  missing: string;
  unfitCode: string;
  /** The catalog can name the receiver (`receptor.customerId` exists only on `Recipient`: 01, 03, 05, 06). */
  catalog: boolean;
  /** Extra rule for a catalog customer (a contribuyente needs an NRC and a document). */
  catalogFits?(customer: CatalogCustomer): boolean;
}

const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
const taxpayerCatalog = (c: CatalogCustomer) => filled(c.nrc) && filled(c.doc_number);

const RULES: Record<string, ReceiverRule> = {
  "01": { optional: true, fits: () => true, missing: "", unfitCode: "customer_unfit", catalog: true },
  "03": { fits: (r) => has(r, "nrc", "numDocumento"), missing: "Elija un cliente con NRC: el crédito fiscal es para contribuyentes.", unfitCode: "customer_not_contributor", catalog: true, catalogFits: taxpayerCatalog },
  "05": { fits: (r) => has(r, "nrc", "numDocumento"), missing: "Elija un cliente con NRC para la nota de crédito.", unfitCode: "customer_unfit", catalog: true, catalogFits: taxpayerCatalog },
  "06": { fits: (r) => has(r, "nrc", "numDocumento"), missing: "Elija un cliente con NRC para la nota de débito.", unfitCode: "customer_unfit", catalog: true, catalogFits: taxpayerCatalog },
  "11": { fits: (r) => has(r, "codPais", "numDocumento"), missing: "Elija un cliente extranjero para la exportación.", unfitCode: "customer_unfit", catalog: false },
  "14": { fits: fitsExcluded, missing: "Elija un cliente con documento y dirección para el sujeto excluido.", unfitCode: "customer_unfit", catalog: false },
};

type AnyReceptor = Recipient | ExportRecipient | ExcludedSubjectRecipient;

/** The receiver of the request for `type`, from the source the visitor chose. */
function resolveReceptor(type: string, input: SaleInput, { fixtures, catalog }: SaleContext): AnyReceptor | null {
  const rule = RULES[type]!;
  // A demo source with no customer picked is the same as no choice.
  const chosen = input.receptor?.source === "demo" && input.receptor.customerId === undefined ? undefined : input.receptor;
  if (chosen === undefined) {
    if (rule.optional) return null;
    // No choice made: the type's own demo receiver, when the fixtures have one.
    const fallback = fixtures.requests[type]?.receptor as Record<string, unknown> | null | undefined;
    if (fallback && rule.fits(fallback)) return fallback as unknown as AnyReceptor;
    throw new SaleError("customer_required", rule.missing);
  }
  if (chosen.source === "demo") {
    const customer = fixtures.customers.find((c) => c.id === chosen.customerId);
    if (!customer) throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
    if (!rule.optional && !rule.fits(customer.receptor as Record<string, unknown>)) throw new SaleError(rule.unfitCode, rule.missing);
    return customer.receptor as AnyReceptor;
  }
  if (chosen.source === "catalog") {
    if (!rule.catalog) {
      throw new SaleError("catalog_receiver_unsupported", "Para este tipo de documento el API no acepta un cliente del catálogo: use un cliente de demostración o escriba los datos.");
    }
    if (!isCatalogId(chosen.customerId)) throw new SaleError("customer_not_in_catalog", "Ese cliente no está en el catálogo de la llave.");
    const customer = catalog.customers.get(chosen.customerId);
    if (customer === undefined) throw new SaleError("customer_not_in_catalog", "Ese cliente no está en el catálogo de la llave.");
    if (rule.catalogFits && !rule.catalogFits(customer)) {
      throw new SaleError("customer_not_contributor", "Ese cliente del catálogo no tiene NRC y documento: este documento es para contribuyentes.");
    }
    // The id alone: the SDK/API resolves the stored fields; nothing is copied into the token.
    return { customerId: chosen.customerId };
  }
  try {
    return buildCustomReceptor(type, chosen.custom);
  } catch (error) {
    if (error instanceof ReceptorError) throw new SaleError(error.code, error.message, error.field);
    throw error;
  }
}

function relatedDocument(input: SaleInput, ownedCodes: string[]) {
  const code = typeof input.relatedCode === "string" ? input.relatedCode.toUpperCase() : "";
  if (code === "") throw new SaleError("related_required", "Elija un documento emitido aquí para relacionar la nota.");
  if (!ownedCodes.includes(code)) throw new SaleError("related_not_owned", "Solo puede relacionar documentos que usted emitió en este playground.");
  return [{ codigoGeneracion: code }];
}

type Builder = (input: SaleInput, context: SaleContext) => BuiltSale;

// Request shapes follow examples/dte-types.ts and the OpenAPI the SDK pins. Fiscal
// values (rates, totals, numbering) are never computed here: the API owns them.
const BUILDERS: Record<string, Builder> = {
  // Factura (01): VAT included in the unit price.
  "01": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "01");
    const receptor = resolveReceptor("01", input, context);
    return {
      request: { tipoDte: "01", ...(receptor === null ? {} : { receptor: receptor as Recipient }), items },
      total,
      title: "Factura de prueba",
    };
  },
  // Comprobante de crédito fiscal (03): VAT excluded from the unit price; needs a contribuyente.
  "03": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "03");
    const receptor = resolveReceptor("03", input, context);
    return { request: { tipoDte: "03", receptor: receptor as Recipient, items }, total, title: "Crédito fiscal de prueba (precios sin IVA)" };
  },
  // Nota de crédito (05) and nota de débito (06) relate to a document the visitor issued here.
  "05": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "05");
    const documentosRelacionados = relatedDocument(input, context.ownedCodes);
    const receptor = resolveReceptor("05", input, context);
    return { request: { tipoDte: "05", documentosRelacionados, receptor: receptor as Recipient, items }, total, title: "Nota de crédito de prueba" };
  },
  "06": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "06");
    const documentosRelacionados = relatedDocument(input, context.ownedCodes);
    const receptor = resolveReceptor("06", input, context);
    return { request: { tipoDte: "06", documentosRelacionados, receptor: receptor as Recipient, items }, total, title: "Nota de débito de prueba" };
  },
  // Factura de exportación (11): foreign receiver; goods, FOB (the SDK's own example).
  "11": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "11");
    const receptor = resolveReceptor("11", input, context);
    return {
      request: { tipoDte: "11", receptor: receptor as ExportRecipient, exportacion: { tipoItemExpor: 1, incoterms: "FOB" }, items },
      total,
      title: "Factura de exportación de prueba",
    };
  },
  // Factura de sujeto excluido (14).
  "14": (input, context) => {
    const { items, total } = buildLines(input.lines, context, "14");
    const receptor = resolveReceptor("14", input, context);
    return {
      request: { tipoDte: "14", receptor: receptor as ExcludedSubjectRecipient, aplicarReteRenta: false, items },
      total,
      title: "Sujeto excluido de prueba",
    };
  },
};

/** Types the playground can build today. */
export const SUPPORTED_SALE_TYPES = Object.keys(BUILDERS);

/** Types whose receiver can be a catalog customer (the SDK's `Recipient` carries `customerId`). */
export const CATALOG_RECEIVER_TYPES = Object.keys(RULES).filter((t) => RULES[t]!.catalog);

function readReceptor(raw: Record<string, unknown>): SaleReceptorInput | undefined {
  // Earlier shape: a top-level demo `customerId`, or a typed name for Factura.
  if (raw.receptor === undefined) {
    if (raw.customerId !== undefined && raw.receptorNombre !== undefined) throw new SaleError("customer_ambiguous", "Elija un cliente de demostración o escriba un nombre, no ambos.");
    if (raw.customerId !== undefined) {
      if (typeof raw.customerId !== "string") throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
      return { source: "demo", customerId: raw.customerId };
    }
    if (raw.receptorNombre !== undefined) return { source: "custom", custom: { nombre: raw.receptorNombre } };
    return undefined;
  }
  const r = raw.receptor;
  if (!isRecord(r) || typeof r.source !== "string" || !SOURCES.includes(r.source)) throw new SaleError("receptor_source_invalid", "Elija de dónde sale el receptor.");
  const source = r.source as SaleSource;
  if (source === "custom") {
    if (!isRecord(r.custom)) throw new SaleError("receptor_invalid", "El receptor no es válido.");
    return { source, custom: r.custom };
  }
  if (r.customerId !== undefined && typeof r.customerId !== "string") throw new SaleError(source === "demo" ? "customer_unknown" : "customer_not_in_catalog", "Ese cliente no existe.");
  return { source, ...(r.customerId === undefined ? {} : { customerId: r.customerId as string }) };
}

/** Validate the description and build the request. Throws `SaleError`. */
export function buildSale(
  raw: unknown,
  fixtures: PlaygroundFixtures,
  options: { ownedCodes?: string[]; catalog?: CatalogLookup } = {},
): { sale: BuiltSale; sendEmail: boolean } {
  if (!isRecord(raw)) throw new SaleError("sale_invalid", "La venta no es válida.");
  const type = raw.tipoDte;
  const builder = typeof type === "string" && Object.hasOwn(BUILDERS, type) ? BUILDERS[type] : undefined;
  if (builder === undefined) throw new SaleError("type_unsupported", "Ese tipo de documento todavía no está disponible en el playground.");
  if (!Array.isArray(raw.lines)) throw new SaleError("lines_invalid", "Agregue al menos una línea.");
  if (raw.relatedCode !== undefined && typeof raw.relatedCode !== "string") throw new SaleError("related_required", "El documento relacionado no es válido.");
  const receptor = readReceptor(raw);
  const input: SaleInput = {
    tipoDte: type as string,
    ...(receptor === undefined ? {} : { receptor }),
    lines: raw.lines as SaleLineInput[],
    ...(raw.relatedCode === undefined ? {} : { relatedCode: raw.relatedCode as string }),
  };
  const context: SaleContext = { fixtures, ownedCodes: options.ownedCodes ?? [], catalog: options.catalog ?? EMPTY_CATALOG };
  return { sale: builder(input, context), sendEmail: raw.sendEmail === true };
}
