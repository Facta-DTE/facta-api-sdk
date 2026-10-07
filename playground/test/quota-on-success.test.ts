import { describe, expect, it } from "vitest";
import { FactaError } from "../../src/errors.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";

type Mode = "sealed" | "contingency" | "rejected" | "rate_limited" | "unreachable";

async function world() {
  const keys = await makeKeys();
  const env = goodEnv({ QUOTA: fakeQuotaNamespace(() => NOW) });
  const state = { mode: "sealed" as Mode, calls: 0 };
  const facta = {
    environment: "00",
    issue: async (request: { tipoDte: string }) => {
      state.calls += 1;
      if (state.mode === "rejected") {
        throw new FactaError("mh_rejected", "Hacienda rechazó el documento", 422, { codigoGeneracion: "AAAAAAAA-0000-4000-8000-000000000001", numeroControl: "DTE-11-M001P001-000000000000001", observaciones: ["[incoterms] debe ser un código de CAT-031"] });
      }
      if (state.mode === "rate_limited") throw new FactaError("rate_limited", "Demasiadas solicitudes", 429);
      if (state.mode === "unreachable") throw new FactaError("mh_unreachable", "Sin conexión", 503);
      const contingency = state.mode === "contingency";
      return {
        estado: contingency ? "contingencia" : "sellado",
        codigoGeneracion: `AAAAAAAA-0000-4000-8000-${String(state.calls).padStart(12, "0")}`,
        numeroControl: `DTE-${request.tipoDte}-M001P001-${String(state.calls).padStart(15, "0")}`,
        tipoDte: request.tipoDte, ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: [], totales: { montoTotalOperacion: 1 },
        ...(contingency ? { detalle: "MH no disponible", documento: {}, jws: "x" } : {}),
      };
    },
    getDocumentStatus: async () => { throw new Error("unused"); },
  } as unknown as FactaLike;
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const post = (path: string, body: unknown, as?: string) =>
    call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, ...(as ? { as } : {}) });
  const session = async (sale: unknown = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] }) =>
    ((await (await post("/api/session", sale, "ana@example.com")).json()) as { session: string }).session;
  const left = async () => (await (await call("/api/state", { as: "ana@example.com" })).json() as { quota: { remainingHour: number; remainingDay: number } }).quota;
  return { state, post, session, left };
}

describe("the issue quota counts successes, exactly once", () => {
  it("a rejection (a rejected Exportación) costs nothing", async () => {
    const w = await world();
    w.state.mode = "rejected";
    const response = await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(w.state.calls).toBe(1);
    expect(await w.left()).toMatchObject({ remainingHour: 20, remainingDay: 100 });
  });

  it("an API 429 (rate limit) and an unreachable Hacienda cost nothing", async () => {
    const w = await world();
    for (const mode of ["rate_limited", "unreachable"] as const) {
      w.state.mode = mode;
      const response = await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(await w.left()).toMatchObject({ remainingHour: 20, remainingDay: 100 });
  });

  it("a failure and its retry with a new session count one in total", async () => {
    const w = await world();
    w.state.mode = "rejected";
    await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
    w.state.mode = "sealed";
    expect((await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com")).status).toBe(200);
    expect(await w.left()).toMatchObject({ remainingHour: 19, remainingDay: 99 });
  });

  it("a sealed issue counts one, and so does a contingency; a replay is free", async () => {
    const w = await world();
    const sealed = await w.session();
    await w.post("/api/facta", { action: "issue", session: sealed }, "ana@example.com");
    expect(await w.left()).toMatchObject({ remainingHour: 19, remainingDay: 99 });
    await w.post("/api/facta", { action: "issue", session: sealed }, "ana@example.com");
    await w.post("/api/facta", { action: "issue", session: sealed }, "ana@example.com");
    expect(await w.left()).toMatchObject({ remainingHour: 19, remainingDay: 99 });
    w.state.mode = "contingency";
    expect((await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com")).status).toBe(200);
    expect(await w.left()).toMatchObject({ remainingHour: 18, remainingDay: 98 });
  });

  it("still refuses before the call when the hour is spent, without reaching the API", async () => {
    const w = await world();
    for (let i = 0; i < 20; i++) await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
    const calls = w.state.calls;
    const response = await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
    expect(response.status).toBe(429);
    expect(w.state.calls).toBe(calls);
  });

  it("failures never fill the quota, however many there are", async () => {
    const w = await world();
    w.state.mode = "rejected";
    for (let i = 0; i < 25; i++) await w.post("/api/facta", { action: "issue", session: await w.session() }, "ana@example.com");
    expect(await w.left()).toMatchObject({ remainingHour: 20 });
  });
});
