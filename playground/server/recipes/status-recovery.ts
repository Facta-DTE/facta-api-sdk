// Recipe 3 · Status lookup and recovery after an uncertain response.
//
// When a call times out you do not know whether the document was issued. Do not
// issue again with a new key. Repeat the SAME request with the SAME key (the API
// returns the original document) and then look the document up by its code.
//
// `simulateTimeoutMs` only shortens THIS client's wait for the first answer, to
// show the situation. It changes nothing on the API side.
import { FactaError, type DocumentStatus, type DteRequest, type Facta, type IssueResult } from "../../../mod.ts";

export interface Input {
  request: DteRequest;
  idempotencyKey: string;
  simulateTimeoutMs?: number;
}

export interface Output {
  steps: string[];
  uncertain: boolean;
  result: IssueResult;
  status: DocumentStatus;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when the answer never arrived: the outcome is unknown, not refused. */
function isUncertain(error: unknown): boolean {
  if (error instanceof FactaError) return error.code === "network_error" || error.code === "idempotency_in_flight";
  const name = (error as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

export async function run(facta: Facta, input: Input): Promise<Output> {
  const steps: string[] = [];
  let result: IssueResult | null = null;
  try {
    const signal = input.simulateTimeoutMs === undefined ? undefined : AbortSignal.timeout(input.simulateTimeoutMs);
    result = await facta.issue(input.request, {
      idempotencyKey: input.idempotencyKey,
      ...(signal === undefined ? {} : { signal }),
    });
    steps.push("La primera llamada respondió a tiempo.");
  } catch (error) {
    if (!isUncertain(error)) throw error;
    steps.push("La primera llamada no respondió a tiempo: no sabemos si el documento se emitió.");
  }
  const uncertain = result === null;

  // Recovery: same request, same key. The API never issues a second document.
  for (let attempt = 1; result === null && attempt <= 5; attempt++) {
    try {
      result = await facta.issue(input.request, { idempotencyKey: input.idempotencyKey });
      steps.push(`Reintento ${attempt} con la misma llave: el API devolvió el documento original.`);
    } catch (error) {
      if (!(error instanceof FactaError) || error.code !== "idempotency_in_flight") throw error;
      steps.push(`Reintento ${attempt}: la primera emisión sigue en curso; se espera.`);
      await sleep(2_000);
    }
  }
  if (result === null) throw new Error("The first issuance is still in flight; look it up later by its idempotency key.");

  // Confirm by lookup. This also answers for documents Hacienda rejected.
  const status = await facta.getDocumentStatus(result.codigoGeneracion);
  steps.push(`Consulta por código: ${status.estado}.`);
  return { steps, uncertain, result, status };
}

export const sample: Input = {
  request: {
    tipoDte: "01",
    items: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1 }],
  },
  idempotencyKey: "erp-order-1044",
  simulateTimeoutMs: 250,
};
