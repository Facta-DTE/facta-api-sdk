// Recipe 1 · Issue a Factura (01) or a Crédito Fiscal (03) with an idempotency key.
//
// The key is the sale's identity. Send the same request with the same key again
// (a timeout, a restart, a double click) and the API answers with the SAME
// document instead of issuing a second one. Use your own order number as the key.
import type { DteRequest, Facta, IssueResult } from "../../../mod.ts";

export interface Input {
  request: DteRequest;
  idempotencyKey: string;
}

export async function run(facta: Facta, input: Input): Promise<{ result: IssueResult }> {
  const result = await facta.issue(input.request, { idempotencyKey: input.idempotencyKey });
  return { result };
}

// Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: Input = {
  request: {
    tipoDte: "01",
    items: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1 }],
  },
  idempotencyKey: "erp-order-1042",
};
