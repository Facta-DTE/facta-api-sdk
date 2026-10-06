// Recipe 8 · Deliver a document by e-mail, then follow the delivery.
//
// Issuing never waits for delivery. Mark the channel when you issue (`deliver.email`), take the
// delivery token the sealed result carries (valid five minutes), ask for the e-mail with
// `deliverEmail`, and read the state with `waitForDelivery`. A channel that cannot be delivered is a
// state (`fallido`, …), not an exception. The token is a secret: keep it on your server.
import type { DteRequest, Facta, IssueResult, WaitedDelivery } from "../../../mod.ts";

export interface Input {
  /** Absent when you deliver a document you already issued (then `code` and `token` are given). */
  request?: DteRequest;
  idempotencyKey?: string;
  email: string;
  code?: string;
  token?: string;
}

export async function run(facta: Facta, input: Input): Promise<{ issued?: IssueResult; delivery: WaitedDelivery | null; note?: string }> {
  let code = input.code;
  let token = input.token;
  let issued: IssueResult | undefined;
  if (code === undefined || token === undefined) {
    issued = await facta.issue(input.request!, { idempotencyKey: input.idempotencyKey!, deliver: { email: input.email } });
    code = issued.codigoGeneracion;
    token = issued.entrega?.token;
    // A document in contingency has no token yet: the e-mail goes out when Hacienda confirms it.
    if (token === undefined) return { issued, delivery: null, note: "Sin token de entrega: el correo se enviará cuando Hacienda confirme el documento." };
  }
  await facta.deliverEmail(code, token);
  const delivery = await facta.waitForDelivery(code, { channels: ["correo"], timeoutMs: 20_000, intervalMs: 2_000 });
  return { ...(issued === undefined ? {} : { issued }), delivery };
}

// Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: Input = {
  request: { tipoDte: "01", items: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1 }] },
  idempotencyKey: "erp-order-1042-mail",
  email: "cliente@ejemplo.com",
};
