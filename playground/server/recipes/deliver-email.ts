// Recipe 8 · Issue, then e-mail the document: TWO separate calls.
//
// 1. `facta.issue(request, { idempotencyKey, deliver: { email } })` seals the document and marks the
//    e-mail channel. Issuing never waits for delivery. The sealed result carries `entrega.token`.
// 2. `facta.deliverEmail(codigoGeneracion, token)` asks for the e-mail, and `facta.waitForDelivery(...)`
//    follows it until it is final.
//
// WHY IT IS SPLIT. The token proves that the caller JUST issued this very document: it is bound to the
// document and to the idempotency key, and it lives five minutes. Without it anyone holding an API key
// could point `deliverEmail` at any code and use the API as a mail relay for documents they never issued.
// With it, only the call that issued the document can send it, and only right away.
//
// AFTER FIVE MINUTES the token is dead: `deliverEmail` answers `entrega_vencida` (HTTP 410). The document is
// still sealed and valid; only the e-mail from this token is gone. `getDelivery` keeps working to read the
// state. To send it again, issue the next document (a new token) — or, if you kept the e-mail marked, resend
// within the window. Keep the token on your server: it is a bearer secret for those five minutes.
//
// A channel that cannot be delivered is a STATE (`fallido`, …), not an exception.
import type { DeliveryChannelResult, DteRequest, Facta, IssueResult, WaitedDelivery } from "../../../mod.ts";

export interface IssueInput {
  request: DteRequest;
  /** Your order id: issuing the same order twice is one document (and one e-mail token). */
  idempotencyKey: string;
  email: string;
}

/** Call 1: issue and mark the e-mail. Hands back what call 2 needs. */
export async function issueWithDelivery(facta: Facta, input: IssueInput): Promise<{ result: IssueResult; code: string; token: string | undefined }> {
  const result = await facta.issue(input.request, { idempotencyKey: input.idempotencyKey, deliver: { email: input.email } });
  // A document in contingency has no token yet: the e-mail goes out when Hacienda confirms it.
  return { result, code: result.codigoGeneracion, token: result.entrega?.token };
}

export interface SendInput {
  code: string;
  /** `result.entrega.token` from call 1. Valid five minutes. */
  token: string;
}

/** Call 2: start the e-mail with the token, then follow it to its final state. */
export async function sendEmail(facta: Facta, input: SendInput): Promise<{ channel: DeliveryChannelResult; delivery: WaitedDelivery }> {
  const channel = await facta.deliverEmail(input.code, input.token);
  const delivery = await facta.waitForDelivery(input.code, { channels: ["correo"], timeoutMs: 20_000, intervalMs: 2_000 });
  return { channel, delivery };
}

/** Both calls, in order, for when one process does everything. */
export async function run(facta: Facta, input: IssueInput): Promise<{ issued: IssueResult; delivery: WaitedDelivery | null; note?: string }> {
  const { result, code, token } = await issueWithDelivery(facta, input);
  if (token === undefined) return { issued: result, delivery: null, note: "Sin token de entrega: el correo se enviará cuando Hacienda confirme el documento." };
  const { delivery } = await sendEmail(facta, { code, token });
  return { issued: result, delivery };
}

// Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: IssueInput = {
  request: { tipoDte: "01", items: [{ descripcion: "Servicio de prueba", cantidad: 1, precioUni: 1 }] },
  idempotencyKey: "erp-order-1042-mail",
  email: "cliente@ejemplo.com",
};
