// Node + Express: the server half of the web invoicing window.
//
//   POST /api/checkout/session  your page asks for a session for ITS order (you decide the request)
//   POST /api/facta             the handler the browser components talk to
//
// Keys live only here. The browser gets an opaque, signed session token and nothing else.
// Based on playground/server/facta.ts (client + createFactaHandler wiring). Playground-only concerns were
// removed: Turnstile, the per-visitor quota, response masking and mock mode. Use your own login in `authorize`.
//
// Env: FACTA_API_KEY, FACTA_SIGN_KEY, FACTA_SESSION_SECRET (>= 32 bytes), optional FACTA_API_REGION.
import express from "express";
import { Facta, FactaError } from "@facta-dte/api";
import { createFactaHandler, createFactaSession, toNodeHandler } from "@facta-dte/api/server";
import { keyOf, loadOrder, orderToRequest, OrderError, requireEnv } from "./shared-order.ts";

const sessionSecret = requireEnv("FACTA_SESSION_SECRET");

const facta = new Facta({
  apiKey: requireEnv("FACTA_API_KEY"),
  signKey: requireEnv("FACTA_SIGN_KEY"),
  // In serverless code pass the region to skip the discovery request: region: "us-west-2".
  config: { version: 1, expectedEnvironment: process.env.FACTA_API_KEY?.startsWith("facta_live_") ? "01" : "00" },
});

/** TODO: your real authentication (a session cookie, a JWT). Return false to answer 403. */
const isLoggedIn = (_headers: Headers): boolean => true;

const handler = createFactaHandler({
  facta,
  sessionSecret,
  authorize: (req) => isLoggedIn(req.headers),
  // Persist the result in YOUR database. Make it idempotent: a window can be reopened for the same order.
  onIssued: (result, { session }) => {
    console.info("issued", session.idempotencyKey, result.estado, result.codigoGeneracion);
  },
  onEvent: (event) => console.info("facta event", event.type),
});

const app = express();

// The handler reads the body itself; mount it before any JSON parser.
app.post("/api/facta", toNodeHandler(handler));

app.post("/api/checkout/session", express.json(), async (req, res) => {
  try {
    const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
    const order = await loadOrder(orderId); // YOUR stored order, never the browser's numbers
    const session = await createFactaSession({
      request: orderToRequest(order),
      idempotencyKey: keyOf(order),
      display: { reference: order.orderId },
      ...(order.email === undefined ? {} : { deliver: { email: order.email } }),
    }, sessionSecret);
    res.json({ session });
  } catch (error) {
    if (error instanceof OrderError) return void res.status(400).json({ error: error.message });
    if (error instanceof FactaError) return void res.status(502).json({ error: error.code });
    throw error;
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.info(`Listening on :${port}`));
