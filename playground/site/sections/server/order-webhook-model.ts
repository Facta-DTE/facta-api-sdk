// The sample shop's order as data: how the builder writes the JSON the shop «sends», and how an edited JSON
// goes back into the builder. Pure, so it is unit-tested. The translation itself (SKU → description and price)
// is the recipe's own code, server/recipes/order-webhook.ts.

import { priceList, type Order } from "../../../server/recipes/order-webhook.ts";

export const MAX_LINES = 10;

/** The order as the shop posts it: lines one per row, as in the board. */
export function formatOrder(order: Order): string {
  const head = [`  "orderId": ${JSON.stringify(order.orderId)}`];
  if (order.customerRef !== undefined) head.push(`  "customerRef": ${JSON.stringify(order.customerRef)}`);
  const rows = order.lines.map((l) => `    { "sku": ${JSON.stringify(l.sku)}, "qty": ${JSON.stringify(l.qty)} }`);
  head.push(`  "lines": [\n${rows.join(",\n")}\n  ]`);
  return `{\n${head.join(",\n")}\n}`;
}

/** A typed JSON read back into an order, or null when it has not the shape yet (the builder then keeps its last state). */
export function parseOrder(text: string): Order | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.orderId !== "string" || !Array.isArray(raw.lines)) return null;
  const lines: Order["lines"] = [];
  for (const line of raw.lines) {
    const l = line as Record<string, unknown> | null;
    if (l === null || typeof l !== "object" || typeof l.sku !== "string" || typeof l.qty !== "number") return null;
    lines.push({ sku: l.sku, qty: l.qty });
  }
  if (raw.customerRef !== undefined && typeof raw.customerRef !== "string") return null;
  return { orderId: raw.orderId, ...(typeof raw.customerRef === "string" ? { customerRef: raw.customerRef } : {}), lines };
}

/** Adds one unit of a product (a new line, or one more on the existing line). Respects the line limit. */
export function addLine(lines: Order["lines"], sku: string): Order["lines"] {
  if (lines.some((l) => l.sku === sku)) return lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(1000, l.qty + 1) } : l));
  return lines.length >= MAX_LINES ? lines : [...lines, { sku, qty: 1 }];
}

/** Changes a quantity by `delta`; reaching zero removes the line. */
export function changeQty(lines: Order["lines"], sku: string, delta: number): Order["lines"] {
  return lines.flatMap((l) => (l.sku !== sku ? [l] : l.qty + delta < 1 ? [] : [{ ...l, qty: Math.min(1000, l.qty + delta) }]));
}

/** What the order costs by the shop's price list; a SKU it does not know adds nothing. Rounded to cents. */
export function orderTotal(lines: Order["lines"]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.qty * (priceList[l.sku]?.precioUni ?? 0), 0) * 100) / 100;
}
