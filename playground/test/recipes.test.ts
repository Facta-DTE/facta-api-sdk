import { describe, expect, it } from "vitest";
import { handleApi } from "../server/router.ts";
import { TIMINGS_HEADER } from "../shared/timings.ts";
import { redact } from "../server/recipes/redact.ts";
import { RECIPE_SPECS } from "../server/recipes/specs.ts";
import { denoBunScript, nodeScript, portableSource, projectFiles, projectZip } from "../site/sections/server/export.ts";
import { crc32 } from "../site/sections/server/zip.ts";
import { readFileSync, readdirSync } from "node:fs";
import { accessClaims, fakeQuotaNamespace, goodEnv, makeKeys } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const URL_BASE = "https://playground.factadte.com";
const API = "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1";

const API_KEY = "facta_test_unit.unit-test-secret";
const SIGN_KEY = "factask_unit-test-secret-0000";
const UNLOCK_KEY = "factauk_unit-test-unlock-0000";
const CODE = "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34";
const OTHER_CODE = "AAAAAAAA-9B3D-4A6E-8F10-2D5B7C9E1A34";

const pdf = btoa("%PDF-1.4 test");
const sealed = (code = CODE) => ({
  estado: "sellado",
  codigoGeneracion: code,
  numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-06",
  horEmi: "10:00:00",
  selloRecibido: "SELLO",
  fhProcesamiento: null,
  observaciones: [`rechazo con ${API_KEY} y ${SIGN_KEY}`],
  totales: { totalPagar: 1 },
  documento: { identificacion: { codigoGeneracion: code } },
  jws: "x.y.z",
  archivoJson: JSON.stringify({ ok: true }),
  representacionGrafica: pdf,
  // Fields a careless server could echo: they must never reach the visitor.
  debug: { apiKey: API_KEY, signKey: SIGN_KEY, unlockKey: UNLOCK_KEY, bucket: "facta-secret-bucket", path: "DTE/2026/10/secret-path.json" },
  entrega: { token: "delivery-token-value", correo: "esperando" },
});

interface Call { method: string; path: string; headers: Headers; body: unknown }

function fakeApi(calls: Call[] = [], options: { hangFirstIssue?: boolean; failIssue?: 422 | 429 } = {}): typeof fetch {
  let issues = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.slice(API.length);
    const method = (init?.method ?? "GET").toUpperCase();
    // The Worker learns the API's region once from /v1/status and pins every call to it; not a recipe call.
    if (method === "GET" && path === "/v1/status") return new Response(JSON.stringify({ ok: true, region: "us-west-2" }), { status: 200, headers: { "content-type": "application/json", "x-sb-edge-region": "us-west-2" } });
    calls.push({ method, path, headers: new Headers(init?.headers), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-sb-edge-region": "us-west-2" } });
    if (method === "POST" && path === "/v1/dte" && options.failIssue === 429) {
      return json({ error: { code: "rate_limited", message: "Demasiadas solicitudes" } }, 429);
    }
    if (method === "POST" && path === "/v1/dte" && options.failIssue === 422) {
      return json({ error: { code: "mh_rejected", message: "Hacienda rechazó el documento", details: { observaciones: ["[incoterms] debe ser un código de CAT-031"], codigoGeneracion: CODE, numeroControl: "DTE-11-M001P001-000000000000001" } } }, 422);
    }
    if (method === "POST" && path === "/v1/dte") {
      issues++;
      if (options.hangFirstIssue && issues === 1) {
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      return json(sealed());
    }
    if (method === "POST" && path === "/v1/dte/prepare") {
      return json({ estado: "preparado", codigoGeneracion: CODE, numeroControl: "DTE-01-M001P001-000000000000002", tipoDte: "01", ambiente: "00", totales: { totalPagar: 1 }, documento: { identificacion: { codigoGeneracion: CODE }, resumen: { totalPagar: 1 } }, prepareToken: "prepare-token-secret" });
    }
    if (method === "POST" && path === "/v1/dte/sign") return json(sealed());
    if (method === "POST" && path.endsWith("/invalidate")) {
      return json({ estado: "invalidado", codigoGeneracion: CODE, numeroControl: "n", tipoDte: "01", ambiente: "00", evento: { codigoGeneracion: OTHER_CODE, selloRecibido: "s", tipoAnulacion: 2 }, documento: {}, jws: "j", anotadoEnElIndice: true });
    }
    if (method === "GET" && path.startsWith("/v1/dte?")) {
      return json({
        documentos: [
          { estado: "sellado", codigoGeneracion: CODE, numeroControl: "n1", tipoDte: "01", fecEmi: "2026-10-06", receptor: { nombre: "Cliente Secreto" } },
          { estado: "sellado", codigoGeneracion: OTHER_CODE, numeroControl: "n2", tipoDte: "01", fecEmi: "2026-10-06", receptor: { nombre: "Otro Visitante" } },
        ],
        siguiente: null,
      });
    }
    if (method === "GET" && path.includes("/file?")) return new Response(new TextEncoder().encode("%PDF-bytes"), { headers: { "content-type": "application/pdf", "x-facta-storage-source": "archive" } });
    if (method === "GET" && path === "/v1/storage/status") {
      return json({ capabilityVersion: 1, managed: { configured: true, ready: true, state: "ready", integration: "ready", quotaBytes: 100, usedBytes: 1, reservedBytes: 0, usedBytesTotal: 1, reservedBytesTotal: 0, coveredUntil: null, accessUntil: null, bucketState: "ok", backupState: "ok" }, byos: { ready: false }, supportedKinds: ["json", "pdf"], unsupportedKinds: [] });
    }
    if (method === "GET" && path.startsWith("/v1/storage/copies")) return json({ capabilityVersion: 1, copies: [] });
    if (method === "GET" && path.startsWith("/v1/dte/")) return json({ estado: "sellado", codigoGeneracion: CODE, numeroControl: "n", tipoDte: "01", ambiente: "00", fecEmi: "2026-10-06", selloRecibido: "s", totales: {} });
    return json({ error: { code: "not_found", message: "no" } }, 404);
  }) as typeof fetch;
}

async function world(options: { hangFirstIssue?: boolean; unlock?: boolean; failIssue?: 422 | 429 } = {}) {
  const keys = await makeKeys();
  const quota = fakeQuotaNamespace(() => NOW);
  const env = goodEnv({
    FACTA_API_KEY: API_KEY,
    FACTA_SIGN_KEY: SIGN_KEY,
    QUOTA: quota,
    ...(options.unlock ? { FACTA_UNLOCK_KEY: UNLOCK_KEY } : {}),
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({
      "03": { tipoDte: "03", receptor: { nombre: "Comercial de Prueba" }, items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 2, tipoItem: 2 }] },
      customers: [{ id: "c1", label: "Cliente uno", receptor: { nombre: "Cliente uno" } }],
      products: [{ id: "p1", label: "Café", descripcion: "Café", precioUni: 2 }],
    }),
  });
  const calls: Call[] = [];
  const deps = { keys: async () => [keys.jwk], now: () => NOW, fetch: fakeApi(calls, options) };
  const call = async (path: string, init: RequestInit & { as?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.as) headers.set("cf-access-jwt-assertion", await keys.sign(accessClaims(seconds, { email: init.as })));
    return handleApi(new Request(`${URL_BASE}${path}`, { ...init, headers }), env, deps);
  };
  const run = (body: unknown, as: string | null = "ana@example.com") =>
    call("/api/recipes/run", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-facta-ui": "1" }, ...(as ? { as } : {}) });
  const peek = async (email: string) => (await (await call("/api/state", { as: email })).json() as { quota: { remainingHour: number } }).quota.remainingHour;
  return { env, calls, call, run, peek };
}

const LEAKS = [API_KEY, SIGN_KEY, UNLOCK_KEY, "facta-secret-bucket", "secret-path.json", "delivery-token-value", "prepare-token-secret", "x-facta-key"];

describe("recipes API", () => {
  it("requires a visitor and the browser headers, and refuses unknown recipes", async () => {
    const { run, call } = await world();
    expect((await run({ recipe: "issue-idempotent", params: { type: "01" } }, null)).status).toBe(401);
    expect((await call("/api/recipes/run", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, as: "ana@example.com" })).status).toBe(400);
    expect((await run({ recipe: "rm-rf", params: {} })).status).toBe(404);
    expect((await run({ recipe: "issue-idempotent", stage: "nope", params: { type: "01" } })).status).toBe(400);
    expect((await run({ recipe: "issue-idempotent", params: { type: "99" } })).status).toBe(400);
  });

  it("issues, returns files and steps, and never leaks a credential, bucket or path", async () => {
    const { run, calls } = await world();
    const response = await run({ recipe: "issue-idempotent", params: { type: "01" } });
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const leak of LEAKS) expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    const body = JSON.parse(text);
    expect(body.ok).toBe(true);
    expect(body.steps[0]).toMatchObject({ method: "POST", endpoint: "/v1/dte", status: 200 });
    expect(body.files.map((f: { name: string }) => f.name).sort()).toEqual([`${CODE}.json`, `${CODE}.pdf`, `${CODE}.raw.json`]);
    expect(body.issued).toMatchObject([{ codigoGeneracion: CODE, tipoDte: "01" }]);
    // The credentials travel to the API, never back to the page.
    expect(calls[0]!.headers.get("x-facta-key")).toBe(API_KEY);
    // Pinned next to the database: the region was learned once from /v1/status.
    expect(calls[0]!.headers.get("x-region")).toBe("us-west-2");
    expect(body.steps.every((s: object) => !("headers" in s))).toBe(true);
  });

  it("shows the region that served the API in the timings, only when timings were asked for", async () => {
    const { call } = await world();
    const post = (extra: Record<string, string>) => call("/api/recipes/run", {
      method: "POST",
      body: JSON.stringify({ recipe: "issue-idempotent", params: { type: "01" } }),
      headers: { "content-type": "application/json", "x-facta-ui": "1", ...extra },
      as: "ana@example.com",
    });
    const plain = await (await post({})).json() as { timings?: unknown };
    expect(plain.timings).toBeUndefined();
    const timed = await (await post({ [TIMINGS_HEADER]: "1" })).json() as { timings: { region?: string } };
    expect(timed.timings.region).toBe("us-west-2");
  });

  it("scrubs secrets that appear in free text", async () => {
    const { run } = await world();
    const body = await (await run({ recipe: "issue-idempotent", params: { type: "01" } })).json() as { result: { observaciones: string[] } };
    expect(body.result.observaciones[0]).not.toContain(API_KEY);
    expect(body.result.observaciones[0]).not.toContain(SIGN_KEY);
  });

  it("counts an issue once: the same run is free to retry", async () => {
    const { run, peek } = await world();
    const before = await peek("ana@example.com");
    const first = await (await run({ recipe: "issue-idempotent", params: { type: "01" } })).json() as { runId: string };
    expect(await peek("ana@example.com")).toBe(before - 1);
    await run({ recipe: "issue-idempotent", runId: first.runId, params: { type: "01" } });
    expect(await peek("ana@example.com")).toBe(before - 1);
    await run({ recipe: "issue-idempotent", params: { type: "01" } });
    expect(await peek("ana@example.com")).toBe(before - 2);
  });

  it("counts nothing for a rejection or an API rate limit, and counts a later success once", async () => {
    for (const failIssue of [422, 429] as const) {
      const { run, peek } = await world({ failIssue });
      const before = await peek("ana@example.com");
      const failed = await (await run({ recipe: "issue-idempotent", params: { type: "01" } })).json() as { ok: boolean };
      expect(failed.ok).toBe(false);
      expect(await peek("ana@example.com")).toBe(before);
    }
    const { run, peek } = await world();
    const before = await peek("ana@example.com");
    await run({ recipe: "issue-idempotent", params: { type: "01" } });
    expect(await peek("ana@example.com")).toBe(before - 1);
  });

  it("a note only relates a Crédito fiscal: a Factura of the visitor is refused with the reason", async () => {
    const { run } = await world();
    const issued = await (await run({ recipe: "issue-idempotent", params: { type: "01" } })).json() as { issued: Array<{ codigoGeneracion: string }> };
    const refused = await run({ recipe: "issue-idempotent", params: { type: "05", related: issued.issued[0]!.codigoGeneracion } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "related_not_ccf", message: expect.stringContaining("Comprobante de crédito fiscal (03)") });
  });

  it("answers 429 with Retry-After when the quota is spent", async () => {
    const { run } = await world();
    for (let i = 0; i < 20; i++) expect((await run({ recipe: "issue-idempotent", params: { type: "01" } })).status).toBe(200);
    const refused = await run({ recipe: "issue-idempotent", params: { type: "01" } });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
  });

  it("does not count reads", async () => {
    const { run, peek } = await world();
    const before = await peek("ana@example.com");
    await run({ recipe: "documents-storage", params: { kind: "pdf", limit: "10" } });
    expect(await peek("ana@example.com")).toBe(before);
  });

  it("recipe 5 can download the ticket at the roll width asked, and refuses a width the API would", async () => {
    const { run, calls } = await world();
    await run({ recipe: "issue-idempotent", params: { type: "01" } });
    const ok = await run({ recipe: "documents-storage", params: { code: CODE, kind: "ticket", paperWidthMm: 58, limit: "5" } });
    expect(ok.status).toBe(200);
    expect(calls.some((c) => c.path === `/v1/dte/${CODE}/file?kind=ticket&paperWidthMm=58`)).toBe(true);
    for (const bad of [39, 121, 80.5, "abc", "5"]) {
      const refused = await run({ recipe: "documents-storage", params: { code: CODE, kind: "ticket", paperWidthMm: bad, limit: "5" } });
      expect(refused.status).toBe(400);
    }
    // The width is ignored (not even read) for a PDF.
    expect((await run({ recipe: "documents-storage", params: { code: CODE, kind: "pdf", paperWidthMm: 999, limit: "5" } })).status).toBe(200);
  });

  it("prepares, shows the canonical document and signs from a sealed continuation", async () => {
    const { run } = await world();
    const prepared = await (await run({ recipe: "prepare-sign", stage: "prepare", params: { type: "01" } })).json() as { runId: string; continuation: string; result: { documento: unknown; prepareToken?: unknown } };
    expect(prepared.result.documento).toMatchObject({ identificacion: { codigoGeneracion: CODE } });
    expect(prepared.result.prepareToken).toBeUndefined();
    expect(JSON.stringify(prepared)).not.toContain("prepare-token-secret");
    // Another visitor cannot use it; a forged blob is refused.
    expect((await run({ recipe: "prepare-sign", stage: "sign", runId: prepared.runId, params: { continuation: prepared.continuation } }, "bruno@example.com")).status).toBe(410);
    expect((await run({ recipe: "prepare-sign", stage: "sign", runId: prepared.runId, params: { continuation: "x".repeat(80) } })).status).toBe(410);
    const signed = await (await run({ recipe: "prepare-sign", stage: "sign", runId: prepared.runId, params: { continuation: prepared.continuation } })).json() as { ok: boolean; issued: unknown[] };
    expect(signed.ok).toBe(true);
    expect(signed.issued).toHaveLength(1);
  });

  it("recovers after a simulated client timeout with the same key", async () => {
    const { run, calls } = await world({ hangFirstIssue: true });
    const body = await (await run({ recipe: "status-recovery", params: { type: "01", simulateTimeout: true } })).json() as { ok: boolean; result: { uncertain: boolean; steps: string[]; status: { estado: string } } };
    expect(body.ok).toBe(true);
    expect(body.result.uncertain).toBe(true);
    const issues = calls.filter((c) => c.method === "POST" && c.path === "/v1/dte");
    expect(issues).toHaveLength(2);
    expect(issues[0]!.headers.get("idempotency-key")).toBe(issues[1]!.headers.get("idempotency-key"));
    expect(body.result.status.estado).toBe("sellado");
  });

  it("only invalidates, downloads and lists documents this visitor issued", async () => {
    const { run } = await world();
    const form = { code: CODE, tipoAnulacion: "2", motivo: "x", responsableNombre: "Ana", responsableTipo: "13", responsableNumero: "123456789" };
    // Not issued by this visitor yet.
    expect((await run({ recipe: "invalidate", params: form })).status).toBe(403);
    expect((await run({ recipe: "documents-storage", params: { code: CODE, kind: "pdf", limit: "10" } })).status).toBe(403);
    await run({ recipe: "issue-idempotent", params: { type: "01" } });
    // Bruno issued nothing, so he cannot touch Ana's document.
    expect((await run({ recipe: "invalidate", params: form }, "bruno@example.com")).status).toBe(403);
    const listed = await (await run({ recipe: "documents-storage", params: { code: CODE, kind: "pdf", limit: "10" } })).json() as { ok: boolean; result: { documents: Array<{ codigoGeneracion: string; receptor?: unknown }> }; files: unknown[] };
    expect(listed.result.documents.map((d) => d.codigoGeneracion)).toEqual([CODE]);
    expect(JSON.stringify(listed)).not.toContain("Cliente Secreto");
    expect(listed.files.length).toBe(1);
    const voided = await (await run({ recipe: "invalidate", params: form })).json() as { ok: boolean; invalidated: string[] };
    expect(voided.ok).toBe(true);
    expect(voided.invalidated).toEqual([CODE]);
  });

  it("validates invalidation persons", async () => {
    const { run } = await world();
    await run({ recipe: "issue-idempotent", params: { type: "01" } });
    const base = { code: CODE, tipoAnulacion: "2", responsableNombre: "Ana", responsableTipo: "13", responsableNumero: "05308546-5" };
    expect((await run({ recipe: "invalidate", params: base })).status).toBe(400);
    expect((await run({ recipe: "invalidate", params: { ...base, responsableNumero: "123456789", tipoAnulacion: "1" } })).status).toBe(400);
  });

  it("maps a webhook order to one issue, whatever the redeliveries", async () => {
    const { run, calls, peek } = await world();
    const before = await peek("ana@example.com");
    const order = JSON.stringify({ orderId: "ORD-1", customerRef: "CLI-01", lines: [{ sku: "CAF-250", qty: 2 }, { sku: "ENV-SV", qty: 1 }] });
    for (let i = 0; i < 2; i++) expect((await (await run({ recipe: "order-webhook", params: { order } })).json() as { ok: boolean }).ok).toBe(true);
    expect(await peek("ana@example.com")).toBe(before - 1);
    expect(calls[0]!.body).toMatchObject({
      tipoDte: "01",
      receptor: { nombre: "Carlos Ejemplo Rivas", tipoDocumento: "13", numDocumento: "039458719" },
      items: [{ descripcion: "Café molido 250 g", cantidad: 2, precioUni: 4.5 }, { descripcion: "Envío nacional", cantidad: 1, precioUni: 3 }],
    });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(calls[1]!.headers.get("idempotency-key"));
    expect(calls[0]!.headers.get("idempotency-key")).toMatch(/\.order-ORD-1$/);
  });

  it("explains a bad webhook order in plain Spanish, naming the valid options", async () => {
    const { run } = await world();
    const say = async (order: unknown) => {
      const response = await run({ recipe: "order-webhook", params: { order: typeof order === "string" ? order : JSON.stringify(order) } });
      return { status: response.status, message: ((await response.json()) as { error: { message: string } }).error.message };
    };
    const sku = await say({ orderId: "O", lines: [{ sku: "CAF-999", qty: 1 }] });
    expect(sku.status).toBe(400);
    expect(sku.message).toBe("El SKU «CAF-999» no está en la lista de precios de la tienda de ejemplo. Use CAF-250, CAF-500, TAZ-01, FIL-50 o ENV-SV.");
    const customer = await say({ orderId: "O", customerRef: "CLI-9", lines: [{ sku: "CAF-250", qty: 1 }] });
    expect(customer.message).toBe("El cliente CLI-9 no existe en la tienda de ejemplo. Elija uno de la lista (CLI-01, CLI-02 o CLI-03) o deje el pedido sin cliente.");
    expect((await say("{not json")).status).toBe(400);
    expect((await say({ orderId: "O", lines: [{ sku: "CAF-250", qty: 0 }] })).status).toBe(400);
    expect((await say({ orderId: "O", lines: [{ sku: "CAF-250", qty: 1000 }, { sku: "TAZ-01", qty: 1000 }] })).message).toContain("no puede pasar");
  });

  it("keys a recipe run by the visitor's order number, scoped to the visitor", async () => {
    const { run, calls } = await world();
    for (let i = 0; i < 2; i++) await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber: "PED-77" } });
    await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber: "PED-78" } });
    const keys = calls.map((c) => c.headers.get("idempotency-key"));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f]+\.r-issue-idempotent\.PED-77\.01$/);
  });

  it("refuses an order number that is not letters, digits, dot, dash or underscore (up to 64)", async () => {
    const { run } = await world();
    for (const orderNumber of ["a b", "x/../y", "é1", "a".repeat(65), "-start"]) {
      const response = await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber } });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("order_number_invalid");
    }
    expect((await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber: "a".repeat(64) } })).status).toBe(200);
  });

  it("different visitors typing the same order number never share a key", async () => {
    const { run, calls } = await world();
    await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber: "SAME" } }, "ana@example.com");
    await run({ recipe: "issue-idempotent", params: { type: "01", orderNumber: "SAME" } }, "bea@example.com");
    expect(calls[0]!.headers.get("idempotency-key")).not.toBe(calls[1]!.headers.get("idempotency-key"));
  });

  it("needs the unlock key for the catalog recipe", async () => {
    expect((await (await world()).run({ recipe: "catalog-refs", params: { cantidad: 1 } })).status).toBe(503);
  });

  it("has a spec and a file for every recipe", () => {
    const files = readdirSync(new URL("../server/recipes/", import.meta.url));
    for (const spec of RECIPE_SPECS) expect(files).toContain(spec.file);
  });
});

describe("redact", () => {
  it("drops credential and storage keys, scrubs shapes and exact values", () => {
    const out = JSON.stringify(redact({
      apiKey: "a", signKey: "b", unlockKey: "c", bucket: "bk", path: "/p", token: "t",
      note: "ver https://x.supabase.co/storage/v1/object/private/f.pdf y DTE/2026/10/a.json con facta_test_abc.def y mi-valor-secreto",
    }, { secrets: ["mi-valor-secreto"] }));
    for (const leak of ['"a"', "bk", "/p", '"t"', "storage/v1", "DTE/2026", "facta_test_abc", "mi-valor-secreto"]) expect(out).not.toContain(leak);
  });

  it("omits bulky members unless kept, and files become sizes", () => {
    expect(redact({ jws: "x".repeat(10), documento: { a: 1 }, bytes: new Uint8Array(3) })).toEqual({ jws: "[omitido: 10 caracteres]", documento: "[omitido]", bytes: "[archivo de 3 bytes]" });
    expect(redact({ documento: { a: "y".repeat(800) } }, { keep: ["documento"] })).toEqual({ documento: { a: "y".repeat(800) } });
  });
});

describe("redact · the delivery token", () => {
  it("strips every `token` by default, wherever it sits", () => {
    expect(redact({ entrega: { token: "t1", venceEn: "x" }, issued: { entrega: { token: "t2" } } })).toEqual({ entrega: { venceEn: "x" }, issued: { entrega: {} } });
  });

  it("keeps ONLY the token at the exact path named, and other tokens still go", () => {
    const out = redact(
      { entrega: { token: "mine", venceEn: "x" }, issued: { entrega: { token: "dup" } }, prepareToken: "p", other: { token: "o" }, list: [{ entrega: { token: "in-array" } }] },
      { keepAt: ["entrega.token"] },
    );
    expect(out).toEqual({ entrega: { token: "mine", venceEn: "x" }, issued: { entrega: {} }, other: {}, list: [{ entrega: {} }] });
    // The key rule still wins for credentials at a kept path's siblings.
    expect(redact({ entrega: { token: "mine", apiKey: "k" } }, { keepAt: ["entrega.token"] })).toEqual({ entrega: { token: "mine" } });
  });

  it("only the deliver-email issue stage asks for it (no other recipe passes keepAt)", () => {
    const source = readFileSync(new URL("../server/recipes/index.ts", import.meta.url), "utf8");
    expect(source.match(/keepAt:/g)).toHaveLength(1);
    expect(source).toContain('keepAt: ["entrega.token"]');
    expect(readFileSync(new URL("../server/router.ts", import.meta.url), "utf8")).not.toContain("keepAt");
  });
});

describe("generated copies and project", () => {
  const source = readFileSync(new URL("../server/recipes/issue-idempotent.ts", import.meta.url), "utf8");

  it("points the import at the package and keeps the recipe code", () => {
    expect(portableSource(source)).toContain('from "@facta-dte/api"');
    expect(portableSource(source)).not.toContain("mod.ts");
    for (const script of [nodeScript(source), denoBunScript(source)]) {
      expect(script).toContain("process.env.FACTA_API_KEY");
      expect(script).toContain("export async function run");
    }
  });

  it("generates every recipe without checkout imports or credentials", () => {
    for (const spec of RECIPE_SPECS) {
      const raw = readFileSync(new URL(`../server/recipes/${spec.file}`, import.meta.url), "utf8");
      const script = nodeScript(raw);
      expect(script).not.toMatch(/\.\.\/\.\.\/\.\.\//);
      expect(script).not.toMatch(/facta_(test|live)_[A-Za-z0-9]{6,}\./);
      expect(script).toContain("export const sample");
    }
  });

  it("builds a zip that holds a README, .env.example without secrets, and a stored CRC", () => {
    const files = projectFiles(source, "issue-idempotent");
    expect(Object.keys(files).sort()).toEqual([".env.example", ".gitignore", "README.md", "package.json", "recipe.ts"]);
    expect(files[".env.example"]).toContain("facta_test_reemplace");
    expect(files[".gitignore"]).toContain(".env");
    const zip = projectZip(source, "issue-idempotent");
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(5);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
