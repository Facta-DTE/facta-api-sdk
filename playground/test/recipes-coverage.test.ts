import { describe, expect, it } from "vitest";
import { archivoDteOf } from "../../mod.ts";
import { handleApi } from "../server/router.ts";
import { RECIPE_SPECS } from "../server/recipes/specs.ts";
import { RECIPES } from "../server/recipes/index.ts";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

// The recipes added for SDK coverage (7-Oct-2026): archivo-dte, region-timings, diagnose, delivery-status,
// register-return, reference-clock, service-info and emergency-store. Each runs the real recipe file against a
// fake API; nothing here reaches the network.
const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";
const API = "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";
const API_KEY = "facta_test_unit.unit-test-secret";
const SIGN_KEY = "factask_unit-test-secret-0000";
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const EVENT = "11111111-9B3D-4A6E-8F10-2D5B7C9E1A34";

const b64url = (text: string) => btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const DOCUMENT = { identificacion: { codigoGeneracion: CODE, tipoDte: "01" }, resumen: { totalPagar: 1 } };
const JWS = `${b64url('{"alg":"RS512"}')}.${b64url(JSON.stringify(DOCUMENT))}.firma`;
const ARCHIVO = JSON.stringify({ ...DOCUMENT, firmaElectronica: JWS, selloRecibido: "SELLO" }, null, 2);
const RAW = JSON.stringify({ codigoGeneracion: CODE, ambiente: "00", jws: JWS });

const sealed = (tipoDte = "01") => ({
  estado: "sellado", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000001", tipoDte, ambiente: "00",
  fecEmi: "2026-10-06", horEmi: "10:00:00", selloRecibido: "SELLO", observaciones: [], totales: { totalPagar: 1 },
  documento: DOCUMENT, jws: JWS, archivoJson: RAW, archivoDte: ARCHIVO, representacionGrafica: btoa("%PDF-1.4 test"),
});

interface Call { method: string; path: string; headers: Headers; body: unknown }

function fakeApi(calls: Call[], options: { tipoDte?: string; notSealed?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-sb-edge-region": "us-west-2", ...extra } });
    if (!url.startsWith(API)) {
      // The reference clock: an echo of the four NTP timestamps is out of scope here; an unreachable clock is a valid state.
      calls.push({ method, path: url, headers, body: undefined });
      return new Response("no clock in tests", { status: 503 });
    }
    const path = url.slice(API.length);
    if (method === "GET" && path === "/v1/status") {
      return json({
        ok: true, version: "0.1.0", ambiente: "00", region: "us-west-2",
        emisor: { nit: "00000000000000", nombre: "Emisor secreto", ambiente: "00" },
        llave: { keyId: "k1", label: "playground", modo: "custodian", alcances: ["issue", "query", "download"], tiposDte: ["01", "03"], venceEl: null, catalogMode: "encrypted" },
        sincronizacion: { catalog: { status: "ready", desiredRevision: 1, publishedRevision: 1 } },
        limites: { hora: null, dia: null, estado: null, montoMaximoPorDocumentoCentavos: 100000 },
        ...(headers.get("x-facta-debug") === "timings" ? { debug: { timings: [{ step: "auth", ms: 3 }, { step: "db", ms: 12 }], totalMs: 15 } } : {}),
      });
    }
    calls.push({ method, path, headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (method === "GET" && path === "/v1/openapi.json") return json({ info: { title: "Facta", version: "1.0.0" }, paths: { "/v1/status": {}, "/v1/dte": {} } });
    if (method === "POST" && path === "/v1/dte") return json(sealed(options.tipoDte));
    if (method === "GET" && path === `/v1/dte/${CODE}`) return json({ estado: "sellado", codigoGeneracion: CODE, numeroControl: "n", tipoDte: options.tipoDte ?? "01", ambiente: "00", fecEmi: "2026-10-06", selloRecibido: "SELLO", totales: {} });
    if (method === "GET" && path.startsWith(`/v1/dte/${CODE}/file?`)) {
      const query = new URL(url).searchParams;
      if (query.get("raw") !== "true" && options.notSealed) return json({ error: { code: "not_sealed", message: "El documento no tiene sello." } }, 409);
      const raw = query.get("raw") === "true";
      return new Response(new TextEncoder().encode(raw ? RAW : ARCHIVO), { headers: { "content-type": "application/json", "x-facta-json-format": raw ? "raw" : "archivo-dte", "x-facta-storage-source": "archive" } });
    }
    if (method === "GET" && path === `/v1/dte/${CODE}/entrega`) return json({ codigoGeneracion: CODE, ambiente: "00", canales: { correo: { estado: "enviado", destino: "a•••@ejemplo.com", actualizado: "2026-10-06T10:00:00Z" } } });
    if (method === "POST" && path === `/v1/dte/${CODE}/return`) {
      return json({
        estado: "sellado", codigoGeneracion: EVENT, documentoRelacionado: { codigoGeneracion: CODE, numeroControl: "n", tipoDte: "01", fecEmi: "2026-10-06" },
        ambiente: "00", fecEmi: "2026-10-07", horEmi: "10:00:00", totales: { totalGravada: 1, totalExenta: 0, totalNoSuj: 0, totalIva: 0.13, totalPagar: 1 },
        documento: {}, jws: JWS, archivoJson: RAW, disponible: [{ linea: 1, vendida: 2, devuelta: 1, disponible: 1, noGravado: null }],
        selloRecibido: "SELLO-EVENTO", representacionGrafica: null, anotadoEnElLibro: true,
      });
    }
    return json({ error: { code: "not_found", message: "no" } }, 404);
  }) as typeof fetch;
}

async function world(options: { tipoDte?: string; notSealed?: boolean } = {}) {
  const keys = await makeKeys();
  const env = goodEnv({
    FACTA_API_KEY: API_KEY, FACTA_SIGN_KEY: SIGN_KEY, QUOTA: fakeQuotaNamespace(() => NOW),
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({ products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }] }),
  });
  const calls: Call[] = [];
  const deps = { keys: async () => [keys.jwk], now: () => NOW, fetch: fakeApi(calls, options) };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const run = (body: unknown, as = "ana@example.com") =>
    call("/api/recipes/run", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, as });
  const issue = async () => ((await (await run({ recipe: "issue-idempotent", params: { type: "01" } })).json()) as { issued: Array<{ codigoGeneracion: string }> }).issued[0]!.codigoGeneracion;
  const remaining = async () => (await (await call("/api/state", { as: "ana@example.com" })).json() as { quota: { remainingHour: number } }).quota.remainingHour;
  return { run, issue, calls, remaining };
}

describe("every SDK-coverage recipe is registered", () => {
  it("has a spec, a binder and a file for each new recipe", () => {
    for (const id of ["archivo-dte", "region-timings", "diagnose", "delivery-status", "register-return", "reference-clock", "service-info", "emergency-store"]) {
      expect(RECIPE_SPECS.some((s) => s.id === id), id).toBe(true);
      expect(Object.hasOwn(RECIPES, id), id).toBe(true);
    }
    expect(new Set(RECIPE_SPECS.map((s) => s.id)).size).toBe(RECIPE_SPECS.length);
  });
});

describe("archivo-dte", () => {
  it("returns the Archivo DTE and the stored original as two files, and the local rebuild matches", async () => {
    const { run, issue } = await world();
    const code = await issue();
    const body = await (await run({ recipe: "archivo-dte", params: { code } })).json() as { ok: boolean; result: Record<string, unknown>; files: Array<{ name: string; role?: string }> };
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ jsonFormat: "archivo-dte", rawFormat: "raw", rebuiltMatches: true, notSealed: false });
    expect(body.files.filter((f) => f.role === "dte").map((f) => f.name)).toEqual([`${CODE}.json`]);
    expect(body.files.filter((f) => f.role === "raw").map((f) => f.name)).toEqual([`${CODE}.raw.json`]);
    expect(archivoDteOf({ jws: JWS, selloRecibido: "SELLO" })).toBe(ARCHIVO);
  });

  it("reports a document without a seal instead of failing, and still offers the original", async () => {
    const { run, issue } = await world({ notSealed: true });
    const code = await issue();
    const body = await (await run({ recipe: "archivo-dte", params: { code } })).json() as { ok: boolean; result: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ notSealed: true, rebuiltMatches: null });
    expect(body.result).not.toHaveProperty("archivoDte");
  });

  it("refuses a document the visitor did not issue here", async () => {
    const { run } = await world();
    const response = await run({ recipe: "archivo-dte", params: { code: CODE } });
    expect(response.status).toBe(403);
  });
});

describe("read-only recipes", () => {
  it("region-timings returns the region and the API's per-step times, asked for on that call only", async () => {
    const { run, calls } = await world();
    const body = await (await run({ recipe: "region-timings", params: {} })).json() as { ok: boolean; result: { functionsRegion: string; servedFrom: string; debug: { timings: Array<{ step: string }>; totalMs: number } } };
    expect(body.ok).toBe(true);
    expect(body.result.functionsRegion).toBe("us-west-2");
    expect(body.result.servedFrom).toBe("us-west-2");
    expect(body.result.debug.timings.map((t) => t.step)).toEqual(["auth", "db"]);
    expect(calls.every((c) => c.headers.get("x-facta-debug") === null || c.path === "/v1/status")).toBe(true);
  });

  it("diagnose returns the checks and the catalog state, and no recipe leaks the key or the issuer", async () => {
    const { run } = await world();
    const text = await (await run({ recipe: "diagnose", params: {} })).text();
    const body = JSON.parse(text) as { ok: boolean; result: { diagnostics: { checks: unknown[] }; catalog: { catalogMode: string } } };
    expect(body.ok).toBe(true);
    expect(body.result.diagnostics.checks.length).toBeGreaterThan(0);
    expect(body.result.catalog.catalogMode).toBe("encrypted");
    for (const secret of [API_KEY, SIGN_KEY, "Emisor secreto"]) expect(text).not.toContain(secret);
  });

  it("service-info shows the key's scopes and the contract's paths but never the issuer", async () => {
    const { run } = await world();
    const text = await (await run({ recipe: "service-info", params: {} })).text();
    const body = JSON.parse(text) as { result: { environment: string; key: { scopes: string[] }; contract: { operations: number; paths: string[] } } };
    expect(body.result.environment).toBe("00");
    expect(body.result.key.scopes).toEqual(["issue", "query", "download"]);
    expect(body.result.contract).toMatchObject({ operations: 2, paths: ["/v1/status", "/v1/dte"] });
    expect(text).not.toContain("Emisor secreto");
  });

  it("reference-clock answers even when the clock service is unreachable (device clock, never an error)", async () => {
    const { run } = await world();
    const body = await (await run({ recipe: "reference-clock", params: {} })).json() as { ok: boolean; result: { enabled: boolean; state: { status: string } } };
    expect(body.ok).toBe(true);
    expect(body.result.enabled).toBe(true);
    expect(["device", "provisional", "calibrated"]).toContain(body.result.state.status);
  });

  it("delivery-status reads the channels of an owned document, and refuses anyone else's", async () => {
    const { run, issue } = await world();
    expect((await run({ recipe: "delivery-status", params: { code: CODE } })).status).toBe(403);
    const code = await issue();
    const body = await (await run({ recipe: "delivery-status", params: { code } })).json() as { result: { canales: { correo: { estado: string } } } };
    expect(body.result.canales.correo.estado).toBe("enviado");
  });
});

describe("emergency-store (simulated)", () => {
  const simulate = async (params: Record<string, unknown>) => {
    const { run, calls } = await world();
    const body = await (await run({ recipe: "emergency-store", params: { scenario: "sin_almacenamiento_duradero", ...params } })).json() as {
      ok: boolean; steps: unknown[]; issued: unknown[];
      result: { simulated: boolean; report: { saved: boolean; reason: string; critical?: boolean } | null; calledYourFunction: Array<{ info: { warnings: string[] }; files: { archivoDteBytes: number | null; pdfBytes: number | null } }> };
    };
    return { body, calls };
  };

  it("calls your function once with the three files and the warning, without touching the API or the ledger", async () => {
    const { body, calls } = await simulate({});
    expect(body.ok).toBe(true);
    expect(body.result.simulated).toBe(true);
    expect(body.result.report).toMatchObject({ saved: true, reason: "server_warning" });
    expect(body.result.calledYourFunction).toHaveLength(1);
    expect(body.result.calledYourFunction[0]!.info.warnings).toEqual(["sin_almacenamiento_duradero"]);
    expect(body.result.calledYourFunction[0]!.files.archivoDteBytes).toBeGreaterThan(0);
    expect(body.result.calledYourFunction[0]!.files.pdfBytes).toBeGreaterThan(0);
    // The fake API lives inside the recipe: the Worker's client made no request and the ledger records nothing.
    expect(body.steps).toEqual([]);
    expect(body.issued).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reports a failing store and a missing store without hiding the sealed result", async () => {
    expect((await simulate({ storeFails: true })).body.result.report).toMatchObject({ saved: false, reason: "store_failed" });
    expect((await simulate({ notConfigured: true })).body.result.report).toMatchObject({ saved: false, reason: "not_configured" });
    expect((await simulate({ scenario: "sin_copia_en_servidor" })).body.result.report).toMatchObject({ saved: true, critical: true });
  });

  it("refuses a scenario it does not know", async () => {
    const { run } = await world();
    expect((await run({ recipe: "emergency-store", params: { scenario: "boom" } })).status).toBe(400);
  });
});

describe("register-return", () => {
  it("returns units of an owned Factura, counts one unit of quota and signs with the sign key", async () => {
    const { run, issue, calls, remaining } = await world();
    const code = await issue();
    const before = await remaining();
    const body = await (await run({ recipe: "register-return", params: { code, linea: 1, cantidad: 1 } })).json() as { ok: boolean; result: { estado: string; disponible: Array<{ disponible: number }> } };
    expect(body.ok).toBe(true);
    expect(body.result.estado).toBe("sellado");
    expect(body.result.disponible[0]!.disponible).toBe(1);
    const sent = calls.find((c) => c.path.endsWith("/return"))!;
    expect(sent.body).toEqual({ items: [{ linea: 1, cantidad: 1 }] });
    expect(sent.headers.get("x-facta-sign-key")).toBe(SIGN_KEY);
    expect(sent.headers.get("idempotency-key")).toBeTruthy();
    expect(await remaining()).toBe(before - 1);
  });

  it("is only for the types the API supports, and only for the visitor's own documents", async () => {
    const credit = await world({ tipoDte: "03" });
    const code = await credit.issue();
    // The ledger knows it as a Crédito fiscal: refused before any call.
    const refused = await credit.run({ recipe: "register-return", params: { code, linea: 1, cantidad: 1 } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("return_type_not_allowed");
    const { run } = await world();
    expect((await run({ recipe: "register-return", params: { code: CODE, linea: 1, cantidad: 1 } })).status).toBe(403);
  });

  it("validates the line and the quantity", async () => {
    const { run, issue } = await world();
    const code = await issue();
    expect((await run({ recipe: "register-return", params: { code, linea: 0, cantidad: 1 } })).status).toBe(400);
    expect((await run({ recipe: "register-return", params: { code, linea: 1, cantidad: 1.5 } })).status).toBe(400);
  });
});
