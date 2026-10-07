// The idempotency key of a sale: your ORDER NUMBER, scoped to the visitor.
//
// The key is the sale's identity at the API. Send the same request with the same key again (a double
// click, a retry after a timeout, a restart) and Hacienda is not asked twice: the API answers with the
// ORIGINAL document. A fresh random key per click is the opposite: every click is a new sale.
//
// In your own system the key is the order id you already have. Here it is the order number the visitor
// types, prefixed with a short visitor tag so two visitors who both type «PED-1042» never collide.
//
//     const idempotencyKey = `${visitorTag}.sale-${orderNumber}`;
//     const session = await createFactaSession({ request, idempotencyKey, display }, secret);
//
// The same order number with a DIFFERENT sale is refused by the API (`idempotency_key_reuse`): a key names
// one sale. «Nuevo pedido» in the page makes a new number.

import { SaleError } from "./sale.ts";

/** Letters, digits, dot, dash and underscore; up to 40. */
export const ORDER_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export interface SaleKey {
  /** Passed to `facta.issue(request, { idempotencyKey })`. */
  idempotencyKey: string;
  /** The number the visitor typed; null when the page sent none and the key is random (the old behaviour). */
  orderNumber: string | null;
}

/** The key for this visitor and order. Without an order number the key is random: every call is a new sale. */
export function saleKey(visitorTag: string, orderNumber: unknown): SaleKey {
  if (orderNumber === undefined || orderNumber === null || orderNumber === "") {
    return { idempotencyKey: `${visitorTag}.${crypto.randomUUID()}`, orderNumber: null };
  }
  if (typeof orderNumber !== "string" || !ORDER_NUMBER.test(orderNumber.trim())) {
    throw new SaleError("order_number_invalid", "El número de pedido admite letras, números, punto, guion y guion bajo (hasta 40).", "orderNumber");
  }
  const number = orderNumber.trim();
  return { idempotencyKey: `${visitorTag}.sale-${number}`, orderNumber: number };
}
