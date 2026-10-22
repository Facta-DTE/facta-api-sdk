import { useState } from "react";
import { newOrderNumber } from "../order-number.ts";

/**
 * «Pedido PED-1042 · Nuevo pedido»: the compact version of the sale builder's order number, for the places
 * that issue a fixed sample sale. The same order issued twice is one document; «Nuevo pedido» makes another.
 */
export function useOrderNumber(): { orderNumber: string; renew(): void } {
  const [orderNumber, setOrderNumber] = useState(newOrderNumber);
  return { orderNumber, renew: () => setOrderNumber(newOrderNumber()) };
}

export function OrderLine({ orderNumber, onRenew }: { orderNumber: string; onRenew(): void }) {
  return (
    <p className="pg-order-line pg-hint">
      Pedido <b className="mono" data-testid="order-number">{orderNumber}</b> · la misma llave: emitirlo otra vez devuelve el mismo documento.{" "}
      <button type="button" className="pg-link-button" onClick={onRenew}>Nuevo pedido</button>
    </p>
  );
}
