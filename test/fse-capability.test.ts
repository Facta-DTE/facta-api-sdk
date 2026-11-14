import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import type { DteRequest } from "../src/types.ts";
import type { ArchiveOperation, InvoiceArchive } from "../src/archive.ts";

const request: DteRequest = {
  tipoDte: "14",
  receptor: { nombre: "Local supplier", numDocumento: "061234567", direccion: { departamento: "06", municipio: "20", complemento: "Local fixture" } },
  incomeWithholding: { mode: "per_line" },
  items: [{ descripcion: "Service", cantidad: 1, precioUni: 50, applyIncomeWithholding: true }],
};
const supported = { capabilities: { fseIncomeWithholdingPerLine: true } };

function transport(replies: unknown[]) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: new URL(String(url)).pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve(new Response(JSON.stringify(replies.shift()), { headers: { "Content-Type": "application/json" } }));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

Deno.test("per-line requests refuse old or malformed server capabilities before POST or archive writes", async () => {
  for (const status of [{}, { capabilities: {} }, { capabilities: { fseIncomeWithholdingPerLine: false } }, { capabilities: { fseIncomeWithholdingPerLine: "true" } }]) {
    for (const method of ["issue", "prepare", "issueAndArchive"] as const) {
      const { fetch, calls } = transport([status]);
      let writes = 0;
      const archive = { assertReady: async () => { writes++; }, begin: async () => { writes++; return true; } } as never;
      const client = new Facta({ region: false, apiKey: "key.secret", fetch });
      const invoke = method === "issueAndArchive"
        ? () => client.issueAndArchive(request, { archive, operationId: "test", idempotencyKey: "test" })
        : () => client[method](request);
      const error = await assertRejects(invoke, FactaError);
      assertEquals(error.code, "fse_withholding_not_supported");
      assertEquals(error.details, { field: "incomeWithholding" });
      assertEquals(calls.map((call) => call.method), ["GET"]);
      assertEquals(calls[0].path.endsWith("/v1/status"), true);
      assertEquals(writes, 0);
    }
  }
});

Deno.test("supported per-line requests retain their exact payload through issue and prepare", async () => {
  for (const method of ["issue", "prepare"] as const) {
    const result = method === "issue" ? { estado: "sellado" } : { prepareToken: "local", documento: {} };
    const { fetch, calls } = transport([supported, result]);
    await new Facta({ region: false, apiKey: "key.secret", fetch })[method](request);
    assertEquals(calls.map((call) => call.method), ["GET", "POST"]);
    assertEquals(calls[1].body, request);
  }
});

Deno.test("per-line support is rechecked after a successful operation to detect server rollback", async () => {
  const { fetch, calls } = transport([supported, { estado: "sellado" }, {}]);
  const client = new Facta({ region: false, apiKey: "key.secret", fetch });
  await client.issue(request);
  const error = await assertRejects(() => client.issue(request), FactaError);
  assertEquals(error.code, "fse_withholding_not_supported");
  assertEquals(calls.map((call) => call.method), ["GET", "POST", "GET"]);
});

Deno.test("local validation and cancellation still precede capability lookup", async () => {
  const { fetch, calls } = transport([]);
  const client = new Facta({ region: false, apiKey: "key.secret", fetch });
  await assertRejects(() => client.issue({ ...request, aplicarReteRenta: false } as never), FactaError);
  const controller = new AbortController();
  controller.abort();
  await assertRejects(() => client.prepare(request, { signal: controller.signal }));
  assertEquals(calls.length, 0);
});

Deno.test("recovery cannot reissue a stored per-line request after server rollback", async () => {
  const baseUrl = "https://example.test/api-v1";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(request))));
  const operation: ArchiveOperation = {
    id: "local-operation",
    identity: { version: 1, endpoint: baseUrl, keyId: "key", issuerNit: "0614-010101-101-1", environment: "00" },
    request,
    requestSha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join(""),
    idempotencyKey: "local-key",
    idempotencyHash: "body",
    state: "started",
    createdAt: new Date().toISOString(),
  };
  let writes = 0;
  const archive = {
    assertReady: async () => {},
    find: async () => operation,
    begin: async () => { writes++; return true; },
    markNeedsAttention: async () => { writes++; },
  } as unknown as InvoiceArchive;
  const { fetch, calls } = transport([
    { ambiente: "00", llave: { keyId: "key" }, emisor: { nit: "0614-010101-101-1", ambiente: "00" } },
    {},
  ]);
  const client = new Facta({ baseUrl, region: false, clock: false, apiKey: "key.secret", fetch });
  const error = await assertRejects(() => client.recoverOperation(operation.id, { archive }));
  if (!(error instanceof FactaError)) throw error;
  assertEquals(error.code, "fse_withholding_not_supported");
  assertEquals(calls.map((call) => call.method), ["GET", "GET"]);
  assertEquals(writes, 0);
});
