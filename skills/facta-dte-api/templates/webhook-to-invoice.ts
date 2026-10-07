// Order paid → sealed invoice → e-mail it. An INTEGRATION EXAMPLE: Facta DTE has no orders. Your shop
// (Shopify, WooCommerce, your own) sends YOUR server a webhook; this is what your server does with it.
//
// Adapted from the playground recipes order-webhook.ts (order → request, key = order) and
// deliver-email.ts (issue marks the channel; a second call starts it with the 5-minute token).
// Playground-only concerns removed: per-visitor key tags, quota, redaction, masking, mock mode.
//
// Rules this file follows:
//  - verify the webhook's authenticity BEFORE anything else (the shop's own scheme; stub below);
//  - the fiscal request comes from YOUR order, never from the payload's prices;
//  - the idempotency key is the order, so a webhook delivered twice issues ONE invoice;
//  - a contingency is a success; a delivery problem is a state, never a reason to issue again.
import { Facta, FactaError, type IssueResult } from "@facta-dte/api";
import { keyOf, loadOrder, orderToRequest, OrderError, requireEnv } from "./shared-order.ts";

const facta = new Facta({ apiKey: requireEnv("FACTA_API_KEY"), signKey: requireEnv("FACTA_SIGN_KEY") });

/** TODO: verify the shop's signature (HMAC of the raw body, a shared secret…). Never skip this. */
function verifyWebhook(_rawBody: string, _headers: Headers): boolean {
  return false; // fail closed until you implement it
}

export interface Outcome {
  /** HTTP status your webhook endpoint should answer, so the shop retries only when it makes sense. */
  status: 200 | 202 | 400 | 401 | 502 | 503;
  codigoGeneracion?: string;
  estado?: IssueResult["estado"];
  note?: string;
}

/** Call 1 + call 2 of the mail flow: issue with the e-mail marked, then start it with the token. */
async function issueAndMail(order: Awaited<ReturnType<typeof loadOrder>>): Promise<IssueResult> {
  const request = orderToRequest(order);
  const result = await facta.issue(request, {
    idempotencyKey: keyOf(order), // same order → same key → same invoice, however many webhooks arrive
    ...(order.email === undefined ? {} : { deliver: { email: order.email } }),
  });
  const token = result.estado === "sellado" ? result.entrega?.token : undefined;
  // No token: contingency (the mail goes out when Hacienda confirms) or nothing deliverable. Not an error.
  if (token !== undefined) {
    await facta.deliverEmail(result.codigoGeneracion, token); // within 5 minutes of issuing; keep the token server-side
    const delivery = await facta.waitForDelivery(result.codigoGeneracion, { channels: ["correo"], timeoutMs: 20_000 });
    if (!delivery.settled) console.warn("mail still in progress; read it later with getDelivery()");
  }
  return result;
}

export async function onOrderPaid(rawBody: string, headers: Headers): Promise<Outcome> {
  if (!verifyWebhook(rawBody, headers)) return { status: 401 };
  let orderId: string;
  try {
    orderId = String((JSON.parse(rawBody) as { orderId?: unknown }).orderId ?? "");
  } catch {
    return { status: 400, note: "Body is not JSON." };
  }
  try {
    const result = await issueAndMail(await loadOrder(orderId));
    // Persist result.codigoGeneracion / numeroControl / archivoDte (or archivoJson) with the order here.
    return { status: 200, codigoGeneracion: result.codigoGeneracion, estado: result.estado };
  } catch (error) {
    if (error instanceof OrderError) return { status: 400, note: error.message };
    if (error instanceof FactaError) {
      // Retryable/uncertain: answer 5xx so the shop retries — the same key makes that safe.
      if (["network_error", "service_unavailable", "correlative_unavailable", "idempotency_in_flight", "mh_unreachable"].includes(error.code)) {
        return { status: 503, note: error.code };
      }
      // mh_rejected spent a number (error.spent): fix the data and issue a corrected request with a NEW key.
      // Everything else is final for this request: alert a person, do not loop.
      console.error("issuing failed", error.code, error.spent);
      return { status: 502, note: error.code };
    }
    throw error;
  }
}
