import { describe, expect, it } from "vitest";
import { formatCountdown, isExpiredDelivery, offerOf, secondsLeft, sendGate, summaryOf } from "../site/sections/server/mail-window.ts";

const T0 = Date.parse("2026-10-07T03:14:00Z");
const offer = (over: Record<string, unknown> = {}) => offerOf({ entrega: { token: "tok", venceEn: new Date(T0 + 5 * 60_000).toISOString(), canales: { correo: { estado: "pendiente" } }, ...over } })!;
const gate = (o: ReturnType<typeof offerOf>, now: number, extra: Partial<Parameters<typeof sendGate>[0]> = {}) =>
  sendGate({ offer: o, now, busy: false, ready: true, hasContinuation: true, ...extra });

describe("countdown", () => {
  it("counts whole seconds down to zero and never below", () => {
    const at = new Date(T0 + 272_000).toISOString();
    expect(secondsLeft(at, T0)).toBe(272);
    expect(formatCountdown(272)).toBe("4:32");
    expect(secondsLeft(at, T0 + 272_001)).toBe(0);
    expect(secondsLeft(at, T0 + 999_999)).toBe(0);
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(65)).toBe("1:05");
  });
  it("has nothing to count without a usable expiry", () => {
    expect(secondsLeft(null, T0)).toBeNull();
    expect(secondsLeft("not a date", T0)).toBeNull();
  });
});

describe("«Enviar el correo» gating", () => {
  it("is off, with a reason, before call 1", () => {
    const g = gate(null, T0);
    expect(g.enabled).toBe(false);
    expect(g.reason).toMatch(/Primero emita/);
  });
  it("is on while the token is alive and off from the instant it expires", () => {
    expect(gate(offer(), T0).enabled).toBe(true);
    expect(gate(offer(), T0 + 299_000).enabled).toBe(true);
    const dead = gate(offer(), T0 + 300_000);
    expect(dead.enabled).toBe(false);
    expect(dead.expired).toBe(true);
    expect(dead.reason).toMatch(/venció/);
  });
  it("explains a contingency document: no token, the e-mail goes out when Hacienda confirms", () => {
    const g = gate(offerOf({ entrega: { venceEn: null, canales: {} } }), T0);
    expect(g.enabled).toBe(false);
    expect(g.reason).toBe("Sin token de entrega: el correo se enviará cuando Hacienda confirme el documento.");
  });
  it("waits for Turnstile and for a free call, and needs the hand-over of call 1", () => {
    expect(gate(offer(), T0, { ready: false }).reason).toMatch(/verificación/);
    expect(gate(offer(), T0, { busy: true }).enabled).toBe(false);
    expect(gate(offer(), T0, { hasContinuation: false }).enabled).toBe(false);
  });
});

describe("what the stages return", () => {
  it("reads entrega from the issue result", () => {
    expect(offerOf({})).toBeNull();
    expect(offer().token).toBe("tok");
    expect(offerOf({ entrega: { venceEn: "x", canales: {} } })!.token).toBeUndefined();
  });
  it("recognises an expired token however it is reported", () => {
    expect(isExpiredDelivery({ code: "entrega_vencida", status: 410 })).toBe(true);
    expect(isExpiredDelivery({ code: "delivery_window_closed", status: 410 })).toBe(true);
    expect(isExpiredDelivery({ code: "mail_quota_exceeded", status: 429 })).toBe(false);
    expect(isExpiredDelivery(undefined)).toBe(false);
  });
  it("names the two attachments by generation code", () => {
    const s = summaryOf({ destino: "m•••@x.com", channel: { estado: "pendiente" }, delivery: { settled: true, canales: { correo: { estado: "enviado", actualizado: "2026-10-07T03:14:15Z" } } } }, "ABCD")!;
    expect(s.adjuntos).toEqual(["ABCD.json", "ABCD.pdf"]);
    expect(s.solicitado).toBe("pendiente");
    expect(s.estado).toBe("enviado");
    expect(s.settled).toBe(true);
  });
});
