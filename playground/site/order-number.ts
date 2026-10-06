// The order number of a sale: the identity its idempotency key is made of (server/order-key.ts).

/** A fresh, readable order number. */
export const newOrderNumber = (): string => `PED-${Math.floor(1000 + Math.random() * 9000)}`;

/** The same rule the server applies. */
export const ORDER_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
