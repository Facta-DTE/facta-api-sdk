import { describe, expect, it } from "vitest";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { saleKey } from "../server/order-key.ts";
import { TIMINGS_HEADER } from "../shared/timings.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";
const SALE = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] };

/** A fake API that behaves like the real one on the point under test: the same idempotency key answers the SAME document. */
async function world(options: { debug?: boolean } = {}) {
  const keys = await makeKeys();
  const env = goodEnv({ QUOTA: fakeQuotaNamespace(() => NOW) });
  const issuedByKey = new Map<string, Record<string, unknown>>();
  const state = { apiCalls: 0, keys: [] as string[] };
  const facta = {
    environment: "00",
    issue: async (request: { tipoDte: string }, callOptions: { idempotencyKey: string }) => {
      state.apiCalls += 1;
      state.keys.push(callOptions.idempotencyKey);
      const known = issuedByKey.get(callOptions.idempotencyKey);
      if (known !== undefined) return known;
      const n = issuedByKey.size + 1;
      const result = {
        estado: "sellado",
        codigoGeneracion: `AAAAAAAA-0000-4000-8000-${String(n).padStart(12, "0")}`,
        numeroControl: `DTE-${request.tipoDte}-M001P001-${String(n).padStart(15, "0")}`,
        tipoDte: request.tipoDte, ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: [], totales: { totalPagar: 1 },
        ...(options.debug ? { debug: { timings: [{ step: "mh", ms: 410, startedAtMs: 20 }, { step: "firma", ms: 12, startedAtMs: 5 }], totalMs: 500, source: "body" } } : {}),
      };
      issuedByKey.set(callOptions.idempotencyKey, result);
      return result;
    },
    getDocumentStatus: async () => { throw new Error("unused"); },
  } as unknown as FactaLike;
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
    call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1", ...extra }, as: "ana@example.com" });
  const session = async (sale: Record<string, unknown> = SALE, extra: Record<string, string> = {}) =>
    (await (await post("/api/session", sale, extra)).json()) as { session: string; orderNumber: string | null; idempotencyKey: string; timings?: unknown };
  const issue = async (token: string, extra: Record<string, string> = {}) =>
    (await post("/api/facta", { action: "issue", session: token }, extra)).json() as Promise<{ result: { codigoGeneracion: string }; playground: { replay: boolean; timings?: { steps: Array<{ step: string; source: string; ms: number }>; totalMs: number; apiBreakdown: boolean } }; debug?: unknown }>;
  const left = async () => (await (await call("/api/state", { as: "ana@example.com" })).json() as { quota: { remainingHour: number } }).quota.remainingHour;
  return { state, session, issue, left, post };
}

describe("the order number is the idempotency key", () => {
  it("without an order number every session gets a new key: that is why every click made a new invoice", async () => {
    const w = await world();
    const a = await w.session();
    const b = await w.session();
    expect(a.orderNumber).toBeNull();
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect((await w.issue(a.session)).result.codigoGeneracion).not.toBe((await w.issue(b.session)).result.codigoGeneracion);
  });

  it("the same order number prepared and issued twice is ONE document, and the second is flagged as a replay", async () => {
    const w = await world();
    const first = await w.session({ ...SALE, orderNumber: "PED-1042" });
    const second = await w.session({ ...SALE, orderNumber: "PED-1042" });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toMatch(/^[0-9a-f]{16}\.sale-PED-1042$/);
    expect(first.orderNumber).toBe("PED-1042");
    const one = await w.issue(first.session);
    const two = await w.issue(second.session);
    expect(two.result.codigoGeneracion).toBe(one.result.codigoGeneracion);
    expect(one.playground.replay).toBe(false);
    expect(two.playground.replay).toBe(true);
    // Both calls carried the same key to the SDK client.
    expect(w.state.keys).toEqual([first.idempotencyKey, first.idempotencyKey]);
  });

  it("a replay does not spend the visitor's quota", async () => {
    const w = await world();
    const first = await w.session({ ...SALE, orderNumber: "PED-7" });
    await w.issue(first.session);
    expect(await w.left()).toBe(19);
    for (let i = 0; i < 3; i++) await w.issue((await w.session({ ...SALE, orderNumber: "PED-7" })).session);
    expect(await w.left()).toBe(19);
    await w.issue((await w.session({ ...SALE, orderNumber: "PED-8" })).session);
    expect(await w.left()).toBe(18);
  });

  it("a different order number is a different document", async () => {
    const w = await world();
    const a = await w.issue((await w.session({ ...SALE, orderNumber: "PED-1" })).session);
    const b = await w.issue((await w.session({ ...SALE, orderNumber: "PED-2" })).session);
    expect(a.result.codigoGeneracion).not.toBe(b.result.codigoGeneracion);
    expect(b.playground.replay).toBe(false);
  });

  it("two visitors who type the same number never collide: the key carries the visitor tag", () => {
    expect(saleKey("aaaaaaaaaaaaaaaa", "PED-1042").idempotencyKey).not.toBe(saleKey("bbbbbbbbbbbbbbbb", "PED-1042").idempotencyKey);
  });

  it("refuses an order number with characters it cannot carry", async () => {
    const w = await world();
    for (const bad of ["PED 1042", "../x", "a".repeat(41), "ñandú", 12]) {
      const response = await w.post("/api/session", { ...SALE, orderNumber: bad });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string; field?: string } }).error).toMatchObject({ code: "order_number_invalid", field: "orderNumber" });
    }
  });
});

describe("timings are a flag, off by default", () => {
  it("adds nothing without the flag", async () => {
    const w = await world({ debug: true });
    const created = await w.session({ ...SALE, orderNumber: "PED-3" });
    expect(created.timings).toBeUndefined();
    const answer = await w.issue(created.session);
    expect(answer.playground.timings).toBeUndefined();
    // The API's debug member never reaches the browser as such.
    expect(answer.debug).toBeUndefined();
  });

  it("with the flag: the playground's own steps in the session and in the issue", async () => {
    const w = await world();
    const created = await w.session({ ...SALE, orderNumber: "PED-4" }, { [TIMINGS_HEADER]: "1" }) as Awaited<ReturnType<typeof w.session>> & { timings: { steps: Array<{ step: string }>; apiBreakdown: boolean } };
    expect(created.timings.steps.map((s) => s.step)).toEqual(expect.arrayContaining(["Verificación de Turnstile", "Armado de la venta", "Firma de la sesión"]));
    const answer = await w.issue(created.session, { [TIMINGS_HEADER]: "1" });
    const steps = answer.playground.timings!.steps.map((s) => s.step);
    expect(steps).toEqual(expect.arrayContaining(["Límite de emisiones (solo comprobar)", "Handler del SDK (todo lo siguiente)", "API · emitir (facta.issue)"]));
    // The API returned nothing: only the playground's steps, and the page says so.
    expect(answer.playground.timings!.apiBreakdown).toBe(false);
    expect(answer.playground.timings!.steps.every((s) => s.source === "playground")).toBe(true);
  });

  it("with the flag and an API that returns its breakdown: those steps are added under the API call", async () => {
    const w = await world({ debug: true });
    const created = await w.session({ ...SALE, orderNumber: "PED-5" });
    const answer = await w.issue(created.session, { [TIMINGS_HEADER]: "1" });
    const timings = answer.playground.timings!;
    expect(timings.apiBreakdown).toBe(true);
    expect(timings.steps.filter((s) => s.source === "api").map((s) => [s.step, s.ms])).toEqual(expect.arrayContaining([["API · mh", 410], ["API · firma", 12]]));
    expect(answer.debug).toBeUndefined();
  });
});
