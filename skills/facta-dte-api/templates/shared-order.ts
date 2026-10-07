// Shared by the templates: YOUR order model and how it becomes a DteRequest.
//
// Replace `loadOrder` with a read from YOUR database and `priceList` / customers with your own data.
// Adapted from the playground's order-to-invoice recipe (playground/server/recipes/order-webhook.ts):
// the fiscal request is always built on YOUR server from YOUR stored order, never from what a browser
// or a webhook payload claims. The shop and its SKUs below are fictitious.
import type { DteRequest, LineItem, Recipient } from "@facta-dte/api";

export interface Order {
  orderId: string;
  /** Your own customer reference; omit it for a Factura to «Consumidor final». */
  customerRef?: string;
  lines: Array<{ sku: string; qty: number }>;
  /** Where to send the document, if the buyer asked for it by e-mail. */
  email?: string;
}

/** Your price list: SKU → what to print and what to charge (FE price INCLUDES VAT). */
export const priceList: Record<string, { descripcion: string; precioUni: number }> = {
  "CAF-250": { descripcion: "Café molido 250 g", precioUni: 4.5 },
  "ENV-SV": { descripcion: "Envío nacional", precioUni: 3 },
};

/** Your customers by reference. Digits only in `numDocumento` (DUI 9, NIT 14). */
export const customers: Record<string, Recipient> = {
  "CLI-01": { nombre: "Carlos Ejemplo Rivas", tipoDocumento: "13", numDocumento: "039458719", correo: "carlos.ejemplo@correo.example" },
};

/** A problem with the order itself, worded for the person who sent it. */
export class OrderError extends Error {
  override readonly name = "OrderError";
}

/** TODO: read the order from your database. */
export async function loadOrder(orderId: string): Promise<Order> {
  if (orderId === "ORD-1042") return { orderId, lines: [{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }] };
  throw new OrderError(`Order ${orderId} not found.`);
}

/** Translate the order into the request Facta wants. */
export function orderToRequest(order: Order): DteRequest {
  const items: LineItem[] = order.lines.map((line) => {
    const product = priceList[line.sku];
    if (product === undefined) throw new OrderError(`SKU ${line.sku} is not in the price list.`);
    return { descripcion: product.descripcion, cantidad: line.qty, precioUni: product.precioUni };
  });
  if (order.customerRef === undefined) return { tipoDte: "01", items };
  const receptor = customers[order.customerRef];
  if (receptor === undefined) throw new OrderError(`Customer ${order.customerRef} is not in your customer list.`);
  return { tipoDte: "01", receptor, items };
}

/** The idempotency key IS the order: the same order sent twice answers with the same invoice. */
export const keyOf = (order: Order): string => `order-${order.orderId}`;

/** Read a required environment variable without ever printing its value. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing environment variable ${name}.`);
  return value;
}
