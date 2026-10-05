// Delivery by e-mail and WhatsApp (docs/api-delivery-tokens.md §3, §5): the SDK's
// own behaviour against a fake transport. What the server decides (masking,
// quotas, wallet) is not asserted here.

import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import { deliveryRequestFor } from "../src/delivery.ts";

const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const TOKEN = "fdt_SECRET-delivery-token-value";

interface Recorded {
  url: string;
  method: string;
  body: string | null;
}

function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const client = (fetch: typeof globalThis.fetch) => new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0 });
const VENTA = { tipoDte: "01" as const, items: [{ descripcion: "x", cantidad: 1, precioUni: 10 }] };
const SEALED = {
  estado: "sellado",
  codigoGeneracion: CG,
  numeroControl: "DTE-01-M001P001-000000000000175",
  tipoDte: "01",
  entrega: {
    token: TOKEN,
    venceEn: "2026-10-05T18:05:00Z",
    canales: { correo: { estado: "pendiente", destino: "m•••@ejemplo.com" } },
  },
};

Deno.test("issue maps deliver to the Spanish wire entrega and exposes the token", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const result = await client(fetch).issue(VENTA, {
    deliver: { email: "cliente@ejemplo.com", whatsapp: { number: "+50370000000", consent: true } },
  });
  const body = JSON.parse(calls[0].body!);
  assertEquals(body.entrega, { correo: "cliente@ejemplo.com", whatsapp: { numero: "+50370000000", consentimiento: true } });
  assertEquals(body.tipoDte, "01");
  assertEquals(result.entrega?.token, TOKEN);
  assertEquals(result.entrega?.canales.correo?.estado, "pendiente");
});

Deno.test("issue without deliver sends no entrega; email: true is sent as true", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }, { status: 200, body: SEALED }]);
  const facta = client(fetch);
  await facta.issue(VENTA);
  await facta.issue(VENTA, { deliver: { email: true } });
  assertEquals("entrega" in JSON.parse(calls[0].body!), false);
  assertEquals(JSON.parse(calls[1].body!).entrega, { correo: true });
});

Deno.test("deliver is validated before anything is sent: consent, number, address, empty", () => {
  assertThrows(() => deliveryRequestFor({}), TypeError, "at least one channel");
  assertThrows(() => deliveryRequestFor({ email: "not-an-address" }), TypeError, "e-mail");
  assertThrows(() => deliveryRequestFor({ whatsapp: { number: "abc", consent: true } }), TypeError, "phone");
  assertThrows(() => deliveryRequestFor({ whatsapp: { number: "+50370000000", consent: false as never } }), TypeError, "consent");
});

Deno.test("deliverEmail and deliverWhatsApp POST the token to their own route; 202 is not an error", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { canal: "correo", estado: "enviado", destino: "m•••@ejemplo.com" } },
    { status: 202, body: { canal: "whatsapp", estado: "en_proceso" } },
  ]);
  const facta = client(fetch);
  const email = await facta.deliverEmail(CG, TOKEN);
  const wa = await facta.deliverWhatsApp(CG, TOKEN);
  assertEquals(email.estado, "enviado");
  assertEquals(wa.estado, "en_proceso");
  assert(calls[0].url.endsWith(`/v1/dte/${CG}/entrega/correo`));
  assert(calls[1].url.endsWith(`/v1/dte/${CG}/entrega/whatsapp`));
  assertEquals(JSON.parse(calls[0].body!), { token: TOKEN });
});

Deno.test("an expired token is FactaError entrega_vencida (410) and never echoes the token", async () => {
  const { fetch } = fakeFetch([{
    status: 410,
    body: { error: { code: "entrega_vencida", message: `Token ${TOKEN} expiró`, details: { echoed: `bearer ${TOKEN}`, token: TOKEN } } },
  }]);
  const error = await assertRejects(() => client(fetch).deliverEmail(CG, TOKEN), FactaError);
  assertEquals(error.code, "entrega_vencida");
  assertEquals(error.status, 410);
  assert(!JSON.stringify({ m: error.message, d: error.details }).includes(TOKEN));
});

Deno.test("canal_no_marcado and entrega_token_invalido surface as typed codes", async () => {
  for (const code of ["canal_no_marcado", "entrega_token_invalido"] as const) {
    const { fetch } = fakeFetch([{ status: 403, body: { error: { code, message: "x" } } }]);
    const error = await assertRejects(() => client(fetch).deliverWhatsApp(CG, TOKEN), FactaError);
    assertEquals(error.code, code);
  }
});

Deno.test("getDelivery reads GET …/entrega", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { canales: { correo: { estado: "enviado" } } } }]);
  const status = await client(fetch).getDelivery(CG);
  assertEquals(status.canales.correo?.estado, "enviado");
  assertEquals(calls[0].method, "GET");
  assert(calls[0].url.endsWith(`/v1/dte/${CG}/entrega`));
});

Deno.test("waitForDelivery polls until every requested channel is final", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { canales: { correo: { estado: "en_proceso" }, whatsapp: { estado: "pendiente" } } } },
    { status: 200, body: { canales: { correo: { estado: "enviado" }, whatsapp: { estado: "en_proceso" } } } },
    { status: 200, body: { canales: { correo: { estado: "enviado" }, whatsapp: { estado: "sin_credito", motivo: "wallet_empty" } } } },
  ]);
  const done = await client(fetch).waitForDelivery(CG, { intervalMs: 1, timeoutMs: 5_000 });
  assertEquals(done.settled, true);
  assertEquals(calls.length, 3);
  assertEquals(done.canales.whatsapp?.estado, "sin_credito");
});

Deno.test("waitForDelivery with channels ignores the others, and returns settled:false on timeout", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { canales: { correo: { estado: "enviado" }, whatsapp: { estado: "en_proceso" } } } },
  ]);
  const onlyEmail = await client(fetch).waitForDelivery(CG, { channels: ["correo"], intervalMs: 1 });
  assertEquals(onlyEmail.settled, true);
  assertEquals(calls.length, 1);
  const stuck = await client(fetch).waitForDelivery(CG, { intervalMs: 5, timeoutMs: 30 });
  assertEquals(stuck.settled, false);
  assertEquals(stuck.canales.whatsapp?.estado, "en_proceso");
});

Deno.test("waitForDelivery honours an abort signal", async () => {
  const { fetch } = fakeFetch([{ status: 200, body: { canales: { correo: { estado: "en_proceso" } } } }]);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assertRejects(() => client(fetch).waitForDelivery(CG, { intervalMs: 5, timeoutMs: 5_000, signal: controller.signal }));
});

Deno.test("esperando_sello is not waited for", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { canales: { correo: { estado: "esperando_sello" } } } }]);
  const done = await client(fetch).waitForDelivery(CG, { intervalMs: 1 });
  assertEquals(done.settled, true);
  assertEquals(calls.length, 1);
});
