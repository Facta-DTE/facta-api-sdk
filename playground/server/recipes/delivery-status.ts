// Recipe 12 · Read the delivery state of a document: `getDelivery`.
//
// Issuing never waits for delivery, and the delivery token lives five minutes (recipe 8). The STATE of every
// channel does not expire: `getDelivery(code)` reads it any time after, and `waitForDelivery(code)` polls it until
// each awaited channel is final. A channel that cannot deliver is a state (`fallido`, `sin_credito`,
// `sin_consentimiento`, `vencido`…) with a stable `motivo`, never an exception.
import type { DeliveryStatus, Facta } from "../../../mod.ts";

export interface Input {
  codigoGeneracion: string;
}

export async function run(facta: Facta, input: Input): Promise<DeliveryStatus> {
  return await facta.getDelivery(input.codigoGeneracion);
}

export const sample: Input = { codigoGeneracion: "00000000-0000-4000-8000-000000000000" };
