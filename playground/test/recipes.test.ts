import { describe, expect, it } from "vitest";
import { handleApi } from "../server/router.ts";
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

function fakeApi(calls: Call[] = [], options: { hangFirstIssue?: boolean } = {}): typeof fetch {
  let issues = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.slice(API.length);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path, headers: new Headers(init?.headers), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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

async function world(options: { hangFirstIssue?: boolean; unlock?: boolean } = {}) {
  const keys = await makeKeys();
  const quota = fakeQuotaNamespace(() => NOW);
  const env = goodEnv({
    FACTA_API_KEY: API_KEY,
    FACTA_SIGN_KEY: SIGN_KEY,
    QUOTA: quota,
    ...(options.unlock ? { FACTA_UNLOCK_KEY: UNLOCK_KEY } : {}),
    FACTA_DTE_FIXTURES_JSON: JSON.stringify({
      "03": { tipoDte: "03", receptor: { nombre: "Comercial de Prueba" }, items: [{ descripcion: "Servicio", cantidad: 1, precioUni: 2 }] },
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
    expect(body.files.map((f: { name: string }) => f.name).sort()).toEqual([`${CODE}.json`, `${CODE}.pdf`]);
    expect(body.issued).toEqual([{ codigoGeneracion: CODE, tipoDte: "01" }]);
    // The credentials travel to the API, never back to the page.
    expect(calls[0]!.headers.get("x-facta-key")).toBe(API_KEY);
    expect(body.steps.every((s: object) => !("headers" in s))).toBe(true);
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
    const order = JSON.stringify({ orderId: "ORD-1", customerRef: "c1", lines: [{ sku: "p1", qty: 2 }] });
    for (let i = 0; i < 2; i++) expect((await (await run({ recipe: "order-webhook", params: { order } })).json() as { ok: boolean }).ok).toBe(true);
    expect(await peek("ana@example.com")).toBe(before - 1);
    expect(calls[0]!.body).toMatchObject({ tipoDte: "01", items: [{ descripcion: "Café", cantidad: 2, precioUni: 2 }] });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(calls[1]!.headers.get("idempotency-key"));
    expect((await run({ recipe: "order-webhook", params: { order: JSON.stringify({ orderId: "O", lines: [{ sku: "nope", qty: 1 }] }) } })).status).toBe(400);
    expect((await run({ recipe: "order-webhook", params: { order: "{not json" } })).status).toBe(400);
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
