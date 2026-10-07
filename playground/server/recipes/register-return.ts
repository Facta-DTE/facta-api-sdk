// Recipe 14 · Register a return (Evento de Retorno) on a document you issued.
//
// A return does not cancel or delete anything: it is an EVENT (CAT-002 18) with its own signed document, code and
// seal, applied to a sealed Factura (01), Factura de exportación (11) or Factura de sujeto excluido (14) that this
// API issued. It spends no control number, and it is signed with the issuer's certificate, so it needs `signKey`.
// Several can be registered on one document, up to what was sold: `disponible` in the answer says what is left of
// each line. Lines are counted from 1, as a person reads the invoice, and each item carries ONE of `cantidad`
// (units that come back) or `noGravado` (a charge or credit outside the taxable base).
//
// It still needs an idempotency key: a retry after a timeout would otherwise take the same units off twice.
// Hacienda not answering is not an error: HTTP 202, `estado: "firmado"`; repeat the SAME call with the SAME key and
// the same `jws` is sent again. Once a document has sealed returns it can no longer be invalidated
// (`has_return_events`). Window: three months from the document, two years for some activities.
import type { Facta, ReturnRequest, ReturnResult } from "../../../mod.ts";

export interface Input {
  codigoGeneracion: string;
  request: ReturnRequest;
  idempotencyKey: string;
}

export async function run(facta: Facta, input: Input): Promise<ReturnResult> {
  return await facta.registerReturn(input.codigoGeneracion, input.request, { idempotencyKey: input.idempotencyKey });
}

export const sample: Input = {
  codigoGeneracion: "00000000-0000-4000-8000-000000000000",
  request: { items: [{ linea: 1, cantidad: 1 }] },
  idempotencyKey: "erp-return-1042-1",
};
