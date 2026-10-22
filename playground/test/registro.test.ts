import { describe, expect, it } from "vitest";
import type { FactaLike } from "../../src/server/handler.ts";
import { handleApi } from "../server/router.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";
const FIXTURES = JSON.stringify({
  customers: [
    { id: "taxpayer", label: "Contribuyente", receptor: { nombre: "Empresa", nrc: "123456-7", numDocumento: "0614-010101-101-1" } },
    { id: "person", label: "Persona", receptor: { nombre: "Persona", numDocumento: "00000000-0" } },
  ],
});

function fakeFacta(estado: "sellado" | "contingencia" = "sellado") {
  let counter = 0;
  const downloads: string[] = [];
  const widths: Array<number | undefined> = [];
  const facta = {
    environment: "00",
    issue: async (request: { tipoDte: string }) => {
      counter += 1;
      const codigoGeneracion = `AAAAAAAA-0000-4000-8000-${String(counter).padStart(12, "0")}`;
      return {
        estado, codigoGeneracion, numeroControl: `DTE-${request.tipoDte}-M001P001-${String(counter).padStart(15, "0")}`, tipoDte: request.tipoDte,
        ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", totales: { totalPagar: 1 }, observaciones: [],
        ...(estado === "contingencia" ? { detalle: "MH no disponible", documento: {}, jws: "x" } : {}),
      };
    },
    getDocumentStatus: async (code: string) => ({
      estado: "sellado", codigoGeneracion: code, numeroControl: "N", tipoDte: "01", ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: [], totales: { totalPagar: 1 },
    }),
    downloadDocument: async (code: string, kind: string, options?: { paperWidthMm?: number }) => {
      downloads.push(`${code}.${kind}`);
      if (kind === "ticket") widths.push(options?.paperWidthMm);
      return { filename: `${code}.${kind}`, bytes: new Uint8Array([1, 2, 3]) };
    },
  } as unknown as FactaLike;
  return { facta, downloads, widths };
}

async function world(estado: "sellado" | "contingencia" = "sellado") {
  const keys = await makeKeys();
  const env = goodEnv({ QUOTA: fakeQuotaNamespace(() => NOW), FACTA_DTE_FIXTURES_JSON: FIXTURES });
  const { facta, downloads, widths } = fakeFacta(estado);
  const deps = { keys: async () => [keys.jwk], now: () => NOW, facta };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const post = (path: string, body: unknown, as?: string) =>
    call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, ...(as ? { as } : {}) });
  const issue = async (as: string, sale: unknown = { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 1, precioUni: 1, tipoItem: 2 }] }) => {
    const { session } = await (await post("/api/session", sale, as)).json() as { session: string };
    const response = await post("/api/facta", { action: "issue", session }, as);
    expect(response.status).toBe(200);
    return ((await response.json()) as { result: { codigoGeneracion: string } }).result.codigoGeneracion;
  };
  return { call, post, issue, downloads, widths };
}

describe("Registro", () => {
  it("requires a signed-in visitor and uses GET", async () => {
    const { call } = await world();
    expect((await call("/api/registro")).status).toBe(401);
    expect((await call("/api/registro", { method: "POST", as: "ana@example.com" })).status).toBe(405);
  });

  it("starts empty", async () => {
    const { call } = await world();
    const body = await (await call("/api/registro", { as: "ana@example.com" })).json() as { documents: unknown[] };
    expect(body.documents).toEqual([]);
  });

  it("lists only the visitor's own documents, newest first, with their current state", async () => {
    const { call, issue } = await world();
    const first = await issue("ana@example.com");
    const second = await issue("ana@example.com");
    const others = await issue("beto@example.com");
    const ana = await (await call("/api/registro", { as: "ana@example.com" })).json() as { documents: { codigoGeneracion: string; current: { estado: string } | null }[] };
    expect(ana.documents.map((d) => d.codigoGeneracion)).toEqual([second, first]);
    expect(ana.documents[0]!.current).toMatchObject({ estado: "sellado" });
    const beto = await (await call("/api/registro", { as: "beto@example.com" })).json() as { documents: { codigoGeneracion: string }[] };
    expect(beto.documents.map((d) => d.codigoGeneracion)).toEqual([others]);
  });

  it("records contingency documents too", async () => {
    const { call, issue } = await world("contingencia");
    const code = await issue("ana@example.com");
    const body = await (await call("/api/registro", { as: "ana@example.com" })).json() as { documents: { codigoGeneracion: string }[] };
    expect(body.documents[0]!.codigoGeneracion).toBe(code);
  });

  it("serves per-document reads only for documents the visitor issued", async () => {
    const { post, issue, downloads } = await world();
    const mine = await issue("ana@example.com");
    const theirs = await issue("beto@example.com");
    const ok = await post("/api/facta", { action: "documents.download", codigoGeneracion: mine, kind: "pdf" }, "ana@example.com");
    expect(ok.status).toBe(200);
    expect(downloads).toEqual([`${mine}.pdf`]);
    for (const action of ["documents.download", "documents.get", "documents.copies", "documents.retryStorage"]) {
      const response = await post("/api/facta", { action, codigoGeneracion: theirs, kind: "pdf" }, "ana@example.com");
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("document_not_yours");
    }
    expect((await post("/api/facta", { action: "documents.get", codigoGeneracion: mine }, "ana@example.com")).status).toBe(200);
    expect((await post("/api/facta", { action: "documents.get", codigoGeneracion: mine })).status).toBe(401);
    expect((await post("/api/facta", { action: "documents.get", codigoGeneracion: "nope" }, "ana@example.com")).status).toBe(403);
    expect(downloads).toHaveLength(1);
  });
});

describe("ticket downloads", () => {
  it("serves the ticket only for the visitor's own document, and only at a width the API accepts (40 to 120)", async () => {
    const { post, issue, widths } = await world();
    const mine = await issue("ana@example.com");
    const theirs = await issue("beto@example.com");
    const ask = (code: string, extra: Record<string, unknown>, as = "ana@example.com") => post("/api/facta", { action: "documents.download", codigoGeneracion: code, kind: "ticket", ...extra }, as);
    expect((await ask(mine, { paperWidthMm: 58 })).status).toBe(200);
    expect((await ask(mine, {})).status).toBe(200);
    expect(widths).toEqual([58, undefined]);
    for (const bad of [39, 121, 80.5, "80"]) expect((await ask(mine, { paperWidthMm: bad })).status).toBe(400);
    // The width belongs to tickets only.
    expect((await post("/api/facta", { action: "documents.download", codigoGeneracion: mine, kind: "pdf", paperWidthMm: 80 }, "ana@example.com")).status).toBe(400);
    // Another visitor's document, or no session at all.
    const foreign = await ask(theirs, { paperWidthMm: 80 });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe("document_not_yours");
    expect(widths).toEqual([58, undefined]);
  });
});

describe("credit-fiscal session (headless example)", () => {
  it("builds a CCF for a taxpayer and refuses a customer without NRC", async () => {
    const { post } = await world();
    const lines = [{ descripcion: "Servicio", cantidad: 1, precioUni: 25, tipoItem: 2 }];
    const ok = await post("/api/session", { tipoDte: "03", customerId: "taxpayer", lines }, "ana@example.com");
    expect(ok.status).toBe(200);
    const noNrc = await post("/api/session", { tipoDte: "03", customerId: "person", lines }, "ana@example.com");
    expect(((await noNrc.json()) as { error: { code: string } }).error.code).toBe("customer_not_contributor");
    const none = await post("/api/session", { tipoDte: "03", lines }, "ana@example.com");
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("customer_required");
  });

  it("tells the page which demo customers are taxpayers without exposing receptor fields", async () => {
    const { call } = await world();
    const state = await (await call("/api/state", { as: "ana@example.com" })).json() as { demo: { customers: Record<string, unknown>[] }; supportedTypes: string[] };
    expect(state.demo.customers).toMatchObject([{ id: "taxpayer", label: "Contribuyente", contributor: true }, { id: "person", label: "Persona", contributor: false }]);
    expect(state.supportedTypes).toContain("03");
  });
});
