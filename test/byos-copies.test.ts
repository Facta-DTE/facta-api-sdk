import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FileInvoiceArchive } from "../src/file-archive.ts";
import { canonicalArchivePath, readDocumentIdentity } from "../src/byos-copies.ts";
import type { RemoteArtifactDestination } from "../src/archive.ts";
import type { IssueResult, Totals } from "../src/types.ts";

const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const NUMERO = "DTE-01-M001P001-000000000000268";
const legalJson = JSON.stringify({
  identificacion: { numeroControl: NUMERO, fecEmi: "2026-10-03", codigoGeneracion: CG },
  codigoGeneracion: CG,
  ambiente: "00",
  jws: "signed-jws",
});
const issuance: IssueResult = {
  estado: "sellado",
  codigoGeneracion: CG,
  numeroControl: NUMERO,
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-03",
  horEmi: "12:00:00",
  selloRecibido: "seal",
  fhProcesamiento: null,
  observaciones: [],
  totales: {} as Totals,
  documento: {},
  jws: "signed-jws",
  archivoJson: legalJson,
  representacionGrafica: btoa("%PDF-test"),
};
const request = { tipoDte: "01" as const, items: [{ descripcion: "Tea", cantidad: 1, precioUni: 1 }] };

interface World {
  fetch: typeof fetch;
  bucket: Map<string, Uint8Array>;
  reports: Array<Record<string, unknown>>;
  counts: { putAttempts: number; storageStatus: number };
  behave: { capability: boolean; reportStatus: number; putStatus: number };
}

function world(): World {
  const bucket = new Map<string, Uint8Array>();
  const reports: Array<Record<string, unknown>> = [];
  const counts = { putAttempts: 0, storageStatus: 0 };
  const behave = { capability: true, reportStatus: 200, putStatus: 200 };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "bucket.s3.us-east-1.amazonaws.com") {
      const key = decodeURIComponent(url.pathname.slice(1));
      if (init?.method === "PUT") {
        counts.putAttempts++;
        if (behave.putStatus !== 200) return new Response("denied", { status: behave.putStatus });
        bucket.set(key, new Uint8Array(init.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      const bytes = bucket.get(key);
      return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
    }
    if (url.pathname.endsWith("/v1/status")) {
      return Response.json({
        ok: true,
        ambiente: "00",
        emisor: { nit: "0614-010101-101-1", nombre: "Issuer", ambiente: "00" },
        llave: { keyId: "facta_test_x", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
      });
    }
    if (url.pathname.endsWith("/v1/storage/status")) {
      counts.storageStatus++;
      return Response.json(behave.capability ? { capabilities: { byosCopyReport: 1 } } : {});
    }
    if (url.pathname.endsWith("/v1/dte")) return Response.json(issuance);
    if (url.pathname.endsWith(`/v1/dte/${CG}`)) return Response.json({ estado: "sellado", codigoGeneracion: CG });
    if (url.pathname.endsWith(`/v1/storage/copies/${CG}/byos`)) {
      if (behave.reportStatus !== 200) {
        return Response.json({ error: { code: "forbidden_scope", message: "no" } }, { status: behave.reportStatus });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      reports.push(body);
      return Response.json({ codigoGeneracion: CG, copy: { secretId: body.secretId, recorded: true, verified: true, writtenBy: "sdk" } });
    }
    throw new Error("unexpected route " + url);
  }) as typeof fetch;
  return { fetch: fetcher, bucket, reports, counts, behave };
}

const S3_SECRET = JSON.stringify({ bucket: "bucket", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret" });
const SNAPSHOT = {
  version: 1,
  destinos: [{ id: "11111111-1111-4111-8111-111111111111", kind: "s3", label: "Accounting bucket", secret: S3_SECRET }],
};

async function setup(w: World, snapshot: unknown = SNAPSHOT, runtime: Record<string, unknown> = {}) {
  const directory = await Deno.makeTempDir();
  const archive = await FileInvoiceArchive.open({ directory, passphrase: "correct horse battery staple 1234" });
  const facta = new Facta({
    apiKey: "facta_test_x.secret",
    unlockKey: "factauk_test",
    fetch: w.fetch,
    maxRetries: 0,
    runtime: { version: 1, archive, ...runtime },
  });
  let snapshotCalls = 0;
  facta.syncDestinations = async () => {
    snapshotCalls++;
    if (snapshot instanceof Error) throw snapshot;
    return snapshot as never;
  };
  return { facta, archive, directory, snapshotCalls: () => snapshotCalls };
}

const JSON_PATH = `DTE/pruebas/2026/10/${NUMERO}.json`;
const PDF_PATH = `DTE/pruebas/2026/10/${NUMERO}.pdf`;
const opts = (id: string) => ({ operationId: id, idempotencyKey: id, includeTicket: false });

Deno.test("canonical paths follow the app's archive layout for both environments", () => {
  const identity = { numeroControl: NUMERO, fecEmi: "2026-10-03" };
  assertEquals(canonicalArchivePath("00", identity, "json"), JSON_PATH);
  assertEquals(canonicalArchivePath("01", identity, "pdf"), `DTE/2026/10/${NUMERO}.pdf`);
  assertEquals(readDocumentIdentity(new TextEncoder().encode(legalJson)), identity);
});

Deno.test("synced destinations are the default: canonical paths, then one report per destination", async () => {
  const w = world();
  const { facta } = await setup(w);
  const result = await facta.issueAndArchive(request, opts("sale-default"));
  assertEquals(result.emission?.estado, "sellado");
  assertEquals(result.warnings, undefined);
  assertEquals([...w.bucket.keys()].sort(), [JSON_PATH, PDF_PATH]);
  assertEquals(result.archive.remoteCopies?.map((row) => row.kind).sort(), ["json", "pdf"], "jws and ticket never go to the app's tree");
  assertEquals(w.reports, [{
    secretId: SNAPSHOT.destinos[0]!.id,
    jsonPath: JSON_PATH,
    pdfPath: PDF_PATH,
    verified: true,
    pdfRegenerated: false,
  }]);
  assertEquals(result.archive.remoteCopies?.find((row) => row.kind === "json")?.report, "reported");
  assertEquals((await facta.listPendingOperations()).length, 0);
});

Deno.test("replicate:false opts out: no snapshot read, no write, no report", async () => {
  const w = world();
  const { facta, snapshotCalls } = await setup(w);
  const result = await facta.issueAndArchive(request, { ...opts("sale-optout"), replicate: false });
  assertEquals(result.archive.state, "complete");
  assertEquals(result.archive.remoteCopies, undefined);
  assertEquals(result.warnings, undefined);
  assertEquals(snapshotCalls(), 0);
  assertEquals(w.bucket.size, 0);
  assertEquals(w.reports.length, 0);
  assertEquals(w.counts.storageStatus, 0);

  const runtimeOff = await setup(world(), SNAPSHOT, { replicate: false });
  const again = await runtimeOff.facta.issueAndArchive(request, opts("sale-runtime-optout"));
  assertEquals(again.archive.remoteCopies, undefined);
  assertEquals(runtimeOff.snapshotCalls(), 0);
});

Deno.test("explicit remoteDestinations replace the synced default", async () => {
  const w = world();
  const writes: string[] = [];
  const mine: RemoteArtifactDestination = {
    id: "mine", kind: "custom", label: "Mine",
    write: async (artifact) => { writes.push(artifact.kind); return "stored"; },
  };
  const { facta, snapshotCalls } = await setup(w);
  const result = await facta.issueAndArchive(request, { ...opts("sale-explicit"), remoteDestinations: [mine] });
  assertEquals(result.warnings, undefined);
  assertEquals(writes.sort(), ["json", "jws", "pdf"]);
  assertEquals(snapshotCalls(), 0);
  assertEquals(w.reports.length, 0, "a destination without canonicalCopy is never reported");
});

Deno.test("a server that does not advertise byosCopyReport gets no report, no warning, one status read", async () => {
  const w = world();
  w.behave.capability = false;
  const { facta } = await setup(w);
  const first = await facta.issueAndArchive(request, opts("sale-old-server-1"));
  const second = await facta.issueAndArchive(request, opts("sale-old-server-2"));
  for (const result of [first, second]) {
    assertEquals(result.warnings, undefined);
    assertEquals(result.archive.state, "complete");
  }
  assertEquals(w.reports.length, 0);
  assertEquals(w.counts.storageStatus, 1, "the capability read is cached per client");
  assert(w.bucket.has(JSON_PATH), "the BYOS copy itself is still written");
});

Deno.test("a failed report is a typed warning, keeps the operation pending, and recoverOperation retries only the report", async () => {
  const w = world();
  w.behave.reportStatus = 403;
  const { facta } = await setup(w);
  const result = await facta.issueAndArchive(request, opts("sale-report-fails"));
  assertEquals(result.emission?.estado, "sellado");
  assertEquals(result.archive.state, "complete");
  assertEquals(result.warnings?.map((warning) => warning.code), ["copy_report_failed"]);
  assertStringIncludes(result.warnings![0]!.detail, "forbidden_scope");
  assertEquals((await facta.listPendingOperations()).map((row) => row.id), ["sale-report-fails"]);
  const puts = w.counts.putAttempts;

  w.behave.reportStatus = 200;
  const recovered = await facta.recoverOperation("sale-report-fails");
  assertEquals(recovered.warnings, undefined);
  assertEquals(w.reports.length, 1);
  assertEquals(w.counts.putAttempts, puts, "stored bytes are not rewritten");
  assertEquals((await facta.listPendingOperations()).length, 0);
});

Deno.test("a replication failure never fails a sealed document and is not reported", async () => {
  const w = world();
  w.behave.putStatus = 500;
  const { facta } = await setup(w);
  const result = await facta.issueAndArchive(request, opts("sale-put-fails"));
  assertEquals(result.emission?.estado, "sellado");
  assertEquals(result.archive.state, "complete");
  assertEquals(result.warnings?.map((warning) => warning.code), ["byos_not_replicated"]);
  assertEquals(w.reports.length, 0);
  assertEquals((await facta.listPendingOperations()).length, 1);

  w.behave.putStatus = 200;
  const recovered = await facta.recoverOperation("sale-put-fails");
  assertEquals(recovered.warnings, undefined);
  assert(w.bucket.has(JSON_PATH) && w.bucket.has(PDF_PATH));
  assertEquals(w.reports.length, 1);
});

Deno.test("an unreadable snapshot or an unsupported destination kind only warns", async () => {
  const broken = await setup(world(), new Error("vault unreachable"));
  const one = await broken.facta.issueAndArchive(request, opts("sale-snapshot-fails"));
  assertEquals(one.emission?.estado, "sellado");
  assertEquals(one.warnings?.map((warning) => warning.code), ["byos_not_replicated"]);
  assert(!JSON.stringify(one.warnings).includes("vault unreachable"));

  const w = world();
  const mixed = await setup(w, {
    version: 1,
    destinos: [...SNAPSHOT.destinos, { id: "22222222-2222-4222-8222-222222222222", kind: "gdrive", label: "Drive", secret: "{}" }],
  });
  const two = await mixed.facta.issueAndArchive(request, opts("sale-mixed"));
  assertEquals(two.warnings?.map((warning) => [warning.code, warning.destinationId]), [["byos_not_replicated", "22222222-2222-4222-8222-222222222222"]]);
  assertEquals(w.reports.length, 1, "the usable destination is still written and reported");
});

Deno.test("no unlock key or no published snapshot means no replication and no warning", async () => {
  const w = world();
  const none = await setup(w, { version: 1, destinos: [] });
  const result = await none.facta.issueAndArchive(request, opts("sale-empty-snapshot"));
  assertEquals(result.warnings, undefined);
  assertEquals(result.archive.remoteCopies, undefined);

  const archive = await FileInvoiceArchive.open({ directory: await Deno.makeTempDir(), passphrase: "correct horse battery staple 1234" });
  const noKey = new Facta({ apiKey: "facta_test_x.secret", fetch: w.fetch, runtime: { version: 1, archive } });
  const plain = await noKey.issueAndArchive(request, opts("sale-no-unlock"));
  assertEquals(plain.warnings, undefined);
  assertEquals(w.bucket.size, 0);
});

Deno.test("issue() itself never writes storage or reports", async () => {
  const w = world();
  const { facta, snapshotCalls } = await setup(w);
  const sealed = await facta.issue(request);
  assertEquals(sealed.estado, "sellado");
  assertEquals(snapshotCalls(), 0);
  assertEquals(w.bucket.size, 0);
  assertEquals(w.reports.length, 0);
});
