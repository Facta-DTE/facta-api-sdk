import { describe, expect, it } from "vitest";
import { FactaError } from "../../src/errors.ts";
import type { FactaLike } from "../../src/server/handler.ts";
import { withApiBudget, RATE_LIMIT_MESSAGE } from "../server/api-budget.ts";
import { apiCacheOf, type ApiCache } from "../server/api-cache.ts";
import { handleApi } from "../server/router.ts";
import { recordIssued } from "../server/issued-codes.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const URL_BASE = "https://playground.factadte.com";
const MINUTE = 60_000;

/** Counts every call that would reach the API. */
interface Counters { status: number; diagnose: number; docs: number; list: number; customers: number; products: number; customerGet: number; invalidate: number }

function fakeFacta(clock: { t: number }, behaviour: { docState?: string | (() => string); docError?: () => Error | null; issueEstado?: "sellado" | "contingencia"; total?: number } = {}) {
  const counters: Counters = { status: 0, diagnose: 0, docs: 0, list: 0, customers: 0, products: 0, customerGet: 0, invalidate: 0 };
  let issued = 0;
  const facta = {
    environment: "00",
    issue: async (request: { tipoDte: string }) => {
      issued += 1;
      const estado = behaviour.issueEstado ?? "sellado";
      return {
        estado, codigoGeneracion: `AAAAAAAA-0000-4000-8000-${String(issued).padStart(12, "0")}`, numeroControl: `DTE-${request.tipoDte}-M001P001-${String(issued).padStart(15, "0")}`,
        tipoDte: request.tipoDte, ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: [],
        totales: { montoTotalOperacion: behaviour.total ?? 12.5, totalPagar: behaviour.total ?? 12.5 },
        ...(estado === "contingencia" ? { detalle: "MH no disponible", documento: {}, jws: "x" } : {}),
      };
    },
    getDocumentStatus: async (code: string) => {
      counters.docs += 1;
      const error = behaviour.docError?.() ?? null;
      if (error !== null) throw error;
      const estado = typeof behaviour.docState === "function" ? behaviour.docState() : behaviour.docState ?? "sellado";
      return { estado, codigoGeneracion: code, numeroControl: "N", tipoDte: "01", ambiente: "00", fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: ["obs"], totales: { montoTotalOperacion: 9.99 } };
    },
    status: async () => { counters.status += 1; return { ok: true, version: "x", ambiente: "00", emisor: null, llave: {} }; },
    diagnose: async () => { counters.diagnose += 1; return { overall: "ready", checks: [] }; },
    listDocuments: async () => { counters.list += 1; return { documentos: [] }; },
    searchCustomers: async (query: string) => { counters.customers += 1; return [{ id: `c-${query}`, name: `Cliente ${query}` }]; },
    searchProducts: async (query: string) => { counters.products += 1; return [{ id: `p-${query}`, description: `Producto ${query}`, unit_price: 1, vat_included: true, item_type: 1, active: true }]; },
    getCustomer: async (id: string) => { counters.customerGet += 1; return { id, name: "Ferretería San Miguel", doc_type: "36", doc_number: "06141234567890", nrc: "123456" }; },
    getProduct: async (id: string) => ({ id, description: "Neto", item_type: 1, unit_price: 2, vat_included: true, active: true }),
    invalidate: async () => { counters.invalidate += 1; return { estado: "invalidado" }; },
  } as unknown as FactaLike;
  return { facta, counters, clock };
}

async function world(behaviour: Parameters<typeof fakeFacta>[1] = {}) {
  const clock = { t: NOW };
  const keys = await makeKeys();
  const env = goodEnv({
    QUOTA: fakeQuotaNamespace(() => clock.t),
    FACTA_UNLOCK_KEY: "factauk_unit-test-unlock-0000",
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({ products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }] }),
  });
  const fake = fakeFacta(clock, behaviour);
  const deps = { keys: async () => [keys.jwk], now: () => clock.t, facta: fake.facta };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(Math.floor(clock.t / 1000), { email: init.as })));
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
  const registro = async (as: string) => (await (await call("/api/registro", { as })).json()) as { documents: Array<{ codigoGeneracion: string; estado: string; total?: number; current: Record<string, unknown> | null }> };
  const enrich = (as: string, codes: string[]) => call(`/api/registro/enrich?codes=${codes.join(",")}`, { as });
  return { env, call, post, issue, registro, enrich, ...fake };
}

describe("Registro makes no repeated API calls", () => {
  it("loading it twice reads nothing for documents the playground sealed itself", async () => {
    const w = await world();
    await w.issue("ana@example.com");
    await w.issue("ana@example.com");
    for (let i = 0; i < 2; i++) {
      const { documents } = await w.registro("ana@example.com");
      expect(documents).toHaveLength(2);
      expect(documents.every((d) => d.current?.estado === "sellado")).toBe(true);
      await w.enrich("ana@example.com", documents.map((d) => d.codigoGeneracion));
    }
    expect(w.counters.docs).toBe(0);
  });

  it("never refetches a final state: one read, then none, however long it has been", async () => {
    const w = await world({ issueEstado: "contingencia", docState: "sellado" });
    const code = await w.issue("ana@example.com");
    // The ledger says «contingencia»; the first enrichment asks the API once and learns «sellado».
    for (let i = 0; i < 3; i++) {
      const body = await (await w.enrich("ana@example.com", [code])).json() as { documents: Array<{ estado: string; total: number }> };
      expect(body.documents[0]).toMatchObject({ estado: "sellado" });
      w.clock.t += 30 * MINUTE;
    }
    expect(w.counters.docs).toBe(1);
    // The ledger followed.
    expect((await w.registro("ana@example.com")).documents[0]).toMatchObject({ estado: "sellado" });
  });

  it("asks about a pending document at most once per 60 seconds", async () => {
    const w = await world({ issueEstado: "contingencia", docState: "contingencia" });
    const code = await w.issue("ana@example.com");
    await w.enrich("ana@example.com", [code]);
    await w.enrich("ana@example.com", [code]);
    w.clock.t += 30_000;
    await w.enrich("ana@example.com", [code]);
    expect(w.counters.docs).toBe(1);
    w.clock.t += 31_000;
    await w.enrich("ana@example.com", [code]);
    expect(w.counters.docs).toBe(2);
  });

  it("enriches only the codes it is asked for, at most ten, and only the visitor's own", async () => {
    const w = await world({ issueEstado: "contingencia", docState: "contingencia" });
    const mine = await w.issue("ana@example.com");
    const theirs = await w.issue("beto@example.com");
    const body = await (await w.enrich("ana@example.com", [mine, theirs])).json() as { documents: Array<{ codigoGeneracion: string }> };
    expect(body.documents.map((d) => d.codigoGeneracion)).toEqual([mine]);
    expect(w.counters.docs).toBe(1);
    // Listing the registry alone never reads the API.
    await w.registro("ana@example.com");
    expect(w.counters.docs).toBe(1);
  });

  it("an invalidation evicts the cached «sellado», so the next read sees «invalidado»", async () => {
    let estado = "sellado";
    const calls = { n: 0 };
    const store = new Map<string, unknown>();
    const cache: ApiCache = {
      get: async (key) => (store.has(key) ? { value: store.get(key) as never, at: 0 } : null),
      getMany: async () => new Map(),
      put: async (key, value) => void store.set(key, value),
      del: async (key) => void store.delete(key),
    };
    const inner = {
      getDocumentStatus: async () => { calls.n += 1; return { estado }; },
      invalidate: async () => { estado = "invalidado"; return {}; },
    } as unknown as FactaLike;
    const budget = withApiBudget(inner, { cache });
    const code = "AAAAAAAA-0000-4000-8000-000000000001";
    expect((await budget.getDocumentStatus(code)).estado).toBe("sellado");
    expect((await budget.getDocumentStatus(code)).estado).toBe("sellado");
    expect(calls.n).toBe(1);
    await budget.invalidate!(code, {} as never);
    expect((await budget.getDocumentStatus(code)).estado).toBe("invalidado");
    expect(calls.n).toBe(2);
  });
});

describe("totals are stored at issue time and backfilled", () => {
  it("a sealed document keeps the total of the sealed result", async () => {
    const w = await world({ total: 12.5 });
    await w.issue("ana@example.com");
    expect((await w.registro("ana@example.com")).documents[0]).toMatchObject({ total: 12.5 });
  });

  it("a contingency keeps the total the visitor reviewed", async () => {
    const w = await world({ issueEstado: "contingencia", docState: "contingencia" });
    await w.issue("ana@example.com", { tipoDte: "01", lines: [{ descripcion: "Servicio", cantidad: 3, precioUni: 2, tipoItem: 2 }] });
    expect((await w.registro("ana@example.com")).documents[0]).toMatchObject({ total: 6 });
  });

  it("fills a missing total from documents.get once, and stores it", async () => {
    const w = await world();
    // An older ledger row without a total.
    await recordIssued(w.env, "ana@example.com", { codigoGeneracion: "AAAAAAAA-1111-4000-8000-000000000001", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000009", estado: "sellado" });
    expect((await w.registro("ana@example.com")).documents[0]!.total).toBeUndefined();
    const body = await (await w.enrich("ana@example.com", ["AAAAAAAA-1111-4000-8000-000000000001"])).json() as { documents: Array<{ total: number }> };
    expect(body.documents[0]!.total).toBe(9.99);
    expect((await w.registro("ana@example.com")).documents[0]!.total).toBe(9.99);
    await w.enrich("ana@example.com", ["AAAAAAAA-1111-4000-8000-000000000001"]);
    expect(w.counters.docs).toBe(1);
  });
});

describe("the API's own rate limit", () => {
  const limited = () => new FactaError("rate_limited", "Demasiadas solicitudes", 429);

  it("answers a friendly 429 and stops calling the API for a minute", async () => {
    const w = await world({ docError: limited });
    await recordIssued(w.env, "ana@example.com", { codigoGeneracion: "AAAAAAAA-1111-4000-8000-000000000001", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000009", estado: "contingencia" });
    const first = await w.enrich("ana@example.com", ["AAAAAAAA-1111-4000-8000-000000000001"]);
    expect(first.status).toBe(429);
    const body = await first.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "rate_limited", message: RATE_LIMIT_MESSAGE });
    expect(RATE_LIMIT_MESSAGE).toBe("El playground alcanzó el límite de pruebas por hora; intente en unos minutos.");
    const calls = w.counters.docs;
    await w.enrich("ana@example.com", ["AAAAAAAA-1111-4000-8000-000000000001"]);
    expect(w.counters.docs).toBe(calls);
    w.clock.t += 61_000;
    await w.enrich("ana@example.com", ["AAAAAAAA-1111-4000-8000-000000000001"]);
    expect(w.counters.docs).toBe(calls + 1);
  });
});

describe("catalog searches and the service status share one API read", () => {
  const search = (w: Awaited<ReturnType<typeof world>>, action: string, query: string) =>
    w.post("/api/facta", { action, query }, "ana@example.com");

  it("caches a catalog search per query for five minutes", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) expect((await search(w, "catalog.customers.search", "Ferre")).status).toBe(200);
    expect(w.counters.customers).toBe(1);
    await search(w, "catalog.customers.search", "Otro");
    expect(w.counters.customers).toBe(2);
    await search(w, "catalog.products.search", "Café");
    await search(w, "catalog.products.search", "café");
    expect(w.counters.products).toBe(1);
    w.clock.t += 5 * MINUTE + 1000;
    await search(w, "catalog.customers.search", "Ferre");
    expect(w.counters.customers).toBe(3);
  });

  it("answers the service status from /v1/status alone, once per minute, for every visitor", async () => {
    const w = await world();
    for (const visitor of ["ana@example.com", "beto@example.com", undefined, "ana@example.com"]) {
      const response = await w.post("/api/facta", { action: "service.status" }, visitor);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { state: string }).state).toBe("online");
    }
    expect(w.counters.status).toBe(1);
    expect(w.counters.diagnose).toBe(0);
    expect(w.counters.list).toBe(0);
    w.clock.t += 61_000;
    await w.post("/api/facta", { action: "service.status" });
    expect(w.counters.status).toBe(2);
  });

  it("does not need Turnstile or a visitor to read the status", async () => {
    const w = await world();
    expect((await w.post("/api/facta", { action: "service.status" })).status).toBe(200);
  });
});

describe("the shared cache", () => {
  it("is in the Durable Object: two Worker views of it agree", async () => {
    const namespace = fakeQuotaNamespace(() => NOW);
    const a = apiCacheOf(namespace);
    const b = apiCacheOf(namespace);
    await a.put("doc:X", { estado: "sellado" }, 1000);
    expect((await b.get<{ estado: string }>("doc:X"))?.value).toEqual({ estado: "sellado" });
    expect((await b.getMany(["doc:X", "doc:Y"])).size).toBe(1);
    await b.del("doc:X");
    expect(await a.get("doc:X")).toBeNull();
  });
});
