import { describe, expect, it } from "vitest";
import { verifyFactaSession } from "../../src/server/session.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { checkGuard } from "../server/guard.ts";
import { DeliveryError, deliveryFor, maskAddress, mentionsWhatsApp, parseAddress, recipientKey } from "../server/delivery.ts";
import { consumeMail, emptyMail, peekMail } from "../server/mail-quota.ts";
import { readVisitorCookie, signVisitorCookie, newVisitorId, COOKIE_MAX_AGE_SECONDS } from "../server/visitor.ts";
import { TEST_SECRET_FAIL, TEST_SITEKEY_FAIL } from "../server/turnstile.ts";
import { fakeQuotaNamespace, fakeSiteverify, turnstileEnv } from "./helpers.ts";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const URL_BASE = "https://playground.factadte.com";
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";

describe("address rules", () => {
  it.each(["ana@example.com", "a.b+tag@sub.example.co", "x@e-x.com"])("accepts %s", (address) => {
    expect(parseAddress(` ${address} `)).toBe(address);
  });
  it.each([
    ["empty", ""], ["no at", "ana.example.com"], ["two addresses", "a@x.com,b@y.com"], ["semicolon", "a@x.com;b@y.com"],
    ["CR LF header injection", "a@x.com\r\nBcc: b@y.com"], ["space", "a b@x.com"], ["no dot in domain", "a@localhost"],
    ["double dot", "a..b@x.com"], ["leading dot", ".a@x.com"], ["angle brackets", "<a@x.com>"], ["not a string", 42],
    ["too long", `${"a".repeat(250)}@x.com`],
  ])("refuses %s", (_label, value) => {
    expect(() => parseAddress(value)).toThrow(DeliveryError);
  });
  it("masks the address and builds only an e-mail channel", () => {
    expect(maskAddress("marvin@gmail.com")).toBe("m•••@gmail.com");
    expect(deliveryFor("a@x.com")).toEqual({ email: "a@x.com" });
    expect(mentionsWhatsApp({ deliver: { WhatsApp: {} } })).toBe(true);
    expect(mentionsWhatsApp({ canal: "whatsapp" })).toBe(true);
    expect(mentionsWhatsApp({ sendEmail: true })).toBe(false);
  });
  it("hashes recipients case-insensitively and never keeps the address", async () => {
    const a = await recipientKey("secret", "Ana@Example.com");
    expect(a).toBe(await recipientKey("secret", " ana@example.com "));
    expect(a).not.toContain("ana");
    expect(a).not.toBe(await recipientKey("other-secret", "ana@example.com"));
  });
});

describe("e-mail limits (pure)", () => {
  const visitor = (state = emptyMail(), key: string, now: number, doc?: string) =>
    consumeMail(state, { key, scope: "visitor", ...(doc === undefined ? {} : { doc }) }, now);

  it("allows 5 per hour and then refuses with the hour window and a retry time", () => {
    let state = emptyMail();
    for (let i = 0; i < 5; i++) {
      const step = visitor(state, `k${i}`, T0 + i * 1000);
      expect(step.decision.allowed).toBe(true);
      state = step.state;
    }
    const refused = visitor(state, "k5", T0 + 10_000);
    expect(refused.decision).toMatchObject({ allowed: false, window: "hour" });
    expect(refused.decision.retryAfterSeconds).toBeGreaterThan(3500);
    expect(visitor(state, "k6", T0 + HOUR + 1000).decision.allowed).toBe(true);
  });

  it("allows 20 per day across hours, then refuses with the day window", () => {
    let state = emptyMail();
    let n = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (let i = 0; i < 5; i++) {
        const step = visitor(state, `k${n++}`, T0 + hour * (HOUR + 1000) + i);
        expect(step.decision.allowed).toBe(true);
        state = step.state;
      }
    }
    expect(visitor(state, "more", T0 + 4 * (HOUR + 1000)).decision).toMatchObject({ allowed: false, window: "day" });
  });

  it("allows a replay of the same key for free", () => {
    const first = visitor(emptyMail(), "same", T0);
    const second = visitor(first.state, "same", T0 + 1000);
    expect(second.decision.allowed).toBe(true);
    expect(second.decision.remainingHour).toBe(first.decision.remainingHour);
  });

  it("allows one send per document every 10 minutes", () => {
    const first = visitor(emptyMail(), "a", T0, CODE);
    expect(first.decision.allowed).toBe(true);
    const early = visitor(first.state, "b", T0 + 9 * 60_000, CODE.toLowerCase());
    expect(early.decision).toMatchObject({ allowed: false, window: "document" });
    expect(early.decision.retryAfterSeconds).toBe(60);
    expect(visitor(early.state, "c", T0 + 10 * 60_000 + 1, CODE).decision.allowed).toBe(true);
    // Another document is not held back.
    expect(visitor(first.state, "d", T0 + 1000, "AAAAAAAA-9B3D-4A6E-8F10-2D5B7C9E1A34").decision.allowed).toBe(true);
  });

  it("caps one recipient at 2 per day", () => {
    const send = (state: ReturnType<typeof emptyMail>, key: string, now: number) => consumeMail(state, { key, scope: "recipient" }, now);
    let step = send(emptyMail(), "a", T0);
    step = send(step.state, "b", T0 + 1000);
    expect(step.decision.allowed).toBe(true);
    const third = send(step.state, "c", T0 + 2000);
    expect(third.decision).toMatchObject({ allowed: false, window: "recipient" });
    expect(send(third.state, "d", T0 + 24 * HOUR + 3000).decision.allowed).toBe(true);
  });

  it("only checks when commit is false", () => {
    const state = emptyMail();
    const check = consumeMail(state, { key: "x", scope: "visitor" }, T0, false);
    expect(check.state.stamps).toEqual([]);
    expect(peekMail(check.state, T0).remainingHour).toBe(5);
  });
});

describe("visitor cookie", () => {
  const secret = "s".repeat(40);
  it("round-trips a signed id", async () => {
    const id = newVisitorId();
    const cookie = await signVisitorCookie(secret, id, T0);
    expect(await readVisitorCookie(secret, cookie, T0 + 1000)).toEqual({ id, ageSeconds: 1 });
  });
  it("rejects tampering, another secret and an expired cookie", async () => {
    const id = newVisitorId();
    const cookie = await signVisitorCookie(secret, id, T0);
    const [, iat, mac] = cookie.split(".");
    expect(await readVisitorCookie(secret, `${newVisitorId()}.${iat}.${mac}`, T0)).toBeNull();
    expect(await readVisitorCookie(secret, `${id}.${Number(iat) + 5}.${mac}`, T0)).toBeNull();
    expect(await readVisitorCookie("t".repeat(40), cookie, T0)).toBeNull();
    expect(await readVisitorCookie(secret, cookie, T0 + (COOKIE_MAX_AGE_SECONDS + 5) * 1000)).toBeNull();
    expect(await readVisitorCookie(secret, null, T0)).toBeNull();
    expect(await readVisitorCookie(secret, "garbage", T0)).toBeNull();
  });
});

describe("guard in Turnstile mode", () => {
  it("is the default and needs both keys", () => {
    expect(checkGuard(turnstileEnv(), `${URL_BASE}/api/state`)).toEqual({ ok: true, devBypass: false, auth: "turnstile" });
    expect(checkGuard(turnstileEnv({ TURNSTILE_SECRET: undefined } as never), `${URL_BASE}/api/state`)).toMatchObject({ ok: false, code: "turnstile_not_configured" });
    expect(checkGuard(turnstileEnv({ TURNSTILE_SITEKEY: "" }), `${URL_BASE}/api/state`)).toMatchObject({ ok: false, code: "turnstile_not_configured" });
    expect(checkGuard(turnstileEnv({ PLAYGROUND_AUTH: "magic" }), `${URL_BASE}/api/state`)).toMatchObject({ ok: false, code: "auth_mode_invalid" });
  });
});

// --- Through the router ---------------------------------------------------------------

function fakeFacta(log: { issued: number; delivered: Array<{ code: string; token: string }> }, state = { estado: "enviado" }): FactaLike {
  return ({
    environment: "00",
    issue: (async () => {
      log.issued++;
      return {
        estado: "sellado", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000001", tipoDte: "01", ambiente: "00",
        fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", totales: { totalPagar: 1 }, observaciones: [],
        entrega: { token: "fdt_secret_delivery_token", venceEn: new Date(T0 + 5 * 60_000).toISOString(), canales: { correo: { estado: "pendiente", destino: "a•••@x.com" } } },
      };
    }) as unknown as FactaLike["issue"],
    deliverEmail: (async (code: string, token: string) => { log.delivered.push({ code, token }); return { estado: state.estado, destino: "a•••@x.com" }; }) as unknown as FactaLike["deliverEmail"],
    getDocumentStatus: (async () => { throw new Error("unused"); }) as unknown as FactaLike["getDocumentStatus"],
  }) as unknown as FactaLike;
}

async function world(options: { env?: Parameters<typeof turnstileEnv>[0] } = {}) {
  let now = T0;
  const quota = fakeQuotaNamespace(() => now);
  const env = turnstileEnv({ QUOTA: quota, ...(options.env ?? {}) });
  const log = { issued: 0, delivered: [] as Array<{ code: string; token: string }> };
  const verifyCalls: URLSearchParams[] = [];
  const deps = { now: () => now, facta: fakeFacta(log), turnstileFetch: fakeSiteverify(verifyCalls) };
  const visit = async (ip = "203.0.113.7") => {
    const response = await handleApi(new Request(`${URL_BASE}/api/state`, { headers: { "cf-connecting-ip": ip } }), env, deps);
    const cookie = /facta_pg_visitor=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    return { response, cookie: cookie ?? "", ip };
  };
  const api = (visitor: { cookie: string; ip: string }) => async (path: string, body: unknown, extra: Record<string, string> = {}) =>
    handleApi(new Request(`${URL_BASE}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-facta-ui": "1", cookie: `facta_pg_visitor=${visitor.cookie}`, "cf-connecting-ip": visitor.ip, "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX", ...extra },
    }), env, deps);
  return { env, log, verifyCalls, visit, api, advance: (ms: number) => { now += ms; } };
}

const SALE = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] };
const issueBody = (session: string) => ({ action: "issue", session });

async function sessionFor(post: ReturnType<Awaited<ReturnType<typeof world>>["api"]>, to: string) {
  const response = await post("/api/session", { ...SALE, sendEmail: true, emailTo: to });
  expect(response.status).toBe(200);
  return ((await response.json()) as { session: string }).session;
}

describe("Turnstile mode", () => {
  it("mints a signed HttpOnly visitor cookie on /api/state and exposes only the site key", async () => {
    const { visit } = await world();
    const { response, cookie } = await visit();
    expect(cookie).not.toBe("");
    const header = response.headers.get("set-cookie")!;
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(new RegExp(`Max-Age=${COOKIE_MAX_AGE_SECONDS}`));
    const body = await response.json() as { auth: string; turnstileSiteKey: string; whatsapp: boolean; visitor: { label: string; email: null } };
    expect(body).toMatchObject({ auth: "turnstile", turnstileSiteKey: "1x00000000000000000000AA", whatsapp: false, visitor: { email: null } });
    expect(JSON.stringify(body)).not.toContain("1x0000000000000000000000000000000AA");
  });

  it("keeps the same visitor with the cookie and answers 401 without it", async () => {
    const { visit, api } = await world();
    const v = await visit();
    expect((await api({ cookie: "", ip: v.ip })("/api/session", SALE)).status).toBe(401);
    expect((await api(v)("/api/session", SALE)).status).toBe(200);
    const again = await visit();
    expect(again.cookie).not.toBe(v.cookie);
  });

  it("verifies a Turnstile token for every session, sending the secret, the token and the IP", async () => {
    const { visit, api, verifyCalls } = await world();
    const v = await visit();
    expect((await api(v)("/api/session", SALE)).status).toBe(200);
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]!.get("secret")).toBe("1x0000000000000000000000000000000AA");
    expect(verifyCalls[0]!.get("response")).toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(verifyCalls[0]!.get("remoteip")).toBe("203.0.113.7");
  });

  it("refuses a missing token, a failed token and a spent token", async () => {
    const { visit, api } = await world();
    const v = await visit();
    const missing = await api(v)("/api/session", SALE, { "x-turnstile-token": "" });
    expect(missing.status).toBe(403);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("turnstile_missing");
    const spent = await api(v)("/api/session", SALE, { "x-turnstile-token": "spent" });
    expect(((await spent.json()) as { error: { code: string } }).error.code).toBe("turnstile_failed");
  });

  it("refuses everything that costs when the secret is Turnstile's always-fail key", async () => {
    const { visit, api } = await world({ env: { TURNSTILE_SECRET: TEST_SECRET_FAIL, TURNSTILE_SITEKEY: TEST_SITEKEY_FAIL } });
    const v = await visit();
    expect((await api(v)("/api/session", SALE)).status).toBe(403);
    expect((await api(v)("/api/delivery/resend", { codigoGeneracion: CODE })).status).toBe(403);
  });

  it("sends only an e-mail channel, to the typed address, and refuses WhatsApp in any body", async () => {
    const { visit, api, env } = await world();
    const post = api(await visit());
    const refused = await post("/api/session", { ...SALE, sendEmail: true, emailTo: "cliente@example.com", whatsapp: { number: "70000000", consent: true } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("channel_not_allowed");
    const nested = await post("/api/session", { ...SALE, sendEmail: true, emailTo: "cliente@example.com", deliver: { whatsapp: { number: "1", consent: true } } });
    expect(nested.status).toBe(400);
    const ok = await post("/api/session", { ...SALE, sendEmail: true, emailTo: "cliente@example.com" });
    const body = await ok.json() as { session: string; emailTo: string };
    expect(body.emailTo).toBe("c•••@example.com");
    const session = await verifyFactaSession(body.session, env.FACTA_SESSION_SECRET!, T0);
    expect(session.deliver).toEqual({ email: "cliente@example.com" });
    expect(session.deliver).not.toHaveProperty("whatsapp");
  });

  it("rejects an invalid or injected address before anything is sealed", async () => {
    const { visit, api } = await world();
    const post = api(await visit());
    for (const emailTo of ["", "no-at", "a@x.com,b@y.com", "a@x.com\r\nBcc: v@y.com", 7]) {
      const response = await post("/api/session", { ...SALE, sendEmail: true, emailTo });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("email_invalid");
    }
  });

  it("counts 5 e-mails per hour per visitor at issue and answers 429 with Retry-After", async () => {
    const { visit, api, log } = await world();
    const post = api(await visit());
    for (let i = 0; i < 5; i++) {
      const session = await sessionFor(post, `dest${i}@example.com`);
      expect((await post("/api/facta", issueBody(session))).status).toBe(200);
    }
    // The pre-flight at session creation already knows.
    const blocked = await post("/api/session", { ...SALE, sendEmail: true, emailTo: "dest9@example.com" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = await blocked.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("mail_quota_exceeded");
    expect(body.error.message).toMatch(/Se alcanzó el límite de envíos/);
    expect(log.issued).toBe(5);
  });

  it("stops the issue itself when the e-mail limit is hit between session and issue", async () => {
    const { visit, api, log } = await world();
    const post = api(await visit());
    const sessions: string[] = [];
    for (let i = 0; i < 6; i++) sessions.push(await sessionFor(post, `late${i}@example.com`));
    for (let i = 0; i < 5; i++) expect((await post("/api/facta", issueBody(sessions[i]!))).status).toBe(200);
    const sixth = await post("/api/facta", issueBody(sessions[5]!));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).not.toBeNull();
    expect(log.issued).toBe(5);
  });

  it("caps one recipient at 2 per day across different visitors", async () => {
    const { visit, api } = await world();
    const a = api(await visit("203.0.113.1"));
    const b = api(await visit("203.0.113.2"));
    const c = api(await visit("203.0.113.3"));
    expect((await a("/api/facta", issueBody(await sessionFor(a, "victim@example.com")))).status).toBe(200);
    expect((await b("/api/facta", issueBody(await sessionFor(b, "Victim@Example.com")))).status).toBe(200);
    const third = await c("/api/session", { ...SALE, sendEmail: true, emailTo: "victim@example.com" });
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: { message: string } }).error.message).toMatch(/2 por día/);
  });

  it("limits e-mail per IP even when the visitor cookie changes", async () => {
    const { visit, api } = await world();
    const sendFrom = async (visitorIp: string, n: number) => {
      const post = api(await visit(visitorIp));
      return post("/api/facta", issueBody(await sessionFor(post, `ip${n}@example.com`)));
    };
    for (let i = 0; i < 5; i++) expect((await sendFrom("198.51.100.9", i)).status).toBe(200);
    const sixth = await api(await visit("198.51.100.9"))("/api/session", { ...SALE, sendEmail: true, emailTo: "another@example.com" });
    expect(sixth.status).toBe(429);
    // A different IP is a different counter.
    expect((await sendFrom("198.51.100.10", 99)).status).toBe(200);
  });

  it("counts issues per IP as well: 20 per hour even with fresh cookies", async () => {
    const { visit, api } = await world();
    for (let i = 0; i < 20; i++) {
      const post = api(await visit("192.0.2.50"));
      const session = ((await (await post("/api/session", SALE)).json()) as { session: string }).session;
      expect((await post("/api/facta", issueBody(session))).status).toBe(200);
    }
    const post = api(await visit("192.0.2.50"));
    const session = ((await (await post("/api/session", SALE)).json()) as { session: string }).session;
    const refused = await post("/api/facta", issueBody(session));
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("quota_exceeded");
  });

  describe("resend", () => {
    async function issued(post: ReturnType<Awaited<ReturnType<typeof world>>["api"]>) {
      const response = await post("/api/facta", issueBody(await sessionFor(post, "dest@example.com")));
      expect(response.status).toBe(200);
    }

    it("is only for a document the visitor owns", async () => {
      const { visit, api, log } = await world();
      const owner = api(await visit("203.0.113.1"));
      const stranger = api(await visit("203.0.113.2"));
      await issued(owner);
      const refused = await stranger("/api/delivery/resend", { codigoGeneracion: CODE });
      expect(refused.status).toBe(403);
      // Issuing already started the marked channel once; a stranger adds nothing.
      expect(log.delivered).toHaveLength(1);
      const ok = await owner("/api/delivery/resend", { codigoGeneracion: CODE });
      expect(ok.status).toBe(200);
      expect(log.delivered).toEqual([{ code: CODE, token: "fdt_secret_delivery_token" }, { code: CODE, token: "fdt_secret_delivery_token" }]);
      const body = await ok.text();
      expect(body).not.toContain("fdt_secret_delivery_token");
      expect(JSON.parse(body)).toEqual({ canal: { estado: "enviado", destino: "d•••@example.com" } });
    });

    it("allows one resend per document every 10 minutes and answers 429 with Retry-After", async () => {
      const { visit, api, log, advance } = await world();
      const post = api(await visit());
      await issued(post);
      expect((await post("/api/delivery/resend", { codigoGeneracion: CODE })).status).toBe(200);
      advance(60_000);
      const early = await post("/api/delivery/resend", { codigoGeneracion: CODE });
      expect(early.status).toBe(429);
      expect(Number(early.headers.get("retry-after"))).toBe(9 * 60);
      expect(((await early.json()) as { error: { message: string } }).error.message).toMatch(/Se alcanzó el límite de envíos/);
      expect(log.delivered).toHaveLength(2);
      advance(10 * 60_000);
      // The token is only valid five minutes: after that the window is closed, not a limit.
      const late = await post("/api/delivery/resend", { codigoGeneracion: CODE });
      expect(late.status).toBe(410);
    });

    it("refuses WhatsApp, extra fields and a new address", async () => {
      const { visit, api, log } = await world();
      const post = api(await visit());
      await issued(post);
      for (const body of [{ codigoGeneracion: CODE, channel: "whatsapp" }, { codigoGeneracion: CODE, whatsapp: { number: "7" } }]) {
        const response = await post("/api/delivery/resend", body);
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe("channel_not_allowed");
      }
      expect((await post("/api/delivery/resend", { codigoGeneracion: CODE, email: "new@example.com" })).status).toBe(400);
      expect(log.delivered).toHaveLength(1);
    });

    it("needs a Turnstile token", async () => {
      const { visit, api } = await world();
      const post = api(await visit());
      await issued(post);
      expect((await post("/api/delivery/resend", { codigoGeneracion: CODE }, { "x-turnstile-token": "spent" })).status).toBe(403);
    });
  });
});

describe("the server never requests WhatsApp", () => {
  it("has no code path that builds a whatsapp channel", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["server/router.ts", "server/delivery.ts", "server/recipes/index.ts", "server/recipes/deliver-email.ts"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/whatsapp\s*:\s*\{|deliverWhatsApp/);
    }
  });
});

// --- Recipe 8 and the six types in the recipe forms --------------------------------------

const API = "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

function fakeApi(calls: string[]): typeof fetch {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(API.length);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "/v1/dte") {
      return json({
        estado: "sellado", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000001", tipoDte: "01", ambiente: "00",
        fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", totales: { totalPagar: 1 }, observaciones: [],
        entrega: { token: "fdt_recipe_secret_token", venceEn: new Date(T0 + 5 * 60_000).toISOString(), canales: { correo: { estado: "pendiente", destino: "c•••@example.com" } } },
      });
    }
    if (method === "POST" && path.endsWith("/entrega/correo")) return json({ canal: "correo", estado: "enviado", destino: "c•••@example.com" });
    if (method === "GET" && path.endsWith("/entrega")) return json({ codigoGeneracion: CODE, canales: { correo: { estado: "enviado", destino: "c•••@example.com" } } });
    return json({ error: { code: "not_found", message: "unused" } }, 404);
  }) as typeof fetch;
}

async function recipeWorld() {
  const now = T0;
  const env = turnstileEnv({
    QUOTA: fakeQuotaNamespace(() => now),
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({
      customers: [{ id: "c1", label: "Comercial", receptor: { nombre: "Comercial", nrc: "123456", numDocumento: "06141234567890", nombreComercial: "x" } }],
      products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }],
    }),
  });
  const calls: string[] = [];
  const deps = { now: () => now, fetch: fakeApi(calls), turnstileFetch: fakeSiteverify(), facta: fakeFacta({ issued: 0, delivered: [] }) };
  const state = await handleApi(new Request(`${URL_BASE}/api/state`, { headers: { "cf-connecting-ip": "203.0.113.9" } }), env, deps);
  const cookie = /facta_pg_visitor=([^;]+)/.exec(state.headers.get("set-cookie") ?? "")![1]!;
  const run = (body: unknown, extra: Record<string, string> = {}) => handleApi(new Request(`${URL_BASE}/api/recipes/run`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-facta-ui": "1", cookie: `facta_pg_visitor=${cookie}`, "cf-connecting-ip": "203.0.113.9", "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX", ...extra },
  }), env, deps);
  const post = (path: string, body: unknown) => handleApi(new Request(`${URL_BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-facta-ui": "1", cookie: `facta_pg_visitor=${cookie}`, "cf-connecting-ip": "203.0.113.9", "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX" },
  }), env, deps);
  return { run, calls, post };
}

describe("recipe «Entregar por correo»", () => {
  it("needs a Turnstile token before it issues or sends anything", async () => {
    const { run, calls } = await recipeWorld();
    const response = await run({ recipe: "deliver-email", params: { email: "cliente@example.com" } }, { "x-turnstile-token": "" });
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("issues with the e-mail marked, asks deliverEmail with the token and waits, without leaking the token", async () => {
    const { run, calls } = await recipeWorld();
    const response = await run({ recipe: "deliver-email", params: { email: "cliente@example.com" } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("fdt_recipe_secret_token");
    expect(text).not.toContain("cliente@example.com");
    const body = JSON.parse(text) as { ok: boolean; issued: unknown[]; steps: Array<{ method: string; endpoint: string }> };
    expect(body.ok).toBe(true);
    expect(body.issued).toEqual([{ codigoGeneracion: CODE, tipoDte: "01" }]);
    expect(calls.slice(0, 3)).toEqual(["POST /v1/dte", `POST /v1/dte/${CODE}/entrega/correo`, `GET /v1/dte/${CODE}/entrega`]);
  });

  it("validates the address and limits the sends to 5 per hour", async () => {
    const { run } = await recipeWorld();
    const bad = await run({ recipe: "deliver-email", params: { email: "a@x.com,b@y.com" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("email_invalid");
    for (let i = 0; i < 5; i++) expect((await run({ recipe: "deliver-email", runId: `run-${i}-aaaaaaaa`, params: { email: `dest${i}@example.com` } })).status).toBe(200);
    const sixth = await run({ recipe: "deliver-email", runId: "run-9-aaaaaaaa", params: { email: "dest9@example.com" } });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).not.toBeNull();
    expect(((await sixth.json()) as { error: { message: string } }).error.message).toMatch(/Se alcanzó el límite de envíos/);
  });

  it("delivers a document the visitor owns with the kept token, and refuses one that is not theirs", async () => {
    const { run, calls, post } = await recipeWorld();
    // Issued through a session with the e-mail marked: the Worker keeps its five-minute token.
    const session = ((await (await post("/api/session", { ...SALE, sendEmail: true, emailTo: "cliente@example.com" })).json()) as { session: string }).session;
    expect((await post("/api/facta", issueBody(session))).status).toBe(200);
    const other = await run({ recipe: "deliver-email", params: { code: "AAAAAAAA-9B3D-4A6E-8F10-2D5B7C9E1A34" } });
    expect(other.status).toBe(403);
    const before = calls.length;
    const owned = await run({ recipe: "deliver-email", runId: "owned-run-aaaa", params: { code: CODE } });
    expect(owned.status).toBe(200);
    expect(calls.slice(before)).toContain(`POST /v1/dte/${CODE}/entrega/correo`);
    expect(await owned.text()).not.toContain("fdt_recipe_secret_token");
    // One send per document every 10 minutes also applies to this path.
    const again = await run({ recipe: "deliver-email", runId: "owned-run-bbbb", params: { code: CODE } });
    expect(again.status).toBe(429);
  });

  it("answers 410 for an owned document whose e-mail was never marked", async () => {
    const { run, post } = await recipeWorld();
    const session = ((await (await post("/api/session", SALE)).json()) as { session: string }).session;
    expect((await post("/api/facta", issueBody(session))).status).toBe(200);
    const closed = await run({ recipe: "deliver-email", params: { code: CODE } });
    expect(closed.status).toBe(410);
  });
});

describe("the six types in the recipe forms", () => {
  it("accepts every type; notes need a document issued here", async () => {
    const { run } = await recipeWorld();
    const note = await run({ recipe: "issue-idempotent", params: { type: "05" } });
    expect(note.status).toBe(400);
    expect(((await note.json()) as { error: { message: string } }).error.message).toMatch(/documento que corrige|nota/i);
    expect((await run({ recipe: "issue-idempotent", params: { type: "99" } })).status).toBe(400);
    expect((await run({ recipe: "issue-idempotent", params: { type: "03" } })).status).toBe(200);
  });
});
