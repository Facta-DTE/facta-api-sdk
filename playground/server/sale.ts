// The sale builder: a small, validated description in, a fiscal request out.
// The browser never authors the raw request (docs/playground.md §2): it sends
// this description to POST /api/session and the server builds the DteRequest.
//
// Extension point: add a type to BUILDERS to open it to the playground.

import type { DteRequest, LineItem } from "../../src/types.ts";
import type { PlaygroundFixtures } from "./fixtures.ts";
import { buildCreditoFiscal } from "./sale-credito-fiscal.ts";

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

export function buildLines(input: unknown[], fixtures: PlaygroundFixtures): { items: LineItem[]; total: number } {
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

type Builder = (input: SaleInput, fixtures: PlaygroundFixtures) => BuiltSale;

const BUILDERS: Record<string, Builder> = {
  // Factura (01): VAT included in the unit price.
  "01": (input, fixtures) => {
    const { items, total } = buildLines(input.lines, fixtures);
    let receptor: DteRequest["receptor"] = null;
    if (input.customerId !== undefined) {
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
};

/** Types the playground can build today. */
// Fallbacks used only for types BUILDERS does not have (batch D: the credit-fiscal switch).
const FALLBACK_BUILDERS: Record<string, Builder> = {
  "03": (input, fixtures) => buildCreditoFiscal(input, fixtures, buildLines),
};

const builderFor = (type: string): Builder | undefined => BUILDERS[type] ?? FALLBACK_BUILDERS[type];

export const SUPPORTED_SALE_TYPES = [...new Set([...Object.keys(BUILDERS), ...Object.keys(FALLBACK_BUILDERS)])];

/** Validate the description and build the request. Throws `SaleError`. */
export function buildSale(raw: unknown, fixtures: PlaygroundFixtures): { sale: BuiltSale; sendEmail: boolean } {
  if (!isRecord(raw)) throw new SaleError("sale_invalid", "La venta no es válida.");
  const type = raw.tipoDte;
  const builder = typeof type === "string" ? builderFor(type) : undefined;
  if (builder === undefined) throw new SaleError("type_unsupported", "Ese tipo de documento todavía no está disponible en el playground.");
  if (!Array.isArray(raw.lines)) throw new SaleError("lines_invalid", "Agregue al menos una línea.");
  if (raw.customerId !== undefined && typeof raw.customerId !== "string") throw new SaleError("customer_unknown", "Ese cliente de demostración no existe.");
  const input: SaleInput = {
    tipoDte: type as string,
    lines: raw.lines as SaleLineInput[],
    ...(raw.customerId === undefined ? {} : { customerId: raw.customerId as string }),
  };
  return { sale: builder(input, fixtures), sendEmail: raw.sendEmail === true };
}
