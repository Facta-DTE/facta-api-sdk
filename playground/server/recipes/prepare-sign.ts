// Recipe 2 · prepare → review → sign.
//
// `prepare` reserves the control number and returns the canonical document,
// unsigned. Review it, then hand the object back to `sign` UNCHANGED: the server
// checks a MAC over its canonical hash, so one altered cent is refused.
import type { DteRequest, Facta, IssueResult, PreparedDte } from "../../../mod.ts";

export interface Input {
  request: DteRequest;
  idempotencyKey: string;
}

export function prepare(facta: Facta, input: Input): Promise<PreparedDte> {
  return facta.prepare(input.request, { idempotencyKey: `${input.idempotencyKey}.prepare` });
}

export function sign(facta: Facta, prepared: PreparedDte, input: Input): Promise<IssueResult> {
  return facta.sign(prepared, { idempotencyKey: `${input.idempotencyKey}.sign` });
}

export async function run(facta: Facta, input: Input): Promise<{ prepared: PreparedDte; result: IssueResult }> {
  const prepared = await prepare(facta, input);
  // Here your system can show prepared.documento and prepared.totales to a person.
  const result = await sign(facta, prepared, input);
  return { prepared, result };
}

export const sample: Input = {
  request: {
    tipoDte: "01",
    items: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1 }],
  },
  idempotencyKey: "erp-order-1043",
};
