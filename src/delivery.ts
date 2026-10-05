// Pure helpers for delivery by e-mail and WhatsApp (docs/api-delivery-tokens.md).
// No I/O, so the client, the server handler and the tests share one definition.

import type { DeliverOptions, DeliveryRequest } from "./types.ts";

const DELIVERY_NUMBER = /^\+?[0-9][0-9 ()-]{5,22}[0-9]$/;
export const GENERATION_CODE = /^[0-9A-Fa-f-]{36}$/;

/** Maps `deliver` to the wire `entrega`; refuses what could silently send nothing. */
export function deliveryRequestFor(deliver: DeliverOptions): DeliveryRequest {
  if (typeof deliver !== "object" || deliver === null) throw new TypeError("deliver must be an object.");
  const entrega: DeliveryRequest = {};
  if (deliver.email !== undefined) {
    if (deliver.email !== true && (typeof deliver.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(deliver.email))) {
      throw new TypeError("deliver.email must be true (use receptor.correo) or an e-mail address.");
    }
    entrega.correo = deliver.email;
  }
  if (deliver.whatsapp !== undefined) {
    const { number, consent } = deliver.whatsapp as { number?: unknown; consent?: unknown };
    if (typeof number !== "string" || !DELIVERY_NUMBER.test(number.trim())) {
      throw new TypeError("deliver.whatsapp.number must be a phone number, preferably in +503… form.");
    }
    if (consent !== true) {
      throw new TypeError("deliver.whatsapp.consent must be true: it attests that the receiver agreed to WhatsApp delivery.");
    }
    entrega.whatsapp = { numero: number.trim(), consentimiento: true };
  }
  if (entrega.correo === undefined && entrega.whatsapp === undefined) {
    throw new TypeError("deliver must mark at least one channel (email or whatsapp).");
  }
  return entrega;
}

/** `pendiente` and `en_proceso` can still change; everything else (including `esperando_sello`) is not waited for. */
export function isFinalDeliveryState(state: string): boolean {
  return state !== "pendiente" && state !== "en_proceso";
}
