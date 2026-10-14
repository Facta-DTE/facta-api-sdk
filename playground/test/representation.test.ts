import { describe, expect, it } from "vitest";
import { FactaError } from "../../src/errors.ts";
import { verifyFactaSession } from "../../src/server/session.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import type { RepresentationTemplate, RepresentationTemplates } from "../../src/types.ts";
import { handleApi } from "../server/router.ts";
import { parseFixtures } from "../server/fixtures.ts";
import { buildSale, SaleError } from "../server/sale.ts";
import {
  buildRepresentation, checkRepresentation, EMPTY_REPRESENTATION, keysForChoice, PLAN_REASON, templateDisabledReason, TYPE_REASON,
} from "../shared/representation.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";

const free: RepresentationTemplate = { id: "carta-a", tipo: "carta", nombre: "Clásica", origen: "catalogo", permitida: true, clavesDatos: [] };
const paid: RepresentationTemplate = { id: "carta-menu", tipo: "carta", nombre: "Menú", origen: "catalogo", permitida: false, motivo: "plan", clavesDatos: ["mesa", "mesero", "comensales"] };
const onlyCcf: RepresentationTemplate = { id: "carta-ccf", tipo: "carta", nombre: "Fiscal", origen: "propia", permitida: true, tiposDte: ["03"], clavesDatos: ["proyecto"] };
const ticket: RepresentationTemplate = { id: "ticket-3", tipo: "ticket", nombre: "Ticket 3", origen: "catalogo", permitida: true, clavesDatos: ["mesa", "propinaSugerida"] };
const LIST: RepresentationTemplates = { predeterminada: { carta: "carta-a", ticket: "ticket-3" }, plantillas: [free, paid, onlyCcf, ticket] };

describe("template options", () => {
  it("disables a paid template with the plan reason and an incompatible one with the type reason", () => {
    expect(templateDisabledReason(free, "01")).toBeNull();
    expect(templateDisabledReason(paid, "01")).toBe(PLAN_REASON);
    expect(PLAN_REASON).toBe("Requiere plan Lite o Pro");
    expect(templateDisabledReason(onlyCcf, "01")).toBe(TYPE_REASON);
    expect(TYPE_REASON).toBe("No es compatible con este tipo de documento");
    expect(templateDisabledReason(onlyCcf, "03")).toBeNull();
  });

  it("shows the keys of both chosen templates once, in catalogue order, and nothing for the company default", () => {
    expect(keysForChoice(LIST.plantillas, [null, null])).toEqual([]);
    expect(keysForChoice(LIST.plantillas, ["carta-menu", "ticket-3"])).toEqual(["mesa", "mesero", "comensales", "propinaSugerida"]);
    expect(keysForChoice(LIST.plantillas, ["unknown", null])).toEqual([]);
  });
});

describe("the representation the page sends", () => {
  it("sends the choice and only the values of the keys on screen, as numbers when whole", () => {
    const form = { ...EMPTY_REPRESENTATION, carta: "carta-menu", ticket: null, values: { mesa: " 7 ", comensales: "4", mesero: "", proyecto: "stale" }, filas: [{ etiqueta: "Turno", valor: "Noche" }, { etiqueta: "", valor: "x" }] };
    expect(buildRepresentation(form, ["mesa", "mesero", "comensales"])).toEqual({
      plantilla: { carta: "carta-menu" },
      datos: { mesa: "7", comensales: 4, filas: [{ etiqueta: "Turno", valor: "Noche" }] },
    });
  });

  it("sends nothing when nothing was chosen or typed", () => {
    expect(buildRepresentation(EMPTY_REPRESENTATION, ["mesa"])).toBeUndefined();
  });
});

describe("the Worker keeps the shape sane and lets the API judge the values", () => {
  it("accepts a template choice, known keys and free rows", () => {
    expect(checkRepresentation({ plantilla: { carta: "custom:0b8f5c3e-0000-4000-8000-000000000001", ticket: "ticket-3" }, datos: { mesa: "7", comensales: 3, filas: [{ etiqueta: "A", valor: "B" }] } }).ok).toBe(true);
    expect(checkRepresentation(undefined)).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ["an unknown top-level key", { otra: 1 }],
    ["a template slot that is neither carta nor ticket", { plantilla: { a4: "x" } }],
    ["a template id with spaces", { plantilla: { carta: "carta a" } }],
    ["a key outside the whitelist", { datos: { total: "1" } }],
    ["a line break in a value", { datos: { mesa: "7\n8" } }],
    ["a value longer than its limit", { datos: { mesa: "12345678901" } }],
    ["more than ten free rows", { datos: { filas: Array.from({ length: 11 }, () => ({ etiqueta: "a", valor: "b" })) } }],
    ["a free row without a value", { datos: { filas: [{ etiqueta: "a" }] } }],
  ])("refuses %s", (_name, raw) => {
    expect(checkRepresentation(raw).ok).toBe(false);
  });

  const fixtures = parseFixtures(JSON.stringify({ products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }] }));
  const line = { source: "custom", descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 };

  it("puts the representation on the built request untouched", () => {
    const representacion = { plantilla: { carta: "carta-menu" }, datos: { mesa: "7" } };
    const { sale } = buildSale({ tipoDte: "01", lines: [line], representacion }, fixtures);
    expect((sale.request as { representacion?: unknown }).representacion).toEqual(representacion);
  });

  it("adds no representacion field when none was chosen", () => {
    const { sale } = buildSale({ tipoDte: "01", lines: [line] }, fixtures);
    expect("representacion" in sale.request).toBe(false);
  });

  it("refuses a malformed representation with a field the page can point at", () => {
    try {
      buildSale({ tipoDte: "01", lines: [line], representacion: { datos: { total: "1" } } }, fixtures);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SaleError);
      expect((error as SaleError).code).toBe("representacion_invalid");
      expect((error as SaleError).field).toBe("representacion");
    }
  });
});

async function world(listTemplates?: () => Promise<unknown>) {
  const keys = await makeKeys();
  const env = goodEnv({
    QUOTA: fakeQuotaNamespace(() => NOW),
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({ products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }] }),
  });
  const calls: unknown[] = [];
  const facta = {
    environment: "00",
    issue: (async () => { throw new Error("unused"); }) as unknown as FactaLike["issue"],
    getDocumentStatus: (async () => { throw new Error("unused"); }) as unknown as FactaLike["getDocumentStatus"],
    ...(listTemplates === undefined ? {} : { listTemplates: async (options: unknown) => { calls.push(options); return listTemplates(); } }),
  } as FactaLike;
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  return { env, call, calls };
}

describe("GET /api/plantillas", () => {
  it("needs a visitor and a supported type", async () => {
    const { call } = await world(async () => LIST);
    expect((await call("/api/plantillas?tipoDte=01")).status).toBe(401);
    expect((await call("/api/plantillas?tipoDte=99", { as: "ana@example.com" })).status).toBe(400);
  });

  it("answers the API's list for the type and reads it once for everybody (cached)", async () => {
    const { call, calls } = await world(async () => LIST);
    const first = await call("/api/plantillas?tipoDte=03", { as: "ana@example.com" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ available: true, ...LIST });
    await call("/api/plantillas?tipoDte=03", { as: "luis@example.com" });
    expect(calls).toEqual([{ tipoDte: "03" }]);
  });

  it("says available:false, not an error, when the API has no such endpoint yet (404)", async () => {
    const { call, calls } = await world(async () => { throw new FactaError("not_found", "no route", 404); });
    const response = await call("/api/plantillas?tipoDte=01", { as: "ana@example.com" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false });
    // The miss is remembered, so the page does not spend a read on every visit.
    await call("/api/plantillas?tipoDte=01", { as: "luis@example.com" });
    expect(calls).toHaveLength(1);
  });

  it("answers the rate limit as a retryable 429", async () => {
    const { call } = await world(async () => { throw new FactaError("rate_limited", "slow down", 429); });
    const response = await call("/api/plantillas?tipoDte=01", { as: "ana@example.com" });
    expect(response.status).toBe(429);
  });

  it("answers available:false when the client has no listTemplates at all", async () => {
    const { call } = await world();
    expect(await (await call("/api/plantillas?tipoDte=01", { as: "ana@example.com" })).json()).toEqual({ available: false });
  });
});

describe("POST /api/session carries the representation inside the sealed request", () => {
  it("seals representacion with the sale", async () => {
    const { call, env } = await world(async () => LIST);
    const body = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }], representacion: { plantilla: { carta: "carta-menu" }, datos: { mesa: "7", filas: [{ etiqueta: "Turno", valor: "Noche" }] } } };
    const response = await call("/api/session", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, as: "ana@example.com" });
    expect(response.status).toBe(200);
    const { session } = await response.json() as { session: string };
    const opened = await verifyFactaSession(session, env.FACTA_SESSION_SECRET!, NOW);
    expect((opened.request as { representacion?: unknown }).representacion).toEqual(body.representacion);
  });

  it("refuses a malformed representation with 400 and the field", async () => {
    const { call } = await world(async () => LIST);
    const body = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }], representacion: { datos: { total: "9" } } };
    const response = await call("/api/session", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, as: "ana@example.com" });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string; field?: string } }).error).toMatchObject({ code: "representacion_invalid", field: "representacion" });
  });
});
