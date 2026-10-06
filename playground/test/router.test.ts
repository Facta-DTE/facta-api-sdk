import { describe, expect, it } from "vitest";
import { verifyFactaSession } from "../../src/server/session.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";

function fakeFacta(issued: unknown[] = []): FactaLike {
  return {
    environment: "00",
    issue: (async (request: unknown, options: unknown) => {
      issued.push({ request, options });
      return {
        estado: "sellado",
        codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34",
        numeroControl: "DTE-01-M001P001-000000000000001",
        tipoDte: "01",
        ambiente: "00",
        fecEmi: "2026-10-06",
        horEmi: "10:00:00",
        selloRecibido: "SELLO",
        totales: { totalPagar: 1 },
        observaciones: [],
      };
    }) as unknown as FactaLike["issue"],
    getDocumentStatus: (async () => { throw new Error("unused"); }) as unknown as FactaLike["getDocumentStatus"],
  };
}

async function world() {
  const keys = await makeKeys();
  const quota = fakeQuotaNamespace(() => NOW);
  const env = goodEnv({
    QUOTA: quota,
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({ products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }] }),
  });
  const issued: unknown[] = [];
  const facta = fakeFacta(issued);
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const token = (email: string) => keys.sign(accessClaims(seconds, { email }));
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await token(init.as));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const post = (path: string, body: unknown, as?: string) =>
    call(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-facta-ui": "1" },
      ...(as ? { as } : {}),
    });
  return { env, issued, call, post };
}

const SALE = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] };

describe("playground API", () => {
  it("answers 503 with a Spanish message on every route when the guard fails", async () => {
    const { env } = await world();
    for (const path of ["/api/state", "/api/session", "/api/facta", "/api/anything"]) {
      const bad = { ...env, FACTA_API_KEY: "facta_live_abcdef.secret-value-here" };
      const response = await handleApi(new Request(`${URL_BASE}${path}`), bad);
      expect(response.status).toBe(503);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("playground_key_not_test");
      expect(body.error.message).toMatch(/solo funciona en el ambiente de pruebas/);
      expect(JSON.stringify(body)).not.toContain("secret-value-here");
    }
  });

  it("refuses when the quota binding is missing", async () => {
    const { env } = await world();
    const { QUOTA: _quota, ...withoutQuota } = env;
    const response = await handleApi(new Request(`${URL_BASE}/api/state`), withoutQuota);
    expect(response.status).toBe(503);
  });

  it("reports no visitor without a token and the quota with one", async () => {
    const { call } = await world();
    const anonymous = await (await call("/api/state")).json() as { visitor: unknown; quota: unknown; demo: { products: unknown[] } };
    expect(anonymous.visitor).toBeNull();
    expect(anonymous.quota).toBeNull();
    const known = await (await call("/api/state", { as: "Ana@Example.com" })).json() as { visitor: { email: string }; quota: { remainingHour: number }; demo: { products: unknown[] } };
    expect(known.visitor.email).toBe("ana@example.com");
    expect(known.quota.remainingHour).toBe(20);
    expect(known.demo.products).toHaveLength(1);
  });

  it("creates a session only for a signed-in visitor, from a validated sale", async () => {
    const { post, env } = await world();
    expect((await post("/api/session", SALE)).status).toBe(401);
    const response = await post("/api/session", SALE, "ana@example.com");
    expect(response.status).toBe(200);
    const body = await response.json() as { session: string; total: number; emailTo: string | null };
    expect(body).toMatchObject({ total: 1, emailTo: null });
    const session = await verifyFactaSession(body.session, env.FACTA_SESSION_SECRET!, NOW);
    expect(session.request).toMatchObject({ tipoDte: "01", items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] });
    expect(session.deliver).toBeUndefined();
  });

  it("delivers by e-mail only to the verified visitor and never by WhatsApp", async () => {
    const { post, env } = await world();
    // In Access mode a missing address falls back to the verified e-mail; a browser-supplied channel is refused.
    const refused = await post("/api/session", { ...SALE, sendEmail: true, deliver: { whatsapp: { number: "70000000", consent: true } } }, "ana@example.com");
    expect(refused.status).toBe(400);
    const response = await post("/api/session", { ...SALE, sendEmail: true }, "ana@example.com");
    const body = await response.json() as { session: string; emailTo: string };
    expect(body.emailTo).toBe("a•••@example.com");
    const session = await verifyFactaSession(body.session, env.FACTA_SESSION_SECRET!, NOW);
    expect(session.deliver).toEqual({ email: "ana@example.com" });
  });

  it("rejects an invalid sale with its own code", async () => {
    const { post } = await world();
    const response = await post("/api/session", { tipoDte: "99", lines: [] }, "ana@example.com");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("type_unsupported");
  });

  it("requires the browser headers on /api/session", async () => {
    const { call } = await world();
    const response = await call("/api/session", { method: "POST", body: JSON.stringify(SALE), headers: { "content-type": "application/json" }, as: "ana@example.com" });
    expect(response.status).toBe(400);
  });

  async function sessionFor(post: Awaited<ReturnType<typeof world>>["post"], email: string, sale: unknown = SALE) {
    return ((await (await post("/api/session", sale, email)).json()) as { session: string }).session;
  }

  it("issues through the SDK handler and spends one unit of quota", async () => {
    const { post, call, issued } = await world();
    const session = await sessionFor(post, "ana@example.com");
    const response = await post("/api/facta", { action: "issue", session }, "ana@example.com");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { result: { estado: string } }).result.estado).toBe("sellado");
    expect(issued).toHaveLength(1);
    const state = await (await call("/api/state", { as: "ana@example.com" })).json() as { quota: { remainingHour: number } };
    expect(state.quota.remainingHour).toBe(19);
    // A replay of the same session is free.
    await post("/api/facta", { action: "issue", session }, "ana@example.com");
    const again = await (await call("/api/state", { as: "ana@example.com" })).json() as { quota: { remainingHour: number } };
    expect(again.quota.remainingHour).toBe(19);
  });

  it("refuses the 21st issue of the hour with a friendly 429 and never reaches the API", async () => {
    const { post, issued } = await world();
    for (let i = 0; i < 20; i++) {
      const session = await sessionFor(post, "ana@example.com");
      expect((await post("/api/facta", { action: "issue", session }, "ana@example.com")).status).toBe(200);
    }
    const session = await sessionFor(post, "ana@example.com");
    const response = await post("/api/facta", { action: "issue", session }, "ana@example.com");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.message).toMatch(/Límite alcanzado/);
    expect(issued).toHaveLength(20);
    // Another visitor is unaffected.
    const other = await sessionFor(post, "beto@example.com");
    expect((await post("/api/facta", { action: "issue", session: other }, "beto@example.com")).status).toBe(200);
  });

  it("refuses to issue without sign-in and with another visitor's session", async () => {
    const { post, issued } = await world();
    const session = await sessionFor(post, "ana@example.com");
    expect((await post("/api/facta", { action: "issue", session })).status).toBe(403);
    expect((await post("/api/facta", { action: "issue", session }, "beto@example.com")).status).toBe(403);
    expect(issued).toHaveLength(0);
  });

  it("serves the service status without sign-in", async () => {
    const { post } = await world();
    // The fake client has no status/diagnose, so the handler answers its own «cannot serve» error;
    // what matters is that the request was not refused as unauthorized.
    const response = await post("/api/facta", { action: "service.status" });
    expect([401, 403]).not.toContain(response.status);
  });

  it("answers 404 for unknown API paths", async () => {
    const { call } = await world();
    expect((await call("/api/nope")).status).toBe(404);
  });
});
