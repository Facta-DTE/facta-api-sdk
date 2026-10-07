// Next.js (App Router): the two route handlers behind the invoicing window.
//
// Save the two exports below as separate files (shown here together so they type-check as one unit):
//   app/api/facta/route.ts              → export { POST } from the first block
//   app/api/checkout/session/route.ts   → the second block
// The handler is `(req: Request) => Promise<Response>`, which is exactly a route handler.
//
// Based on playground/server/facta.ts. Playground-only concerns (Turnstile, quota, masking, mock mode) removed.
// Serverless: create ONE Facta per module and pass `region` to skip the discovery request.
import { Facta, FactaError } from "@facta-dte/api";
import { createFactaHandler, createFactaSession } from "@facta-dte/api/server";
import { keyOf, loadOrder, orderToRequest, OrderError, requireEnv } from "./shared-order.ts";

const facta = new Facta({
  apiKey: requireEnv("FACTA_API_KEY"),
  signKey: requireEnv("FACTA_SIGN_KEY"),
  region: "us-west-2",
});

/** TODO: your real authentication (cookies(), a session library…). */
async function isLoggedIn(_req: Request): Promise<boolean> {
  return true;
}

const handler = createFactaHandler({
  facta,
  sessionSecret: requireEnv("FACTA_SESSION_SECRET"),
  authorize: (req) => isLoggedIn(req),
  // Serverless runtimes may freeze work after the response; this bounds how long the channel starts are awaited.
  deliveryStartTimeoutMs: 1_500,
  onIssued: async (result, { session }) => {
    // Persist result.codigoGeneracion / numeroControl against session.idempotencyKey (idempotent upsert).
    void result; void session;
  },
});

// ---- app/api/facta/route.ts ----
export const POST = (req: Request): Promise<Response> => handler(req);

// ---- app/api/checkout/session/route.ts ----
export async function createSessionRoute(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { orderId?: unknown };
    const order = await loadOrder(typeof body.orderId === "string" ? body.orderId : "");
    const session = await createFactaSession({
      request: orderToRequest(order),
      idempotencyKey: keyOf(order),
      display: { reference: order.orderId },
      ...(order.email === undefined ? {} : { deliver: { email: order.email } }),
    }, requireEnv("FACTA_SESSION_SECRET"));
    return Response.json({ session });
  } catch (error) {
    if (error instanceof OrderError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof FactaError) return Response.json({ error: error.code }, { status: 502 });
    throw error;
  }
}
