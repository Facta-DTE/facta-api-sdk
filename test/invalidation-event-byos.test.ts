// The invalidation event is written to the customer's own (BYOS) destinations at
// exactly `archivoEvento.ruta` and reported to Facta with `kind: "invalidation"`.
// A failed write or report is data on the result, never a failed invalidation.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import type { CompleteInvalidationResult, InvalidationRequest } from "../mod.ts";

const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const EVENT = "BEB08A1C-1722-4E35-AEA6-52AB1234CDEF";
const PERSON = { nombre: "A", tipoDocumento: "36", numDocumento: "06142803901121" };
const REQUEST: InvalidationRequest = { tipoAnulacion: 2, responsable: PERSON, solicita: PERSON };
const RUTA = `DTE/pruebas/2026/10/${CG}.invalidacion.json`;
const CONTENT = '{\n  "firmaElectronica": "jws",\n  "selloRecibido": "SEAL"\n}';
const DEST_ID = "11111111-1111-4111-8111-111111111111";
const S3_SECRET = JSON.stringify({ bucket: "bucket", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret" });
const SNAPSHOT = { version: 1, destinos: [{ id: DEST_ID, kind: "s3", label: "Accounting bucket", secret: S3_SECRET }] };

interface Behave { capability: "v2" | "v1" | "kinds" | "none"; putStatus: number; reportStatus: number; archivoEvento: boolean }

function world(partial: Partial<Behave> = {}) {
  const behave: Behave = { capability: "v2", putStatus: 200, reportStatus: 200, archivoEvento: true, ...partial };
  const bucket = new Map<string, Uint8Array>();
  const reports: Array<Record<string, unknown>> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "bucket.s3.us-east-1.amazonaws.com") {
      if (init?.method === "PUT") {
        if (behave.putStatus !== 200) return new Response("denied", { status: behave.putStatus });
        bucket.set(decodeURIComponent(url.pathname.slice(1)), new Uint8Array(init.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      const bytes = bucket.get(decodeURIComponent(url.pathname.slice(1)));
      return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
    }
    if (url.pathname.endsWith("/v1/storage/status")) {
      const body = behave.capability === "v2" ? { capabilities: { byosCopyReport: 2 }, supportedKinds: ["json", "pdf", "invalidation"] }
        : behave.capability === "v1" ? { capabilities: { byosCopyReport: 1 }, supportedKinds: ["json", "pdf"] }
        : behave.capability === "kinds" ? { capabilities: { byosCopyReport: 1 }, supportedKinds: ["json", "pdf", "invalidation"] }
        : {};
      return Response.json(body);
    }
    if (url.pathname.endsWith(`/v1/dte/${CG}/invalidate`)) {
      return Response.json({
        estado: "invalidado", codigoGeneracion: CG, numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: "00",
        evento: { codigoGeneracion: EVENT, selloRecibido: "SEAL", tipoAnulacion: 2 },
        documento: {}, jws: "signed-event-jws", anotadoEnElIndice: true,
        archivoEvento: behave.archivoEvento ? { nombre: `${CG}.invalidacion.json`, ruta: RUTA, contenido: CONTENT } : null,
        storage: { destination: "managed", environment: "00", operationId: CG,
          invalidation: { state: "stored", sha256: null, bytes: 10, storedAt: null, errorCode: null, retryable: false } },
        avisoCliente: { estado: "no_enviado", destino: null, motivo: "sin_correo" },
      });
    }
    if (url.pathname.endsWith(`/v1/storage/copies/${CG}/byos`)) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      reports.push(body);
      if (behave.reportStatus !== 200) {
        return Response.json({ error: { code: "invalid_request", message: "no", details: { field: "secretId" } } }, { status: behave.reportStatus });
      }
      return Response.json({ codigoGeneracion: CG, copy: { secretId: body.secretId, kind: "invalidation", recorded: true, verified: false, writtenBy: "sdk" } });
    }
    throw new Error("unexpected route " + url);
  }) as typeof fetch;
  return { fetch: fetcher, bucket, reports, behave };
}

function client(w: ReturnType<typeof world>, extra: Record<string, unknown> = {}, snapshot: unknown = SNAPSHOT) {
  const facta = new Facta({
    region: false, apiKey: "facta_test_x.secret", signKey: `factask_${"A".repeat(43)}`, unlockKey: "factauk_test",
    fetch: w.fetch, maxRetries: 0, ...extra,
  });
  facta.syncDestinations = async () => {
    if (snapshot instanceof Error) throw snapshot;
    return snapshot as never;
  };
  return facta;
}

async function run(facta: Facta): Promise<CompleteInvalidationResult> {
  const result = await facta.invalidate(CG, REQUEST);
  if (!("jws" in result)) throw new Error("expected a complete invalidation");
  return result;
}

Deno.test("the event is written at archivoEvento.ruta and reported with kind invalidation", async () => {
  const w = world();
  const result = await run(client(w));
  assertEquals([...w.bucket.keys()], [RUTA]);
  assertEquals(new TextDecoder().decode(w.bucket.get(RUTA)), CONTENT);
  assertEquals(w.reports, [{ kind: "invalidation", secretId: DEST_ID, jsonPath: RUTA }]);
  assertEquals(result.eventCopies, [{ destinationId: DEST_ID, label: "Accounting bucket", state: "stored", report: "reported" }]);
  assertEquals(result.sdkWarnings, undefined);
  assertEquals(result.storage?.invalidation.state, "stored");
});

Deno.test("an older server: the file is still written, the report is skipped", async () => {
  for (const capability of ["v1", "none"] as const) {
    const w = world({ capability });
    const result = await run(client(w));
    assertEquals([...w.bucket.keys()], [RUTA]);
    assertEquals(w.reports, []);
    assertEquals(result.eventCopies?.[0]?.state, "stored");
    assertEquals(result.eventCopies?.[0]?.report, "skipped");
    assertEquals(result.sdkWarnings, undefined);
  }
});

Deno.test("supportedKinds listing invalidation is enough to report", async () => {
  const w = world({ capability: "kinds" });
  const result = await run(client(w));
  assertEquals(w.reports.length, 1);
  assertEquals(result.eventCopies?.[0]?.report, "reported");
});

Deno.test("a failed BYOS write is data on the result, not a failed invalidation", async () => {
  const w = world({ putStatus: 403 });
  const result = await run(client(w));
  assertEquals(result.estado, "invalidado");
  assertEquals(result.eventCopies?.[0]?.state, "failed");
  assertEquals(result.eventCopies?.[0]?.report, "skipped");
  assertEquals(w.reports, []);
  assertEquals(result.sdkWarnings?.[0]?.code, "byos_not_replicated");
  assertEquals(result.sdkWarnings?.[0]?.destinationId, DEST_ID);
});

Deno.test("a refused report keeps the stored file and warns", async () => {
  for (const status of [400, 404, 422]) {
    const w = world({ reportStatus: status });
    const result = await run(client(w));
    assertEquals(result.estado, "invalidado");
    assertEquals(result.eventCopies?.[0]?.state, "stored");
    assertEquals(result.eventCopies?.[0]?.report, "failed");
    assertEquals(result.sdkWarnings?.[0]?.code, "copy_report_failed");
  }
});

Deno.test("nothing is attempted without an unlock key, with replicate false, or with no file", async () => {
  const w1 = world();
  const noKey = new Facta({ region: false, apiKey: "facta_test_x.secret", signKey: `factask_${"A".repeat(43)}`, fetch: w1.fetch, maxRetries: 0 });
  const r1 = await run(noKey);
  assertEquals([r1.eventCopies, r1.sdkWarnings, w1.bucket.size], [undefined, undefined, 0]);

  const w2 = world();
  const r2 = await run(client(w2, { runtime: { version: 1, replicate: false } }));
  assertEquals([r2.eventCopies, w2.bucket.size], [undefined, 0]);

  const w3 = world({ archivoEvento: false });
  const r3 = await run(client(w3));
  assertEquals([r3.eventCopies, w3.bucket.size], [undefined, 0]);
});

Deno.test("no synced destination is silent; an unreadable snapshot warns", async () => {
  const w = world();
  const none = await run(client(w, {}, { version: 1, destinos: [] }));
  assertEquals([none.eventCopies, none.sdkWarnings], [undefined, undefined]);
  const broken = await run(client(w, {}, new Error("vault down")));
  assertEquals(broken.estado, "invalidado");
  assertEquals(broken.sdkWarnings?.[0]?.code, "byos_not_replicated");
});

Deno.test("invalidateAndArchive also writes and carries the copies", async () => {
  const w = world();
  const { FileInvoiceArchive } = await import("../src/file-archive.ts");
  const archive = await FileInvoiceArchive.open({ directory: await Deno.makeTempDir(), passphrase: "correct horse battery staple 1234" });
  const facta = client(w);
  facta.status = () => Promise.resolve({
    ok: true, ambiente: "00", emisor: { nit: "0614-010101-101-1", nombre: "I", ambiente: "00" },
    llave: { keyId: "facta_test_x", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
  } as never);
  const out = await facta.invalidateAndArchive(CG, REQUEST, { archive, operationId: "inv-1", idempotencyKey: "inv-1" });
  assertEquals(out.archive.state, "complete");
  const inv = out.invalidation as CompleteInvalidationResult;
  assert(inv.eventCopies?.[0]?.report === "reported");
});

Deno.test("downloadDocument(kind invalidation) asks for the managed copy", async () => {
  const urls: string[] = [];
  const fetch = ((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(new Response(CONTENT, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Facta-Storage-Source": "managed", "Content-Disposition": `attachment; filename="${CG}.invalidacion.json"` },
    }));
  }) as unknown as typeof globalThis.fetch;
  const facta = new Facta({ region: false, apiKey: "facta_test_x.secret", fetch, maxRetries: 0 });
  const file = await facta.downloadDocument(CG, "invalidation").catch((e) => e);
  assert(urls[0]?.includes("kind=invalidation") && urls[0].includes("source=managed"), urls[0]);
  void file;
});

Deno.test("getStorageStatus accepts a server that also lists invalidation and byosCopyReport 2", async () => {
  const body = {
    capabilityVersion: 1,
    managed: { configured: true, ready: true, state: "ready", integration: "ready", quotaBytes: 5000, usedBytes: 1200, reservedBytes: 0, usedBytesTotal: 1, reservedBytesTotal: 1, coveredUntil: null, accessUntil: null, bucketState: "ready", backupState: null },
    byos: { ready: true },
    supportedKinds: ["json", "pdf", "invalidation"],
    unsupportedKinds: ["ticket"],
    capabilities: { byosCopyReport: 2 },
  };
  const fetch = (() => Promise.resolve(Response.json(body))) as unknown as typeof globalThis.fetch;
  const facta = new Facta({ region: false, apiKey: "facta_test_x.secret", fetch, maxRetries: 0 });
  const status = await facta.getStorageStatus();
  assertEquals(status.supportedKinds, ["json", "pdf", "invalidation"]);
  assertEquals(status.capabilities?.byosCopyReport, 2);
});
