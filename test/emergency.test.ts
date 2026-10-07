import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FileInvoiceArchive } from "../src/file-archive.ts";
import { resetEmergencyStoreWarning, type EmergencyFiles, type EmergencyInfo } from "../src/emergency.ts";
import type { RemoteArtifactDestination } from "../src/archive.ts";

const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const NUMERO = "DTE-01-M001P001-000000000000268";
const RAW = JSON.stringify({ codigoGeneracion: CG, ambiente: "00", jws: "signed-jws" });
const ARCHIVO = JSON.stringify({ identificacion: { numeroControl: NUMERO }, firmaElectronica: "signed-jws", selloRecibido: "seal" });
const PDF = "%PDF-test";
const request = { tipoDte: "01" as const, items: [{ descripcion: "Tea", cantidad: 1, precioUni: 1 }] };

function sealed(extra: Record<string, unknown> = {}, bytes = true): Record<string, unknown> {
  return {
    estado: "sellado", codigoGeneracion: CG, numeroControl: NUMERO, tipoDte: "01", ambiente: "00",
    fecEmi: "2026-10-03", horEmi: "12:00:00", selloRecibido: "seal", fhProcesamiento: null, observaciones: [],
    totales: { totalPagar: 1 }, documento: {}, jws: "signed-jws",
    ...(bytes ? { archivoJson: RAW, archivoDte: ARCHIVO, representacionGrafica: btoa(PDF) } : {}),
    ...extra,
  };
}

function world(answer: Record<string, unknown>) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/file")) {
      const kind = url.searchParams.get("kind");
      const body = kind === "pdf" ? PDF : url.searchParams.get("raw") === "true" ? RAW : ARCHIVO;
      return new Response(body, { status: 200, headers: { "content-type": kind === "pdf" ? "application/pdf" : "application/json" } });
    }
    if (url.pathname.endsWith("/v1/status")) {
      return new Response(JSON.stringify({ ok: true, ambiente: "00", emisor: { ambiente: "00", nit: "06140000000000" }, llave: { keyId: "facta_test_a", alcances: ["issue"], tiposDte: ["01"], venceEl: null } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (init?.method === "POST" && url.pathname.endsWith("/v1/dte")) {
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(answer: Record<string, unknown>, runtime: Record<string, unknown> = {}) {
  const w = world(answer);
  const facta = new Facta({ region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch: w.fetch, runtime: { version: 1, ...runtime } });
  return { facta, ...w };
}

type Call = { files: EmergencyFiles; info: EmergencyInfo };
function recorder() {
  const seen: Call[] = [];
  return { seen, store: (files: EmergencyFiles, info: EmergencyInfo) => { seen.push({ files, info }); return Promise.resolve(); } };
}

Deno.test("a normal issue never calls the emergency store and carries no emergency", async () => {
  const r = recorder();
  const { facta } = client(sealed(), { emergencyStore: r.store });
  const result = await facta.issue(request);
  assertEquals(r.seen.length, 0);
  assertEquals(result.emergency, undefined);
  assertEquals(result.sdkWarnings, undefined);
});

for (const code of ["sin_almacenamiento_duradero", "sin_copia_en_servidor", "copia_solo_temporal", "sin_otra_cosa", "algo_temporal_nuevo"]) {
  Deno.test(`server warning ${code} calls the store once with the response bytes`, async () => {
    const r = recorder();
    const { facta, calls } = client(sealed({ advertencias: [{ codigo: code }] }), { emergencyStore: r.store });
    const result = await facta.issue(request);
    assertEquals(r.seen.length, 1);
    const { files, info } = r.seen[0];
    assertEquals(files.archivoDte, ARCHIVO);
    assertEquals(files.jsonRaw, RAW);
    assertEquals(new TextDecoder().decode(files.pdf!), PDF);
    assertEquals(info.reason, "server_warning");
    assertEquals(info.warnings, [code]);
    assertEquals(info.codigoGeneracion, CG);
    assertEquals(info.numeroControl, NUMERO);
    assertEquals(info.tipoDte, "01");
    assertEquals(info.ambiente, "00");
    assertEquals(info.fecEmi, "2026-10-03");
    assert(!Number.isNaN(Date.parse(info.occurredAt)));
    assertEquals(result.emergency?.saved, true);
    assertEquals(result.sdkWarnings?.[0].code, "emergency_saved");
    assertEquals(calls.filter((c) => c.includes("/file")).length, 0, "no download when the response has the bytes");
    assertEquals(result.jws, "signed-jws", "the sealed result is intact");
  });
}

Deno.test("a response without bytes is completed from holding", async () => {
  const r = recorder();
  const { facta, calls } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }, false), { emergencyStore: r.store });
  const result = await facta.issue(request);
  assertEquals(r.seen.length, 1);
  assertEquals(r.seen[0].files.jsonRaw, RAW);
  assertEquals(r.seen[0].files.archivoDte, ARCHIVO);
  assertEquals(new TextDecoder().decode(r.seen[0].files.pdf!), PDF);
  assertEquals(calls.filter((c) => c.includes("/file")).length, 3);
  assertEquals(result.emergency?.saved, true);
});

Deno.test("when holding is gone too, the store still gets what exists and the JWS-built original", async () => {
  const r = recorder();
  const w = new Facta({
    region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/file")) return new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404, headers: { "content-type": "application/json" } });
      void init;
      return new Response(JSON.stringify(sealed({ advertencias: ["sin_copia_en_servidor"] }, false)), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch,
    runtime: { version: 1, emergencyStore: r.store },
  });
  const result = await w.issue(request);
  assertEquals(r.seen.length, 1);
  assertEquals(JSON.parse(r.seen[0].files.jsonRaw).jws, "signed-jws");
  assertEquals(r.seen[0].files.pdf, null);
  assertEquals(result.emergency?.saved, true);
});

Deno.test("a document is handed over once per emergency even if the result is processed again", async () => {
  const r = recorder();
  const { facta } = client(sealed({ advertencias: ["copia_solo_temporal"] }), { emergencyStore: r.store });
  await facta.issue(request, { idempotencyKey: "k1" });
  await facta.issue(request, { idempotencyKey: "k1" });
  assertEquals(r.seen.length, 1);
});

Deno.test("not configured: the result says so, with a warning, and keeps the files", async () => {
  const { facta } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }));
  const result = await facta.issue(request);
  assertEquals(result.emergency?.saved, false);
  assertEquals(result.emergency?.reason, "not_configured");
  assertEquals(result.sdkWarnings?.[0].code, "emergency_failed");
  assertStringIncludes(result.sdkWarnings![0].detail, "runtime.emergencyStore");
  assertEquals((result as { archivoJson?: string }).archivoJson, RAW);
});

Deno.test("a throwing store never breaks the issue", async () => {
  const { facta } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }), {
    emergencyStore: () => Promise.reject(new Error("disk full")),
  });
  const result = await facta.issue(request);
  assertEquals(result.estado, "sellado");
  assertEquals(result.emergency?.saved, false);
  assertEquals(result.emergency?.reason, "store_failed");
  assertStringIncludes(result.emergency!.detail, "NOW");
  assertEquals(result.sdkWarnings?.[0].code, "emergency_failed");
});

Deno.test("onEmergency fires with the info and report; a throwing alert is harmless", async () => {
  const events: string[] = [];
  const r = recorder();
  const { facta } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }), {
    emergencyStore: r.store,
    onEmergency: (e: { info: EmergencyInfo; report: { saved: boolean } }) => { events.push(`${e.info.codigoGeneracion}:${e.report.saved}`); throw new Error("pager down"); },
  });
  const result = await facta.issue(request);
  assertEquals(events, [`${CG}:true`]);
  assertEquals(result.emergency?.saved, true);
});

Deno.test("the constructor warns once, and diagnose reports emergency_store_missing", async () => {
  resetEmergencyStoreWarning();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const status = {
      ok: true, ambiente: "00", emisor: { ambiente: "00", nit: "1" },
      llave: { keyId: "facta_test_a", alcances: ["issue", "query", "download"], tiposDte: ["01"], venceEl: null },
      limites: { hora: { limit: 20, used: 2, remaining: 18 }, dia: { limit: 100, used: 2, remaining: 98 }, estado: { limit: 240, used: 2, remaining: 238 }, montoMaximoPorDocumentoCentavos: 10000000 },
    };
    const make = (runtime: Record<string, unknown>) => new Facta({
      region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", runtime: { version: 1, ...runtime },
      fetch: (async () => new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } })) as typeof globalThis.fetch,
    });
    const first = make({});
    make({});
    assertEquals(warnings.length, 1);
    assertStringIncludes(warnings[0], "runtime.emergencyStore");
    const report = await first.diagnose();
    const check = report.checks.find((c) => c.id === "emergency_store_missing");
    assertEquals(check?.state, "warning");
    assertStringIncludes(check!.message, "copia temporal de 1 hora");
    const configured = await make({ emergencyStore: () => Promise.resolve() }).diagnose();
    assertEquals(configured.checks.some((c) => c.id === "emergency_store_missing"), false);
  } finally {
    console.warn = original;
  }
});

async function archiveFixture() {
  const dir = await Deno.makeTempDir();
  const archive = await FileInvoiceArchive.open({ directory: dir, passphrase: "correct horse battery staple 1234" });
  return { archive, dir };
}

const destination = (id: string, state: "stored" | "failed"): RemoteArtifactDestination => ({
  id, kind: "custom", label: id, write: () => Promise.resolve(state),
});

Deno.test("every replication destination failing triggers the store once", async () => {
  const { archive, dir } = await archiveFixture();
  try {
    const r = recorder();
    const { facta } = client(sealed(), { archive, emergencyStore: r.store });
    const result = await facta.issueAndArchive(request, {
      operationId: "op-1", idempotencyKey: "k-1", includeTicket: false,
      remoteDestinations: [destination("a", "failed"), destination("b", "failed")],
    });
    assertEquals(r.seen.length, 1);
    assertEquals(r.seen[0].info.reason, "all_destinations_failed");
    assertEquals(result.emergency?.saved, true);
    assertEquals(result.warnings?.some((w) => w.code === "emergency_saved"), true);
    assertEquals(result.emission?.estado, "sellado");
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("one destination storing the copy is not an emergency", async () => {
  const { archive, dir } = await archiveFixture();
  try {
    const r = recorder();
    const { facta } = client(sealed(), { archive, emergencyStore: r.store });
    const result = await facta.issueAndArchive(request, {
      operationId: "op-2", idempotencyKey: "k-2", includeTicket: false,
      remoteDestinations: [destination("a", "failed"), destination("b", "stored")],
    });
    assertEquals(r.seen.length, 0);
    assertEquals(result.emergency, undefined);
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("no destination at all, with an incomplete archive and a storage receipt saying nothing is stored", async () => {
  const { archive, dir } = await archiveFixture();
  try {
    const r = recorder();
    const art = { state: "not_configured", sha256: null, bytes: null, storedAt: null, errorCode: null, retryable: false };
    const receipt = { destination: "none", environment: "00", operationId: CG, json: art, pdf: art };
    const { facta } = client(sealed({ storage: receipt, archivoJson: "{not json", archivoDte: undefined }), { archive, emergencyStore: r.store });
    const result = await facta.issueAndArchive(request, { operationId: "op-3", idempotencyKey: "k-3", includeTicket: false });
    assertEquals(result.archive.state, "needs_attention");
    assertEquals(r.seen.length, 1);
    assertEquals(r.seen[0].info.reason, "no_destination");
    assertEquals(result.emission?.estado, "sellado");
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("a server warning on issueAndArchive calls the store and the archive result carries it", async () => {
  const { archive, dir } = await archiveFixture();
  try {
    const r = recorder();
    const { facta } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }), { archive, emergencyStore: r.store });
    const result = await facta.issueAndArchive(request, { operationId: "op-4", idempotencyKey: "k-4", includeTicket: false });
    assertEquals(r.seen.length, 1);
    assertEquals(result.emergency?.saved, true);
    assertEquals(result.emission?.emergency?.saved, true);
    assertEquals(result.archive.state, "complete");
  } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test("emergency.replicate re-tries normal replication from the files you kept", async () => {
  const written: string[] = [];
  const dest: RemoteArtifactDestination = {
    id: "d", kind: "custom", label: "d",
    write: (artifact) => { written.push(artifact.kind); return Promise.resolve("stored"); },
  };
  const bad = destination("bad", "failed");
  const { facta } = client(sealed(), { remoteDestinations: [dest, bad] });
  const out = await facta.emergency.replicate({ jsonRaw: RAW, pdf: new TextEncoder().encode(PDF) }, { codigoGeneracion: CG, numeroControl: NUMERO, fecEmi: "2026-10-03" });
  assertEquals(out.stored, ["d"]);
  assertEquals(out.failed, ["bad"]);
  assertEquals(written, ["json", "pdf"]);
});

Deno.test("the safeguard sends bytes nowhere but the configured function", async () => {
  const r = recorder();
  const { facta, calls } = client(sealed({ advertencias: ["sin_almacenamiento_duradero"] }), { emergencyStore: r.store });
  await facta.issue(request);
  assert(calls.every((c) => c.includes("/v1/dte") || c.includes("/v1/status")), calls.join(", "));
});
