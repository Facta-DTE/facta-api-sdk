import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import { FileInvoiceArchive } from "../src/file-archive.ts";
import { confirmationBody, sha256OfBytes } from "../src/confirm-storage.ts";
import type { IssueResult, Totals } from "../src/types.ts";

const A = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const B = "11111111-2222-4333-8444-555555555555";
const C = "AAAAAAAA-2222-4333-8444-555555555555";

const row = (code: string, borradoEl = "2026-11-20T00:00:00.000Z") => ({
  codigoGeneracion: code,
  numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01",
  fecEmi: "2026-10-20",
  selladoEn: "2026-10-21T10:00:00.000Z",
  borradoEl,
  diasRestantes: 21,
  copias: { facta: "none", byos: 0 },
});
const page = (codes: string[], siguiente: string | null, total = codes.length) => ({
  capabilityVersion: 1,
  documentos: codes.map((code) => row(code)),
  total,
  siguiente,
});
const jsonOf = (code: string) => `{"codigoGeneracion":"${code}","ambiente":"00","jws":"jws-${code}"}`;

interface Behavior {
  capability: number | null; // storageConfirmation; null = old server (no field)
  pages: Record<string, unknown>; // cursor ("" = first) -> body
  listStatus: number;
  failDownload: Set<string>;
  failPdf: Set<string>;
  confirmStatus: Record<string, number>; // code -> http status (default 200)
  already: Set<string>;
}

function server(overrides: Partial<Behavior> = {}) {
  const behavior: Behavior = {
    capability: 1,
    pages: { "": page([A, B], "c2", 3), c2: page([C], null, 3) },
    listStatus: 200,
    failDownload: new Set(),
    failPdf: new Set(),
    confirmStatus: {},
    already: new Set(),
    ...overrides,
  };
  const calls: string[] = [];
  const confirmations: Array<{ code: string; body: Record<string, string> }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname.replace("/functions/v1/api-v1", "")}${url.search}`);
    if (url.pathname.endsWith("/v1/status")) {
      return Response.json({
        ok: true, ambiente: "00",
        emisor: { nit: "0614-010101-101-1", nombre: "Issuer", ambiente: "00" },
        llave: { keyId: "facta_test_x", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
      });
    }
    if (url.pathname.endsWith("/v1/storage/status")) {
      return Response.json(behavior.capability === null ? {} : { capabilities: { byosCopyReport: 2, storageConfirmation: behavior.capability } });
    }
    if (url.pathname.endsWith("/v1/storage/unconfirmed")) {
      if (behavior.listStatus !== 200) return Response.json({ error: { code: "forbidden_scope", message: "no" } }, { status: behavior.listStatus });
      return Response.json(behavior.pages[url.searchParams.get("cursor") ?? ""] ?? page([], null, 0));
    }
    const file = /\/v1\/dte\/([^/]+)\/file$/.exec(url.pathname);
    if (file) {
      const code = file[1]!.toUpperCase();
      const kind = url.searchParams.get("kind");
      if (kind === "json" && behavior.failDownload.has(code)) {
        return Response.json({ error: { code: "temporary_copy_expired", message: "gone" } }, { status: 410 });
      }
      if (kind === "pdf" && behavior.failPdf.has(code)) return Response.json({ error: { code: "internal_error", message: "x" } }, { status: 500 });
      return new Response(kind === "pdf" ? new TextEncoder().encode("%PDF-" + code) : new TextEncoder().encode(jsonOf(code)), {
        headers: { "content-type": kind === "pdf" ? "application/pdf" : "application/json" },
      });
    }
    const confirm = /\/v1\/dte\/([^/]+)\/storage-confirmation$/.exec(url.pathname);
    if (confirm && method === "POST") {
      const code = confirm[1]!.toUpperCase();
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      confirmations.push({ code, body });
      const status = behavior.confirmStatus[code] ?? 200;
      if (status === 422) return Response.json({ error: { code: "storage_hash_mismatch", message: "bad hash" } }, { status });
      if (status === 404) return Response.json({ error: { code: "not_found", message: "no" } }, { status });
      return Response.json({
        codigoGeneracion: code, confirmado: true, por: "api_report", yaConfirmado: behavior.already.has(code),
        verificado: false, informado: true, borradoEl: "2026-11-02T00:00:00.000Z",
      });
    }
    throw new Error("unexpected route " + method + " " + url);
  }) as typeof fetch;
  return { fetcher, calls, confirmations, behavior };
}

function client(fetcher: typeof fetch, extra: Record<string, unknown> = {}) {
  return new Facta({ region: false, apiKey: "facta_test_x.secret", fetch: fetcher, maxRetries: 0, ...extra });
}

Deno.test("confirmationBody: where becomes donde, bytes are hashed, bad input is a TypeError", async () => {
  const sha = await sha256OfBytes("hello");
  assertEquals(sha, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assertEquals(await confirmationBody({ where: " disk ", bytes: "hello" }), { donde: "disk", sha256: sha });
  assertEquals(await confirmationBody({ where: "disk", sha256: sha.toUpperCase() }), { donde: "disk", sha256: sha });
  await assertRejects(() => confirmationBody({ where: "", sha256: sha }), TypeError, "where");
  await assertRejects(() => confirmationBody({ where: "x".repeat(201), sha256: sha }), TypeError, "where");
  await assertRejects(() => confirmationBody({ where: "disk", sha256: "abc" }), TypeError, "64 hexadecimal");
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => confirmationBody({ where: "disk" } as any), TypeError, "exactly one");
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => confirmationBody({ where: "disk", sha256: sha, bytes: "x" } as any), TypeError, "exactly one");
});

Deno.test("listUnconfirmedDocuments sends limit and cursor and returns the page", async () => {
  const s = server();
  const result = await client(s.fetcher).listUnconfirmedDocuments({ limit: 2, cursor: "c2" });
  assertEquals(s.calls, ["GET /v1/storage/unconfirmed?limit=2&cursor=c2"]);
  assertEquals(result.documentos.map((d) => d.codigoGeneracion), [C]);
  assertEquals(result.total, 3);
  assertEquals(result.siguiente, null);
  await assertRejects(() => client(s.fetcher).listUnconfirmedDocuments({ limit: 0 }), TypeError);
  await assertRejects(() => client(s.fetcher).listUnconfirmedDocuments({ limit: 101 }), TypeError);
});

Deno.test("listUnconfirmedDocuments: an old server is storage_unsupported, a malformed page storage_contract_invalid", async () => {
  const old = server({ listStatus: 404 });
  const error = await assertRejects(() => client(old.fetcher).listUnconfirmedDocuments(), FactaError);
  assertEquals(error.code, "storage_unsupported");
  const bad = server({ pages: { "": { capabilityVersion: 1, documentos: [{ codigoGeneracion: "no" }], total: 1, siguiente: null } } });
  const invalid = await assertRejects(() => client(bad.fetcher).listUnconfirmedDocuments(), FactaError);
  assertEquals(invalid.code, "storage_contract_invalid");
});

Deno.test("confirmDocumentStorage posts donde and the hash of the bytes", async () => {
  const s = server();
  const facta = client(s.fetcher);
  const answer = await facta.confirmDocumentStorage(A, { where: "disco-contabilidad", bytes: jsonOf(A) });
  assertEquals(answer.por, "api_report");
  assertEquals(answer.informado, true);
  assertEquals(s.confirmations, [{ code: A, body: { donde: "disco-contabilidad", sha256: await sha256OfBytes(jsonOf(A)) } }]);
  await facta.confirmDocumentStorage(B, { where: "disk", sha256: await sha256OfBytes("x") });
  assertEquals(s.calls.filter((call) => call === "GET /v1/storage/status").length, 1, "the capability read is cached");
});

Deno.test("confirmDocumentStorage on a server without the capability throws storage_unsupported and posts nothing", async () => {
  for (const capability of [null, 0]) {
    const s = server({ capability });
    const error = await assertRejects(() => client(s.fetcher).confirmDocumentStorage(A, { where: "disk", bytes: "x" }), FactaError);
    assertEquals(error.code, "storage_unsupported");
    assertEquals(s.confirmations.length, 0);
  }
  const s = server();
  await assertRejects(() => client(s.fetcher).confirmDocumentStorage("not-a-uuid", { where: "disk", bytes: "x" }), TypeError, "UUID");
});

Deno.test("confirmDocumentStorage: a wrong hash and an unknown document keep their server codes; repeating is idempotent", async () => {
  const s = server({ confirmStatus: { [A]: 422, [B]: 404 }, already: new Set([C]) });
  const facta = client(s.fetcher);
  assertEquals((await assertRejects(() => facta.confirmDocumentStorage(A, { where: "disk", bytes: "x" }), FactaError)).code, "storage_hash_mismatch");
  assertEquals((await assertRejects(() => facta.confirmDocumentStorage(B, { where: "disk", bytes: "x" }), FactaError)).code, "not_found");
  assertEquals((await facta.confirmDocumentStorage(C, { where: "disk", bytes: "x" })).yaConfirmado, true);
});

Deno.test("storeAndConfirmUnconfirmed lists every page, stores, and confirms the hash of the stored JSON", async () => {
  const s = server();
  const stored: Array<{ code: string; sha256: string; pdf: boolean }> = [];
  const report = await client(s.fetcher).storeAndConfirmUnconfirmed({
    where: "my-disk",
    store: async (files) => {
      assertEquals(new TextDecoder().decode(files.json), jsonOf(files.codigoGeneracion));
      stored.push({ code: files.codigoGeneracion, sha256: files.sha256, pdf: files.pdf !== null });
    },
  });
  assertEquals(report.stopped, "complete");
  assertEquals([report.listed, report.confirmed, report.failed], [3, 3, 0]);
  assertEquals(report.remaining, 0);
  assertEquals(report.firstDeletionAt, null);
  assertEquals(stored.map((row) => row.code), [A, B, C]);
  assert(stored.every((row) => row.pdf));
  assertEquals(s.confirmations.map((row) => row.body), await Promise.all(stored.map(async (row) => ({ donde: "my-disk", sha256: row.sha256 }))));
  assertEquals(s.calls.filter((call) => call.startsWith("GET /v1/storage/unconfirmed")), [
    "GET /v1/storage/unconfirmed?limit=50",
    "GET /v1/storage/unconfirmed?limit=50&cursor=c2",
  ]);
});

Deno.test("storeAndConfirmUnconfirmed uses the place name store() returns and survives a missing PDF", async () => {
  const s = server({ failPdf: new Set([A]) });
  const report = await client(s.fetcher).storeAndConfirmUnconfirmed({ store: async (files) => `s3://books/${files.codigoGeneracion}` });
  assertEquals(report.confirmed, 3);
  assertEquals(report.results[0]!.pdfMissing, true);
  assertEquals(report.results[1]!.pdfMissing, undefined);
  assertEquals(s.confirmations[0]!.body.donde, `s3://books/${A}`);
});

Deno.test("storeAndConfirmUnconfirmed: a document that fails is reported and skipped, never confirmed", async () => {
  const s = server({ failDownload: new Set([A]), confirmStatus: { [C]: 422 } });
  const report = await client(s.fetcher).storeAndConfirmUnconfirmed({
    store: async (files) => {
      if (files.codigoGeneracion === B) throw new Error("disk full");
    },
  });
  assertEquals(report.stopped, "complete");
  assertEquals([report.confirmed, report.failed], [0, 3]);
  assertEquals(report.results.map((row) => [row.step, row.code]), [
    ["download", "temporary_copy_expired"],
    ["store", "store_failed"],
    ["confirm", "storage_hash_mismatch"],
  ]);
  assertEquals(s.confirmations.map((row) => row.code), [C], "only the document that was stored got a confirmation attempt");
  assertEquals(report.remaining, 3);
  assertEquals(report.firstDeletionAt, "2026-11-20T00:00:00.000Z");
});

Deno.test("storeAndConfirmUnconfirmed stops after maxFailures and at the limit", async () => {
  const s = server({ pages: { "": page([A, B, C], null, 3) } });
  const failing = await client(s.fetcher).storeAndConfirmUnconfirmed({ maxFailures: 2, store: async () => { throw new Error("no"); } });
  assertEquals([failing.stopped, failing.failed, failing.results.length], ["too_many_failures", 2, 2]);

  const limited = await client(server().fetcher).storeAndConfirmUnconfirmed({ limit: 2, store: async () => {} });
  assertEquals([limited.stopped, limited.confirmed, limited.remaining], ["limit", 2, 1]);
  await assertRejects(() => client(s.fetcher).storeAndConfirmUnconfirmed({ limit: 1001, store: async () => {} }), TypeError);
});

Deno.test("storeAndConfirmUnconfirmed: a server without the capability, a list failure and an abort are reports, not throws", async () => {
  const unsupported = await client(server({ capability: 0 }).fetcher).storeAndConfirmUnconfirmed({ store: async () => {} });
  assertEquals([unsupported.stopped, unsupported.error?.code, unsupported.confirmed], ["fatal", "storage_unsupported", 0]);
  assertEquals(unsupported.results.length, 1, "it stops at the first document instead of trying every one");

  const listFailed = await client(server({ listStatus: 403 }).fetcher).storeAndConfirmUnconfirmed({ store: async () => {} });
  assertEquals([listFailed.stopped, listFailed.error?.code], ["list_failed", "forbidden_scope"]);

  const controller = new AbortController();
  const aborted = await client(server().fetcher).storeAndConfirmUnconfirmed({
    signal: controller.signal,
    store: async () => { controller.abort(); },
  });
  assertEquals(aborted.stopped, "aborted");
  assertEquals(aborted.confirmed, 0);
});

// ----- issueAndArchive -------------------------------------------------------------------------

const issuance: IssueResult = {
  estado: "sellado", codigoGeneracion: A, numeroControl: "DTE-01-M001P001-000000000000268", tipoDte: "01", ambiente: "00",
  fecEmi: "2026-10-03", horEmi: "12:00:00", selloRecibido: "seal", fhProcesamiento: null, observaciones: [],
  totales: {} as Totals, documento: {}, jws: "signed-jws", archivoJson: jsonOf(A).replace(`jws-${A}`, "signed-jws"),
  representacionGrafica: btoa("%PDF-test"),
};
const request = { tipoDte: "01" as const, items: [{ descripcion: "Tea", cantidad: 1, precioUni: 1 }] };

async function archived(s: ReturnType<typeof server>, runtime: Record<string, unknown> = {}) {
  const directory = await Deno.makeTempDir();
  const archive = await FileInvoiceArchive.open({ directory, passphrase: "correct horse battery staple 1234" });
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/dte") && init?.method === "POST") return Response.json(issuance);
    if (url.pathname.endsWith(`/v1/dte/${A}`)) return Response.json({ estado: "sellado", codigoGeneracion: A });
    return await s.fetcher(input, init);
  }) as typeof fetch;
  return client(wrapped, { runtime: { version: 1, archive, replicate: false, ...runtime } });
}

Deno.test("issueAndArchive: confirmArchive reports the local archive with the hash of the archived JSON", async () => {
  const s = server();
  const facta = await archived(s, { confirmArchive: true });
  const out = await facta.issueAndArchive(request, { operationId: "op-1", idempotencyKey: "op-1", includeTicket: false });
  assertEquals(out.confirmation?.state, "confirmed");
  assertEquals(out.confirmation?.by, "api_report");
  assertEquals(s.confirmations, [{ code: A, body: { donde: "local-archive", sha256: await sha256OfBytes(issuance.archivoJson!) } }]);
});

Deno.test("issueAndArchive without confirmArchive never confirms and says it is pending, without a warning", async () => {
  const s = server();
  const facta = await archived(s);
  const out = await facta.issueAndArchive(request, { operationId: "op-2", idempotencyKey: "op-2", includeTicket: false });
  assertEquals(s.confirmations.length, 0);
  assertEquals(out.confirmation?.state, "pending");
  assertStringIncludes(out.confirmation?.detail ?? "", "confirmDocumentStorage");
  assertEquals(out.warnings, undefined);
  // The per-call option overrides the runtime default.
  const again = await facta.issueAndArchive(request, { operationId: "op-3", idempotencyKey: "op-3", includeTicket: false, confirmArchive: true });
  assertEquals(again.confirmation?.state, "confirmed");
});

Deno.test("issueAndArchive: a failed confirmation is a typed warning and never fails the sealed document", async () => {
  const s = server({ confirmStatus: { [A]: 422 } });
  const facta = await archived(s, { confirmArchive: true });
  const out = await facta.issueAndArchive(request, { operationId: "op-4", idempotencyKey: "op-4", includeTicket: false });
  assertEquals(out.emission?.estado, "sellado");
  assertEquals(out.confirmation?.state, "failed");
  assertEquals(out.warnings?.map((warning) => warning.code), ["confirmation_failed"]);
});

Deno.test("an old server without the capability: confirmArchive says unsupported, no warning, the document is intact", async () => {
  const s = server({ capability: 0 });
  const facta = await archived(s, { confirmArchive: true });
  const out = await facta.issueAndArchive(request, { operationId: "op-5", idempotencyKey: "op-5", includeTicket: false });
  assertEquals(out.archive.state, "complete");
  assertEquals(out.confirmation?.state, "unsupported");
  assertEquals(out.warnings, undefined);
  assertEquals(s.confirmations.length, 0);
});
