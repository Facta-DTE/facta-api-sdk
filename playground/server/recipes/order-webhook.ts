// Recipe 7 · A webhook flow: an order comes in, a sealed invoice goes out.
//
// THIS IS AN INTEGRATION EXAMPLE, NOT A FACTA DTE FEATURE. Facta DTE does not receive orders: the playground
// simulates the notice (webhook) that a third-party online shop (Shopify, WooCommerce or your own) sends when
// someone buys, and shows how YOUR server turns it into an invoice with the SDK. The sample shop is fictitious.
//
// Your online shop tells your server when someone buys (a webhook). Your server translates the order with its
// own price list and customer list, then issues. The order id is the idempotency key, so the same notice
// delivered twice (shops do that all the time) still issues ONE invoice.
//
// Everything below the two lists is what an integration actually writes: `orderToRequest` and `run`.
import type { DteRequest, Facta, IssueResult, LineItem, Recipient } from "../../../mod.ts";

/** Your price list: SKU → what to print on the invoice and what to charge. (A fictitious sample shop.) */
export const priceList: Record<string, { descripcion: string; precioUni: number }> = {
  "CAF-250": { descripcion: "Café molido 250 g", precioUni: 4.5 },
  "CAF-500": { descripcion: "Café molido 500 g", precioUni: 8 },
  "TAZ-01": { descripcion: "Taza de cerámica", precioUni: 7.25 },
  "FIL-50": { descripcion: "Filtros de papel (50)", precioUni: 2.75 },
  "ENV-SV": { descripcion: "Envío nacional", precioUni: 3 },
};

/** Your customers by reference → the receiver data Hacienda needs. All fictitious; DUI and NIT carry valid check digits. */
export const customers: Record<string, Recipient> = {
  "CLI-01": { nombre: "Carlos Ejemplo Rivas", tipoDocumento: "13", numDocumento: "039458719", correo: "carlos.ejemplo@correo.example" },
  "CLI-02": { nombre: "Ana Ejemplo Martínez", tipoDocumento: "13", numDocumento: "012345678", correo: "ana.ejemplo@correo.example" },
  "CLI-03": { nombre: "Panadería Ejemplo La Espiga, S.A. de C.V.", tipoDocumento: "36", numDocumento: "06141708921011", correo: "compras@laespiga.example" },
};

/** What the shop posts to your server. */
export interface Order {
  orderId: string;
  /** Your own customer reference, or omit it for a Factura to «Consumidor final». */
  customerRef?: string;
  lines: Array<{ sku: string; qty: number }>;
}

/** A problem with the order itself, worded for the person who sent it. */
export class OrderError extends Error {
  override readonly name = "OrderError";
}

const list = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} o ${words.at(-1)}`);

/** Translates the order into the request Facta wants: each SKU to its description and price, the customer to its receiver. */
export function orderToRequest(order: Order): DteRequest {
  const items: LineItem[] = order.lines.map((line) => {
    const product = priceList[line.sku];
    if (product === undefined) {
      throw new OrderError(`El SKU «${line.sku}» no está en la lista de precios de la tienda de ejemplo. Use ${list(Object.keys(priceList))}.`);
    }
    return { descripcion: product.descripcion, cantidad: line.qty, precioUni: product.precioUni };
  });
  if (order.customerRef === undefined) return { tipoDte: "01", items };
  const receptor = customers[order.customerRef];
  if (receptor === undefined) {
    throw new OrderError(`El cliente ${order.customerRef} no existe en la tienda de ejemplo. Elija uno de la lista (${list(Object.keys(customers))}) o deje el pedido sin cliente.`);
  }
  return { tipoDte: "01", receptor, items };
}

/** The key is the order: `order-ORD-1042`. The same order sent again answers with the original invoice. */
export const keyOf = (order: Order): string => `order-${order.orderId}`;

export async function run(facta: Facta, input: { order: Order; idempotencyKey: string }): Promise<{ request: DteRequest; result: IssueResult }> {
  const request = orderToRequest(input.order);
  const result = await facta.issue(request, { idempotencyKey: input.idempotencyKey });
  return { request, result };
}

// Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: { order: Order; idempotencyKey: string } = {
  order: { orderId: "ORD-1042", lines: [{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }] },
  idempotencyKey: "order-ORD-1042",
};
