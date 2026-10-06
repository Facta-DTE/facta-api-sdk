// The sale builder: a small, validated description in, a fiscal request out.
// The browser never authors the raw request (docs/playground.md §2): it sends
// this description to POST /api/session and the server builds the DteRequest.
//
// Extension point: add a type to BUILDERS to open it to the playground.

import type { DteRequest, ExcludedSubjectRecipient, ExportRecipient, LineItem, Recipient } from "../../src/types.ts";
import type { PlaygroundFixtures } from "./fixtures.ts";

export const MAX_LINES = 10;
export const MAX_TOTAL = 500;

export interface SaleLineInput {
  /** A demo product id from the fixtures. */
  productId?: string;
  descripcion?: string;
  cantidad: number;
  precioUni?: number;
}

export interface SaleInput {
  tipoDte: string;
  /** A demo customer id from the fixtures. Omit for a sale without a named receiver. */
  customerId?: string;
  lines: SaleLineInput[];
  /** Deliver the document by e-mail to the verified visitor. WhatsApp is never offered. */
  sendEmail?: boolean;
  /** Factura (01) only: a typed receiver name (the only receiver field a visitor can type). */
  receptorNombre?: string;
  /** 05/06: generation code of a document THIS visitor issued here (checked against the ledger). */
  relatedCode?: string;
}

/** What a builder may read besides the description. */
export interface SaleContext {
  fixtures: PlaygroundFixtures;
  /** Generation codes the visitor issued in the playground (upper-case). */
  ownedCodes: string[];
}

export interface BuiltSale {
  request: DteRequest;
  total: number;
  title: string;
}

export class SaleError extends Error {
  override readonly name = "SaleError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const cents = (value: number) => Math.round(value * 100) / 100;

function buildLines(input: unknown[], fixtures: PlaygroundFixtures): { items: LineItem[]; total: number } {
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
    let descripcion: string;
    let price: number;
    let productId: string | undefined;
    if (raw.productId !== undefined) {
      const product = fixtures.products.find((p) => p.id === raw.productId);
      if (!product) throw new SaleError("product_unknown", "Ese producto de demostración no existe.");
      descripcion = product.descripcion;
      price = product.precioUni;
      productId = product.productId;
    } else {
      const text = typeof raw.descripcion === "string" ? raw.descripcion.trim() : "";
      if (text === "" || text.length > 100) throw new SaleError("description_invalid", "La descripción es obligatoria (hasta 100 caracteres).");
      if (typeof raw.precioUni !== "number" || !(raw.precioUni >= 0.01) || raw.precioUni > 1000) {
        throw new SaleError("price_invalid", "El precio debe estar entre $0.01 y $1,000.00.");
      }
      descripcion = text;
      price = cents(raw.precioUni);
    }
    items.push({ descripcion, cantidad: quantity, precioUni: price, ...(productId === undefined ? {} : { productId }) });
    total = cents(total + quantity * price);
  }
  if (total > MAX_TOTAL) throw new SaleError("total_too_high", `El total de una venta de prueba no puede pasar de $${MAX_TOTAL}.`);
  return { items, total };
}

type Builder = (input: SaleInput, context: SaleContext) => BuiltSale;

/** The receiver for `type`: the chosen demo customer, else the fixture request's own receiver. */
function pickReceptor(type: string, input: SaleInput, fixtures: PlaygroundFixtures, fits: (receptor: Record<string, unknown>) => boolean, missing: string): Record<string, unknown> {
  if (input.customerId !== undefined) {
    const customer = fixtures.customers.find((c) => c.id === input.customerId);
    if (!customer) throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
    if (!fits(customer.receptor as Record<string, unknown>)) throw new SaleError("customer_unfit", missing);
    return customer.receptor as Record<string, unknown>;
  }
  const fallback = fixtures.requests[type]?.receptor as Record<string, unknown> | null | undefined;
  if (fallback && fits(fallback)) return fallback;
  throw new SaleError("customer_required", missing);
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

function relatedDocument(input: SaleInput, ownedCodes: string[]) {
  const code = typeof input.relatedCode === "string" ? input.relatedCode.toUpperCase() : "";
  if (code === "") throw new SaleError("related_required", "Elija un documento emitido aquí para relacionar la nota.");
  if (!ownedCodes.includes(code)) throw new SaleError("related_not_owned", "Solo puede relacionar documentos que usted emitió en este playground.");
  return [{ codigoGeneracion: code }];
}

// Request shapes follow examples/dte-types.ts and the OpenAPI the SDK pins. Fiscal
// values (rates, totals, numbering) are never computed here: the API owns them.
const BUILDERS: Record<string, Builder> = {
  // Factura (01): VAT included in the unit price.
  "01": (input, { fixtures }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    let receptor: DteRequest["receptor"] = null;
    if (input.receptorNombre !== undefined) {
      if (input.customerId !== undefined) throw new SaleError("customer_ambiguous", "Elija un cliente de demostración o escriba un nombre, no ambos.");
      receptor = { nombre: input.receptorNombre };
    } else if (input.customerId !== undefined) {
      const customer = fixtures.customers.find((c) => c.id === input.customerId);
      if (!customer) throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
      receptor = customer.receptor;
    }
    return {
      request: { tipoDte: "01", ...(receptor === null ? {} : { receptor }), items },
      total,
      title: "Factura de prueba",
    };
  },
  // Comprobante de crédito fiscal (03): VAT excluded from the unit price; needs a contribuyente.
  "03": (input, { fixtures }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    const receptor = pickReceptor("03", input, fixtures, (r) => has(r, "nrc", "numDocumento"), "Elija un cliente con NRC: el crédito fiscal es para contribuyentes.");
    return { request: { tipoDte: "03", receptor: receptor as unknown as Recipient, items }, total, title: "Crédito fiscal de prueba (precios sin IVA)" };
  },
  // Nota de crédito (05) and nota de débito (06) relate to a document the visitor issued here.
  "05": (input, { fixtures, ownedCodes }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    const documentosRelacionados = relatedDocument(input, ownedCodes);
    const receptor = pickReceptor("05", input, fixtures, (r) => has(r, "nrc", "numDocumento"), "Elija un cliente con NRC para la nota de crédito.");
    return { request: { tipoDte: "05", documentosRelacionados, receptor: receptor as unknown as Recipient, items }, total, title: "Nota de crédito de prueba" };
  },
  "06": (input, { fixtures, ownedCodes }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    const documentosRelacionados = relatedDocument(input, ownedCodes);
    const receptor = pickReceptor("06", input, fixtures, (r) => has(r, "nrc", "numDocumento"), "Elija un cliente con NRC para la nota de débito.");
    return { request: { tipoDte: "06", documentosRelacionados, receptor: receptor as unknown as Recipient, items }, total, title: "Nota de débito de prueba" };
  },
  // Factura de exportación (11): foreign receiver; goods, FOB (the SDK's own example).
  "11": (input, { fixtures }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    const receptor = pickReceptor("11", input, fixtures, (r) => has(r, "codPais", "numDocumento"), "Elija un cliente extranjero para la exportación.");
    return {
      request: { tipoDte: "11", receptor: receptor as unknown as ExportRecipient, exportacion: { tipoItemExpor: 1, incoterms: "FOB" }, items },
      total,
      title: "Factura de exportación de prueba",
    };
  },
  // Factura de sujeto excluido (14).
  "14": (input, { fixtures }) => {
    const { items, total } = buildLines(input.lines, fixtures);
    const receptor = pickReceptor("14", input, fixtures, fitsExcluded, "Elija un cliente con documento y dirección para el sujeto excluido.");
    return {
      request: { tipoDte: "14", receptor: receptor as unknown as ExcludedSubjectRecipient, aplicarReteRenta: false, items },
      total,
      title: "Sujeto excluido de prueba",
    };
  },
};

/** Types the playground can build today. */
export const SUPPORTED_SALE_TYPES = Object.keys(BUILDERS);

/** Validate the description and build the request. Throws `SaleError`. */
export function buildSale(
  raw: unknown,
  fixtures: PlaygroundFixtures,
  options: { ownedCodes?: string[] } = {},
): { sale: BuiltSale; sendEmail: boolean } {
  if (!isRecord(raw)) throw new SaleError("sale_invalid", "La venta no es válida.");
  const type = raw.tipoDte;
  const builder = typeof type === "string" && Object.hasOwn(BUILDERS, type) ? BUILDERS[type] : undefined;
  if (builder === undefined) throw new SaleError("type_unsupported", "Ese tipo de documento todavía no está disponible en el playground.");
  if (!Array.isArray(raw.lines)) throw new SaleError("lines_invalid", "Agregue al menos una línea.");
  if (raw.customerId !== undefined && typeof raw.customerId !== "string") throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
  if (raw.relatedCode !== undefined && typeof raw.relatedCode !== "string") throw new SaleError("related_required", "El documento relacionado no es válido.");
  let receptorNombre: string | undefined;
  if (raw.receptorNombre !== undefined) {
    const text = typeof raw.receptorNombre === "string" ? raw.receptorNombre.trim() : "";
    if (text === "" || text.length > 80) throw new SaleError("receptor_name_invalid", "El nombre del receptor debe tener entre 1 y 80 caracteres.");
    receptorNombre = text;
  }
  const input: SaleInput = {
    tipoDte: type as string,
    ...(receptorNombre === undefined ? {} : { receptorNombre }),
    lines: raw.lines as SaleLineInput[],
    ...(raw.customerId === undefined ? {} : { customerId: raw.customerId as string }),
    ...(raw.relatedCode === undefined ? {} : { relatedCode: raw.relatedCode as string }),
  };
  return { sale: builder(input, { fixtures, ownedCodes: options.ownedCodes ?? [] }), sendEmail: raw.sendEmail === true };
}
