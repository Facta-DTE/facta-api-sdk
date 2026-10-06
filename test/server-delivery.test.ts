// The handler's delivery half: `deliver` comes only from the session, channel POSTs
// start without blocking the response, the browser holds an opaque handle, and the
// Facta delivery token never appears in anything the browser receives.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { DeliveryChannelResult, DeliveryStatus, IssueResult } from "../src/types.ts";
import { FactaError } from "../src/errors.ts";
import { openDeliveryHandle, sealDeliveryHandle } from "../src/server/delivery-handle.ts";
import {
  createFactaHandler,
  createFactaSession,
  type CreateFactaSessionInput,
  type FactaHandlerEvent,
  type FactaLike,
  verifyFactaSession,
} from "../server.ts";

const SECRET = "x".repeat(48);
const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const TOKEN = "fdt_SECRET-delivery-token-value";
const FUTURE = new Date(Date.now() + 5 * 60_000).toISOString();

const SEALED = {
  estado: "sellado",
  codigoGeneracion: CG,
  numeroControl: "DTE-01-M001P001-000000000000175",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "10:00:00",
  selloRecibido: "2026ABC",
  observaciones: [],
  totales: { totalPagar: 11.3 },
  documento: {},
  jws: "h.p.s",
  entrega: {
    token: TOKEN,
    venceEn: FUTURE,
    canales: {
      correo: { estado: "pendiente", destino: "m•••@ejemplo.com" },
      whatsapp: { estado: "pendiente", destino: "+503 •••• 0000" },
    },
  },
};
const REQUEST = { tipoDte: "01" as const, items: [{ descripcion: "Plan", cantidad: 1, precioUni: 10 }] };

interface Fake {
  facta: FactaLike;
  issued: Array<{ deliver: unknown }>;
  sent: Array<{ channel: string; code: string; token: string }>;
  reads: number;
}

function fakeFacta(options: {
  issue?: unknown;
  deliverEmail?: (code: string, token: string) => Promise<DeliveryChannelResult>;
  deliverWhatsApp?: (code: string, token: string) => Promise<DeliveryChannelResult>;
  getDelivery?: () => DeliveryStatus;
} = {}): Fake {
  const fake: Fake = { issued: [], sent: [], reads: 0, facta: undefined as never };
  fake.facta = {
    issue: (_request, call) => {
      fake.issued.push({ deliver: (call as { deliver?: unknown } | undefined)?.deliver });
      return Promise.resolve((options.issue ?? SEALED) as IssueResult);
    },
    getDocumentStatus: () => Promise.resolve({} as never),
    deliverEmail: (code, token) => {
      fake.sent.push({ channel: "correo", code, token });
      return options.deliverEmail ? options.deliverEmail(code, token) : Promise.resolve({ estado: "en_proceso" });
    },
    deliverWhatsApp: (code, token) => {
      fake.sent.push({ channel: "whatsapp", code, token });
      return options.deliverWhatsApp ? options.deliverWhatsApp(code, token) : Promise.resolve({ estado: "en_proceso" });
    },
    getDelivery: () => {
      fake.reads++;
      return Promise.resolve(options.getDelivery?.() ?? { canales: { correo: { estado: "enviado", destino: "m•••@ejemplo.com" } } });
    },
  };
  return fake;
}

function session(patch: Partial<CreateFactaSessionInput> = {}): Promise<string> {
  return createFactaSession({ request: REQUEST, idempotencyKey: "order-1", ...patch }, SECRET);
}

function post(handler: (r: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(new Request("https://shop.test/api/facta", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
    body: JSON.stringify(body),
  }));
}

function make(fake: Fake, extra: Partial<Parameters<typeof createFactaHandler>[0]> = {}) {
  const events: FactaHandlerEvent[] = [];
  const handler = createFactaHandler({
    facta: fake.facta,
    sessionSecret: SECRET,
    authorize: "session-only",
    onEvent: (e) => { events.push(e); },
    ...extra,
  });
  return { handler, events };
}

const DELIVER_BOTH = { email: true as const, whatsapp: { number: "+50370000000", consent: true as const } };

Deno.test("deliver comes from the session only: the API call carries it, the browser cannot add it", async () => {
  const fake = fakeFacta();
  const { handler } = make(fake);
  const marked = await session({ deliver: DELIVER_BOTH });
  await post(handler, { action: "issue", session: marked });
  assertEquals(fake.issued[0].deliver, DELIVER_BOTH);

  // Extra fields in the body are ignored; an unmarked session never delivers.
  const plain = await session();
  const res = await post(handler, { action: "issue", session: plain, deliver: DELIVER_BOTH, entrega: { correo: true } });
  assertEquals(fake.issued[1].deliver, undefined);
  const body = await res.json();
  assertEquals("deliveryHandle" in body, false);
  assertEquals(fake.sent.length, 2); // only the two from the first, marked issue
});

Deno.test("a tampered session cannot gain a deliver marking", async () => {
  const fake = fakeFacta();
  const { handler } = make(fake);
  const token = await session();
  const [body, mac] = token.split(".");
  const payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/")));
  payload.deliver = DELIVER_BOTH;
  const forged = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") + "." + mac;
  const res = await post(handler, { action: "issue", session: forged });
  assertEquals(res.status, 401);
  assertEquals(fake.issued.length, 0);
});

Deno.test("a sealed issue starts each marked channel with the token, and the browser never sees it", async () => {
  const fake = fakeFacta({
    deliverEmail: () => Promise.resolve({ estado: "enviado", destino: "m•••@ejemplo.com" }),
    deliverWhatsApp: () => new Promise<DeliveryChannelResult>(() => {}),
  });
  const { handler } = make(fake, { deliveryStartTimeoutMs: 30 });
  const res = await post(handler, { action: "issue", session: await session({ deliver: DELIVER_BOTH }) });
  const text = await res.text();
  assertEquals(res.status, 200);
  assertEquals(fake.sent.map((s) => s.channel).sort(), ["correo", "whatsapp"]);
  assert(fake.sent.every((s) => s.token === TOKEN && s.code === CG));
  assert(!text.includes(TOKEN), "the Facta delivery token must not reach the browser");
  assert(!text.includes("venceEn"));
  const body = JSON.parse(text);
  assert(typeof body.deliveryHandle === "string");
  assert(!body.deliveryHandle.includes(TOKEN));
  assertEquals(body.delivery.canales.correo.estado, "enviado"); // finished within the short timeout
  assertEquals(body.delivery.canales.whatsapp.estado, "pendiente"); // still running: not awaited
  assertEquals(body.delivery.canales.whatsapp.destino, "+503 •••• 0000");
});

Deno.test("a slow channel does not hold the response beyond the internal timeout", async () => {
  const never = () => new Promise<DeliveryChannelResult>(() => {});
  const fake = fakeFacta({ deliverEmail: never, deliverWhatsApp: never });
  const { handler } = make(fake, { deliveryStartTimeoutMs: 40 });
  const started = Date.now();
  const res = await post(handler, { action: "issue", session: await session({ deliver: DELIVER_BOTH }) });
  assertEquals(res.status, 200);
  assert(Date.now() - started < 1000);
});

Deno.test("a failing channel POST is captured in onEvent and never fails the issue", async () => {
  const fake = fakeFacta({
    deliverEmail: () => Promise.reject(new FactaError("entrega_vencida", `expired ${TOKEN}`, 410)),
  });
  const { handler, events } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  assertEquals(res.status, 200);
  await new Promise((r) => setTimeout(r, 5));
  const failure = events.find((e) => e.type === "delivery_error");
  assertEquals(failure && "code" in failure ? failure.code : null, "entrega_vencida");
  assert(!JSON.stringify(events).includes(TOKEN));
});

Deno.test("a quota_exceeded e-mail state reaches the browser as a state, with no delivery_error and a 200 issue", async () => {
  const fake = fakeFacta({
    deliverEmail: () => Promise.resolve({ estado: "fallido", motivo: "quota_exceeded", destino: "m•••@ejemplo.com" }),
  });
  const { handler, events } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.result.estado, "sellado");
  assertEquals(body.delivery.canales.correo.estado, "fallido");
  assertEquals(body.delivery.canales.correo.motivo, "quota_exceeded");
  await new Promise((r) => setTimeout(r, 5));
  assertEquals(events.some((e) => e.type === "delivery_error"), false);
});

Deno.test("a rate-limited channel POST (429) is an event, never a failed issue", async () => {
  const fake = fakeFacta({
    deliverEmail: () => Promise.reject(new FactaError("rate_limited", "slow down", 429)),
  });
  const { handler, events } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).result.estado, "sellado");
  await new Promise((r) => setTimeout(r, 5));
  const failure = events.find((e) => e.type === "delivery_error");
  assertEquals(failure && "status" in failure ? failure.status : null, 429);
});

Deno.test("a contingency document marks channels but never POSTs (no token)", async () => {
  const fake = fakeFacta({
    issue: {
      estado: "contingencia", codigoGeneracion: CG, numeroControl: "n", tipoDte: "01", ambiente: "00",
      fecEmi: "2026-10-05", horEmi: "10:00:00", detalle: "x", documento: {}, jws: "j",
      entrega: { canales: { correo: { estado: "esperando_sello", destino: "m•••@ejemplo.com" } } },
    },
  });
  const { handler } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  const body = await res.json();
  assertEquals(fake.sent.length, 0);
  assertEquals(body.delivery.canales.correo.estado, "esperando_sello");
});

Deno.test("only channels the session marked are reported to the browser", async () => {
  const fake = fakeFacta();
  const { handler } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  const body = await res.json();
  assertEquals(Object.keys(body.delivery.canales), ["correo"]);
  assertEquals(fake.sent.map((s) => s.channel), ["correo"]);
});

Deno.test("delivery.status returns masked states for the session's own handle", async () => {
  const fake = fakeFacta({
    getDelivery: () => ({
      codigoGeneracion: CG,
      canales: {
        correo: { estado: "enviado", destino: "m•••@ejemplo.com", actualizado: "2026-10-05T18:00:00Z", internal: "x" } as never,
        whatsapp: { estado: "sin_credito", motivo: "wallet_empty", destino: "+503 •••• 0000" },
      },
    }),
  });
  const { handler } = make(fake);
  const token = await session({ deliver: DELIVER_BOTH });
  const issued = await (await post(handler, { action: "issue", session: token })).json();
  const res = await post(handler, { action: "delivery.status", session: token, deliveryHandle: issued.deliveryHandle });
  const text = await res.text();
  assertEquals(res.status, 200);
  assert(!text.includes(TOKEN));
  assert(!text.includes("internal"));
  const body = JSON.parse(text);
  assertEquals(body.delivery.canales.correo, { estado: "enviado", destino: "m•••@ejemplo.com", actualizado: "2026-10-05T18:00:00Z" });
  assertEquals(body.delivery.canales.whatsapp.estado, "sin_credito");
  assertEquals(body.delivery.canales.whatsapp.motivo, "wallet_empty");
});

Deno.test("delivery.status refuses a tampered, foreign-session or expired handle with one generic 403", async () => {
  const fake = fakeFacta();
  const { handler } = make(fake);
  const mine = await session({ deliver: DELIVER_BOTH });
  const issued = await (await post(handler, { action: "issue", session: mine })).json();
  const handle: string = issued.deliveryHandle;

  const flipped = handle.slice(0, -2) + (handle.endsWith("AA") ? "BB" : "AA");
  const other = await session({ deliver: DELIVER_BOTH, idempotencyKey: "order-2" });
  const mineSession = await verifyFactaSession(mine, SECRET);
  const expired = await sealDeliveryHandle(SECRET, mineSession.nonce, { codigoGeneracion: CG }, { now: Date.now() - 2 * 3600_000 });
  for (
    const [label, sess, h] of [
      ["tampered", mine, flipped],
      ["foreign session", other, handle],
      ["expired", mine, expired],
      ["missing", mine, undefined],
    ] as const
  ) {
    const res = await post(handler, { action: "delivery.status", session: sess, deliveryHandle: h });
    assertEquals(res.status, 403, label);
    assertEquals((await res.json()).error.code, "action_not_allowed", label);
  }
  assertEquals(fake.reads, 0);
});

Deno.test("delivery.status retries a channel still pendiente while the token lives, never after it expired", async () => {
  const fake = fakeFacta({
    getDelivery: () => ({ canales: { correo: { estado: "pendiente", destino: "m•••@ejemplo.com" } } }),
    deliverEmail: () => Promise.resolve({ estado: "enviado", destino: "m•••@ejemplo.com" }),
  });
  const { handler } = make(fake);
  const token = await session({ deliver: { email: true } });
  const issued = await (await post(handler, { action: "issue", session: token })).json();
  assertEquals(fake.sent.length, 1);
  const res = await post(handler, { action: "delivery.status", session: token, deliveryHandle: issued.deliveryHandle });
  assertEquals(fake.sent.length, 2);
  assertEquals((await res.json()).delivery.canales.correo.estado, "enviado");

  const s = await verifyFactaSession(token, SECRET);
  const dead = await sealDeliveryHandle(SECRET, s.nonce, { codigoGeneracion: CG, token: TOKEN, tokenExp: Math.floor(Date.now() / 1000) - 10 });
  await post(handler, { action: "delivery.status", session: token, deliveryHandle: dead });
  assertEquals(fake.sent.length, 2);
});

Deno.test("the handle's token is encrypted: not readable, only openable with the secret and nonce", async () => {
  const handle = await sealDeliveryHandle(SECRET, "nonce-1", { codigoGeneracion: CG, token: TOKEN, tokenExp: 4_000_000_000 });
  const [body] = handle.split(".");
  const decoded = atob(body.replaceAll("-", "+").replaceAll("_", "/"));
  assert(!decoded.includes(TOKEN));
  assert(!handle.includes(TOKEN));
  assertEquals((await openDeliveryHandle(SECRET, handle, "nonce-1"))?.token, TOKEN);
  assertEquals(await openDeliveryHandle(SECRET, handle, "nonce-2"), null);
  assertEquals(await openDeliveryHandle("y".repeat(48), handle, "nonce-1"), null);
});

Deno.test("a handler whose client has no delivery methods still issues and reports the error", async () => {
  const fake = fakeFacta();
  delete (fake.facta as { deliverEmail?: unknown }).deliverEmail;
  const { handler, events } = make(fake);
  const res = await post(handler, { action: "issue", session: await session({ deliver: { email: true } }) });
  assertEquals(res.status, 200);
  await new Promise((r) => setTimeout(r, 5));
  assert(events.some((e) => e.type === "delivery_error"));
});

Deno.test("createFactaSession refuses a malformed deliver marking", async () => {
  await assertRejects(() => session({ deliver: { whatsapp: { number: "+50370000000", consent: false as never } } }), TypeError);
  await assertRejects(() => session({ deliver: {} }), TypeError);
});
