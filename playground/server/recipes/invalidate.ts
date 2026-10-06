// Recipe 4 · Invalidate a document this visitor issued.
//
// Invalidation is irreversible and sends the signing key, so the API asks who is
// responsible and who requested it. tipoAnulacion: 1 = error en la información
// (needs the replacement's code), 2 = rescindir la operación, 3 = otro (needs motivo).
import type { Facta, InvalidationRequest, InvalidationResult } from "../../../mod.ts";

export interface Input {
  codigoGeneracion: string;
  request: InvalidationRequest;
  idempotencyKey: string;
}

export async function run(facta: Facta, input: Input): Promise<{ result: InvalidationResult }> {
  const result = await facta.invalidate(input.codigoGeneracion, input.request, { idempotencyKey: input.idempotencyKey });
  return { result };
}

export const sample: Input = {
  codigoGeneracion: "00000000-0000-4000-8000-000000000000",
  request: {
    tipoAnulacion: 2,
    motivo: "Operación rescindida",
    responsable: { nombre: "Nombre del responsable", tipoDocumento: "13", numDocumento: "000000000" },
    solicita: { nombre: "Nombre de quien solicita", tipoDocumento: "13", numDocumento: "000000000" },
  },
  idempotencyKey: "erp-void-1042",
};
