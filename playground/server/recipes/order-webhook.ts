// Recipe 7 · Webhook flow: an order JSON in, a sealed document out.
//
// Your shop posts an order to your server; the server maps it to a request and
// issues. The order id is the idempotency key, so the webhook can be delivered
// twice (they always are) and still issue once.
import type { DteRequest, Facta, IssueResult, LineItem, Recipient } from "../../../mod.ts";

export interface Order {
  orderId: string;
  /** Your own customer reference, or omit for an anonymous Factura. */
  customerRef?: string;
  lines: Array<{ sku: string; qty: number }>;
}

export interface Input {
  order: Order;
  /** Your price list: SKU → what to print and charge. */
  priceList: Record<string, { descripcion: string; precioUni: number }>;
  /** Your customers by reference → the receiver data Hacienda needs. */
  customers: Record<string, Recipient>;
  idempotencyKey: string;
}

export function orderToRequest(input: Input): DteRequest {
  const items: LineItem[] = input.order.lines.map((line) => {
    const product = input.priceList[line.sku];
    if (product === undefined) throw new Error(`Unknown SKU ${line.sku}`);
    return { descripcion: product.descripcion, cantidad: line.qty, precioUni: product.precioUni };
  });
  const ref = input.order.customerRef;
  if (ref === undefined) return { tipoDte: "01", items };
  const receptor = input.customers[ref];
  if (receptor === undefined) throw new Error(`Unknown customer ${ref}`);
  return { tipoDte: "01", receptor, items };
}

export async function run(facta: Facta, input: Input): Promise<{ request: DteRequest; result: IssueResult }> {
  const request = orderToRequest(input);
  const result = await facta.issue(request, { idempotencyKey: input.idempotencyKey });
  return { request, result };
}

export const sample: Input = {
  order: { orderId: "ORD-1042", lines: [{ sku: "SKU-1", qty: 2 }] },
  priceList: { "SKU-1": { descripcion: "Producto de prueba", precioUni: 5 } },
  customers: {},
  idempotencyKey: "order-ORD-1042",
};
