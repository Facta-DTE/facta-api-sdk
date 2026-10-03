import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import { FileInvoiceArchive } from "../src/file-archive.ts";
import type {
  ArchiveArtifact,
  ArchiveOperation,
  InvalidationArchive,
  InvalidationOperation,
  InvoiceArchive,
  RemoteCopyRecord,
} from "../src/archive.ts";
import type { InvalidationResult, IssueResult, Totals } from "../src/types.ts";

const issuance: IssueResult = {
  estado: "sellado",
  codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-03-M001P001-000000000000175",
  tipoDte: "03",
  ambiente: "00",
  fecEmi: "2026-09-30",
  horEmi: "12:00:00",
  selloRecibido: "seal",
  fhProcesamiento: null,
  observaciones: [],
  totales: {} as Totals,
  documento: {},
  jws: "signed-jws",
  archivoJson: '{"codigoGeneracion":"7875BC7A-9580-441D-94E4-FA455E9D8BD0","ambiente":"00","jws":"signed-jws"}',
  representacionGrafica: btoa("%PDF-test"),
};
const request = {
  tipoDte: "03" as const,
  items: [{ descripcion: "Tea", cantidad: 1, precioUni: 1 }],
};
const IDENTITY_X = {
  version: 1 as const,
  endpoint: "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1",
  keyId: "facta_test_x",
  issuerNit: "0614-010101-101-1",
  environment: "00" as const,
};
const IDENTITY_A = { ...IDENTITY_X, keyId: "facta_test_a" };

class MemoryArchive implements InvoiceArchive {
  operation: ArchiveOperation | null = null;
  artifacts: ArchiveArtifact[] = [];
  ready = true;
  async assertReady() {
    if (!this.ready) throw new Error("archive unavailable");
  }
  async begin(value: ArchiveOperation) {
    if (this.operation && this.operation.id !== value.id) {
      throw new Error("operation conflict");
    }
    if (this.operation) {
      if (
        this.operation.idempotencyKey !== value.idempotencyKey ||
        this.operation.requestSha256 !== value.requestSha256
      ) {
        throw new Error("operation conflict");
      }
      return false;
    }
    this.operation = value;
    return true;
  }
  async find(id: string) {
    return this.operation?.id === id ? this.operation : null;
  }
  async pending() {
    return this.operation && (this.operation.state !== "complete" || this.operation.remoteCopies?.some((copy) => copy.state !== "stored"))
      ? [this.operation]
      : [];
  }
  async markIssued(id: string, result: IssueResult) {
    if (!this.operation || this.operation.id !== id) {
      throw new Error("missing operation");
    }
    this.operation = {
      ...this.operation,
      state: "issued",
      codigoGeneracion: result.codigoGeneracion,
    };
  }
  async saveArtifact(value: ArchiveArtifact) {
    this.artifacts.push(value);
  }
  async getArtifact(code: string, kind: "json" | "pdf" | "jws" | "ticket") {
    return this.artifacts.find((row) =>
      row.codigoGeneracion === code && row.kind === kind
    ) ?? null;
  }
  async finish(id: string) {
    if (!this.operation || this.operation.id !== id) {
      throw new Error("missing operation");
    }
    this.operation = { ...this.operation, state: "complete" };
  }
  async markNeedsAttention(id: string, detail: string) {
    if (!this.operation || this.operation.id !== id) {
      throw new Error("missing operation");
    }
    this.operation = { ...this.operation, state: "needs_attention", detail };
  }
  async recordRemoteCopy(id: string, record: RemoteCopyRecord) {
    if (!this.operation || this.operation.id !== id) throw new Error("missing operation");
    const rows = this.operation.remoteCopies ?? [];
    this.operation = {
      ...this.operation,
      remoteCopies: [
        ...rows.filter((row) => !(row.destinationId === record.destinationId && row.kind === record.kind)),
        record,
      ],
    };
  }
}

class MemoryInvalidationArchive extends MemoryArchive implements InvalidationArchive {
  invalidations = new Map<string, InvalidationOperation>();
  async beginInvalidation(operation: InvalidationOperation) {
    const current = this.invalidations.get(operation.id);
    if (current) {
      if (current.requestSha256 !== operation.requestSha256 || current.idempotencyKey !== operation.idempotencyKey) {
        throw new Error("invalidation operation conflict");
      }
      return false;
    }
    this.invalidations.set(operation.id, operation);
    return true;
  }
  async findInvalidation(id: string) { return this.invalidations.get(id) ?? null; }
  async pendingInvalidations() { return [...this.invalidations.values()].filter((row) => row.state !== "complete"); }
  async completeInvalidation(id: string, result: InvalidationResult) {
    const row = this.invalidations.get(id);
    if (!row) throw new Error("missing invalidation");
    if (!("jws" in result)) throw new Error("missing event JWS");
    this.invalidations.set(id, {
      ...row,
      state: "complete",
      result,
      eventJwsSha256: await sha256Hex(new TextEncoder().encode(result.jws)),
    });
  }
  async markInvalidationNeedsAttention(id: string, detail: string, result?: InvalidationResult) {
    const row = this.invalidations.get(id);
    if (!row) throw new Error("missing invalidation");
    this.invalidations.set(id, { ...row, state: "needs_attention", detail, ...(result ? { result } : {}) });
  }
}

const INVALIDATION_RESULT: InvalidationResult = {
  estado: "invalidado",
  codigoGeneracion: issuance.codigoGeneracion,
  numeroControl: issuance.numeroControl,
  tipoDte: "03",
  ambiente: "00",
  evento: {
    codigoGeneracion: "BEB08A1C-1722-4E35-AEA6-52AB1234CDEF",
    selloRecibido: "event-seal",
    fhProcesamiento: "2026-09-30T12:30:00Z",
    tipoAnulacion: 1,
  },
  documento: { identificacion: { version: 2 } },
  jws: "exact-invalidation-event-jws",
  anotadoEnElIndice: true,
};
const INVALIDATION_REQUEST = {
  tipoAnulacion: 1 as const,
  responsable: { nombre: "Issuer", tipoDocumento: "36", numDocumento: "06140000000001" },
  solicita: { nombre: "Operator", tipoDocumento: "36", numDocumento: "06140000000001" },
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function transport(pdfStatus = 200, ticketStatus = 200, issueResponse: unknown = issuance) {
  const calls: Array<{ url: string; key?: string }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, key: headers.get("Idempotency-Key") ?? undefined });
    if (url.endsWith("/v1/status")) return Response.json({
      ok: true,
      ambiente: "00",
      emisor: { nit: "0614-010101-101-1", nombre: "Issuer", ambiente: "00" },
      llave: { keyId: "facta_test_x", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
    });
    if (url.endsWith("/v1/dte")) return Response.json(issueResponse);
    if (url.endsWith("/v1/dte/" + issuance.codigoGeneracion)) {
      return Response.json({
        estado: "sellado",
        codigoGeneracion: issuance.codigoGeneracion,
      });
    }
    if (url.endsWith("kind=json")) {
      return new Response(new TextEncoder().encode('{"exact":"json","jws":"signed-jws"}'), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="invoice.json"',
        },
      });
    }
    if (url.endsWith("kind=pdf")) {
      return new Response(
        pdfStatus === 200 ? new Uint8Array([37, 80, 68, 70]) : "missing",
        {
          status: pdfStatus,
          headers: {
            "Content-Type": pdfStatus === 200
              ? "application/pdf"
              : "application/json",
          },
        },
      );
    }
    if (url.includes("kind=ticket")) {
      return new Response(
        ticketStatus === 200 ? new Uint8Array([37, 80, 68, 70, 45, 84]) : "missing",
        {
          status: ticketStatus,
          headers: {
            "Content-Type": ticketStatus === 200 ? "application/pdf" : "application/json",
            "Content-Disposition": 'attachment; filename="invoice-ticket.pdf"',
          },
        },
      );
    }
    throw new Error("unexpected route " + url);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

Deno.test("archive readiness fails before a control number can be reserved", async () => {
  const archive = new MemoryArchive();
  archive.ready = false;
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  await assertRejects(() =>
    facta.issueAndArchive(request, {
      archive,
      operationId: "sale-1",
      idempotencyKey: "sale-1",
    })
  );
  assertEquals(calls.length, 0);
  assertEquals(archive.operation, null);
});

Deno.test("runtime archive defaults store exact JSON/PDF/JWS/ticket bytes after issuance", async () => {
  const archive = new MemoryArchive();
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch, runtime: { version: 1, archive } });
  const result = await facta.issueAndArchive(request, {
    operationId: "sale-2",
    idempotencyKey: "sale-2",
  });
  assertEquals(result.archive.state, "complete");
  assertEquals(archive.operation?.state, "complete");
  assertEquals(archive.artifacts.map((row) => row.kind), ["json", "jws", "pdf", "ticket"]);
  assertEquals(
    new TextDecoder().decode(archive.artifacts[0].bytes),
    issuance.archivoJson,
  );
  assertEquals(new TextDecoder().decode(archive.artifacts[1].bytes), "signed-jws");
  assertEquals([...archive.artifacts[2].bytes], [37, 80, 68, 70, 45, 116, 101, 115, 116]);
  assertEquals([...archive.artifacts[3].bytes], [37, 80, 68, 70, 45, 84]);
  assertEquals(calls.find((call) => call.key)?.key, "sale-2");
  assertEquals(calls.filter((call) => call.url.includes("/file?")).length, 1);
  assertEquals(calls.some((call) => call.url.includes("kind=json") || call.url.includes("kind=pdf")), false);
  assertEquals(calls.find((call) => call.url.includes("kind=ticket"))?.url.endsWith("kind=ticket&paperWidthMm=80"), true);
});

Deno.test("old API responses fall back to JSON/PDF downloads when inline files are unavailable", async () => {
  const archive = new MemoryArchive();
  const oldResponse = { ...issuance, archivoJson: undefined, representacionGrafica: undefined };
  const { fetch, calls } = transport(200, 200, oldResponse);
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch, runtime: { version: 1, archive } });
  const result = await facta.issueAndArchive(request, {
    operationId: "sale-old-server",
    idempotencyKey: "sale-old-server",
  });
  assertEquals(result.archive.state, "complete");
  assertEquals(calls.filter((call) => call.url.includes("/file?")).length, 3);
  assertEquals(calls.some((call) => call.url.includes("kind=json")), true);
  assertEquals(calls.some((call) => call.url.includes("kind=pdf")), true);
});

Deno.test("contingency archives the server-signed JSON without requesting a PDF or ticket", async () => {
  const archive = new MemoryArchive();
  const contingency = {
    estado: "contingencia",
    codigoGeneracion: issuance.codigoGeneracion,
    numeroControl: issuance.numeroControl,
    tipoDte: issuance.tipoDte,
    ambiente: issuance.ambiente,
    fecEmi: issuance.fecEmi,
    horEmi: issuance.horEmi,
    detalle: "Hacienda is unreachable",
    documento: issuance.documento,
    jws: issuance.jws,
    archivoJson: issuance.archivoJson,
  } as const;
  const { fetch, calls } = transport(404, 404, contingency);
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  const result = await facta.issueAndArchive(request, {
    archive,
    operationId: "sale-contingency",
    idempotencyKey: "sale-contingency",
  });
  assertEquals(result.emission?.estado, "contingencia");
  assertEquals(result.archive.state, "complete");
  assertEquals(archive.artifacts.map((row) => row.kind), ["json", "jws"]);
  assertEquals(calls.some((call) => call.url.includes("/file?")), false);
});

Deno.test("remote writes are idempotent, persisted per artifact, and reconciled without reissuing", async () => {
  const archive = new MemoryArchive();
  const { fetch, calls } = transport();
  let writes = 0;
  let firstWrite = true;
  const destination = {
    id: "s3-primary",
    kind: "s3",
    label: "S3 primary",
    write: async () => {
      writes++;
      if (firstWrite) {
        firstWrite = false;
        throw new Error("connection closed after remote commit");
      }
      return "stored" as const;
    },
    check: async () => "missing" as const,
  };
  const facta = new Facta({
    apiKey: "facta_test_x.secret",
    fetch,
    runtime: { version: 1, archive, remoteDestinations: [destination] },
  });
  const result = await facta.issueAndArchive(request, {
    operationId: "sale-remote",
    idempotencyKey: "sale-remote",
  });
  assertEquals(result.archive.state, "complete");
  assertEquals(result.archive.remoteCopies?.map((row) => row.state), ["unknown", "stored", "stored", "stored"]);
  assertEquals(writes, 4);
  assertEquals(archive.operation?.state, "complete");
  assertEquals((await archive.pending()).length, 1, "ambiguous remote copies remain visible for recovery");

  const recovered = await facta.issueAndArchive(request, {
    operationId: "sale-remote",
    idempotencyKey: "sale-remote",
  });
  assertEquals(recovered.archive.state, "complete");
  assertEquals(recovered.emission, undefined);
  assertEquals(recovered.archive.remoteCopies?.map((row) => row.state), ["stored", "stored", "stored", "stored"]);
  assertEquals(writes, 5, "only the previously ambiguous, confirmed-missing artifact is rewritten");
  assertEquals(archive.operation?.remoteCopies?.length, 4);
  assertEquals((await archive.pending()).length, 0);
  assertEquals(calls.filter((call) => call.url.endsWith("/v1/dte")).length, 1);
});

Deno.test("cancelling remote replication journals an ambiguous artifact and stops the batch", async () => {
  const archive = new MemoryArchive();
  const { fetch } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  await facta.issueAndArchive(request, {
    archive,
    operationId: "sale-cancel-remote",
    idempotencyKey: "sale-cancel-remote",
  });
  const controller = new AbortController();
  let writes = 0;
  const destination = {
    id: "cancelled-store",
    kind: "s3",
    label: "Cancelled store",
    async write() {
      writes += 1;
      controller.abort(new DOMException("caller cancelled", "AbortError"));
      throw controller.signal.reason;
    },
  };

  await assertRejects(() => facta.replicateArchive("sale-cancel-remote", archive, [destination], { signal: controller.signal }));
  assertEquals(writes, 1);
  assertEquals(archive.operation?.remoteCopies?.map((copy) => copy.state), ["unknown"]);
  assertEquals((await archive.pending()).length, 1);
});

Deno.test("remote destination diagnostics read existing artifacts without writing or changing the journal", async () => {
  const archive = new MemoryArchive();
  const { fetch } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  await facta.issueAndArchive(request, {
    archive,
    operationId: "sale-probe",
    idempotencyKey: "sale-probe",
  });

  let checks = 0;
  let writes = 0;
  const destination = {
    id: "read-only-probe",
    kind: "test-store",
    label: "Read-only probe",
    async check(artifact: ArchiveArtifact) {
      checks++;
      artifact.bytes.fill(0);
      return artifact.kind === "json" ? "stored" as const : "missing" as const;
    },
    async write() {
      writes++;
      return "stored" as const;
    },
  };
  const before = structuredClone(archive.operation);
  const report = await facta.diagnoseDestinations(
    "sale-probe",
    archive,
    [destination],
    { artifacts: ["json", "pdf"] },
  );

  assertEquals(report.results.map((row) => [row.artifact, row.state]), [
    ["json", "stored"],
    ["pdf", "missing"],
  ]);
  assertEquals(report.results.every((row) => row.expectedSha256.length === 64), true);
  assertEquals(checks, 2);
  assertEquals(writes, 0);
  assertEquals(archive.operation, before);
  assertEquals(new TextDecoder().decode((await archive.getArtifact(issuance.codigoGeneracion, "json"))?.bytes), issuance.archivoJson);

  archive.artifacts = archive.artifacts.filter((artifact) => artifact.kind !== "ticket");
  await assertRejects(
    () => facta.diagnoseDestinations("sale-probe", archive, [destination], { artifacts: ["ticket"] }),
    Error,
    "Local artifact is missing: ticket",
  );
  assertEquals(checks, 2, "a missing local artifact fails before remote calls");
});

Deno.test("PDF failure is reported as issued with archive attention, not as an issuance failure", async () => {
  const archive = new MemoryArchive();
  const { fetch } = transport(404, 200, { ...issuance, representacionGrafica: null });
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  const result = await facta.issueAndArchive(request, {
    archive,
    operationId: "sale-3",
    idempotencyKey: "sale-3",
  });
  assertEquals(result.emission?.codigoGeneracion, issuance.codigoGeneracion);
  assertEquals(result.archive.state, "needs_attention");
  assertEquals(archive.operation?.state, "needs_attention");
  assertStringIncludes(result.archive.detail ?? "", "404");
});

Deno.test("ticket failure preserves fiscal success and leaves the requested archive incomplete", async () => {
  const archive = new MemoryArchive();
  const { fetch } = transport(200, 503);
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  const result = await facta.issueAndArchive(request, {
    archive,
    operationId: "sale-ticket-failure",
    idempotencyKey: "sale-ticket-failure",
  });
  assertEquals(result.emission?.codigoGeneracion, issuance.codigoGeneracion);
  assertEquals(result.archive.state, "needs_attention");
  assertEquals(archive.operation?.state, "needs_attention");
  assertEquals(archive.artifacts.map((row) => row.kind), ["json", "jws", "pdf"]);
});

Deno.test("restart recovery reuses the saved idempotency key", async () => {
  const archive = new MemoryArchive();
  archive.operation = {
    id: "sale-4",
    identity: IDENTITY_X,
    idempotencyKey: "same-key",
    requestSha256: "placeholder",
    createdAt: new Date().toISOString(),
    state: "started",
  };
  // Set the expected fingerprint through the same public input encoding.
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(request)),
    ),
  );
  archive.operation.requestSha256 = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  const result = await facta.recoverOperation("sale-4", { request, archive });
  assertEquals(result.archive.state, "complete");
  assertEquals(calls.find((call) => call.key)?.key, "same-key");
});

Deno.test("encrypted request snapshot enables recovery and pending listing by operation ID", async () => {
  const archive = new MemoryArchive();
  const requestSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(request)),
    )),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  await archive.begin({
    id: "sale-request-snapshot",
    identity: IDENTITY_X,
    idempotencyKey: "persisted-key",
    requestSha256,
    request,
    createdAt: new Date().toISOString(),
    state: "started",
    remoteCopies: [{
      destinationId: "remote-1",
      kind: "json",
      label: "Private destination label",
      state: "stored",
      sha256: "b".repeat(64),
      updatedAt: new Date().toISOString(),
      detail: "provider error with possibly sensitive details",
    }],
  });
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch, runtime: { version: 1, archive } });

  const pending = await facta.listPendingOperations();
  assertEquals(pending.map((operation) => operation.id), ["sale-request-snapshot"]);
  assertEquals("request" in pending[0], false);
  assertEquals("detail" in pending[0].remoteCopies![0], false);
  assertEquals("label" in pending[0].remoteCopies![0], false);
  const result = await facta.recoverOperation("sale-request-snapshot");

  assertEquals(result.archive.state, "complete");
  assertEquals(calls.find((call) => call.key)?.key, "persisted-key");
  assertEquals(await facta.listPendingOperations(), []);
});

Deno.test("recovery with a saved generation code checks status and downloads without reissuing", async () => {
  const archive = new MemoryArchive();
  archive.operation = {
    id: "sale-5",
    identity: IDENTITY_X,
    idempotencyKey: "already-issued",
    requestSha256: "",
    createdAt: new Date().toISOString(),
    state: "issued",
    codigoGeneracion: issuance.codigoGeneracion,
    ticketPaperWidthMm: 58,
  };
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(request)),
    ),
  );
  archive.operation.requestSha256 = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  const result = await facta.recoverOperation("sale-5", { request, archive });
  assertEquals(result.emission, undefined);
  assertEquals(result.archive.state, "complete");
  assertEquals(result.archive.artifacts.map((row) => row.kind), ["json", "jws", "pdf", "ticket"]);
  assertEquals(
    new TextDecoder().decode(archive.artifacts.find((row) => row.kind === "jws")?.bytes),
    issuance.jws,
  );
  assertEquals(calls.filter((call) => call.url.includes("/file?")).length, 3);
  assertEquals(calls.some((call) => call.url.endsWith("/v1/dte")), false);
});

Deno.test("an expired unconfirmed operation stops instead of risking a duplicate invoice", async () => {
  const archive = new MemoryArchive();
  archive.operation = {
    id: "sale-6",
    identity: IDENTITY_X,
    idempotencyKey: "expired-key",
    requestSha256: "",
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    state: "started",
  };
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(request)),
    ),
  );
  archive.operation.requestSha256 = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  await assertRejects(
    () => facta.recoverOperation("sale-6", { request, archive }),
    Error,
    "safe idempotency window",
  );
  assertEquals(calls.some((call) => call.url.endsWith("/v1/dte")), false);
  assertEquals(archive.operation.state, "needs_attention");
});

Deno.test("archive recovery is bound to the endpoint and authenticated key identity", async () => {
  const archive = new MemoryArchive();
  await archive.begin({
    id: "bound-operation",
    identity: IDENTITY_X,
    idempotencyKey: "bound-key",
    requestSha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(request))),
    request,
    createdAt: new Date().toISOString(),
    state: "started",
  });
  const calls: Array<{ method: string; url: string }> = [];
  const facta = new Facta({
    apiKey: "facta_test_y.secret",
    baseUrl: "https://other.example/api-v1",
    fetch: (async (input, init) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url });
      return Response.json({
        ok: true,
        ambiente: "00",
        emisor: { nit: IDENTITY_X.issuerNit, nombre: "Issuer", ambiente: "00" },
        llave: { keyId: "facta_test_y", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
      });
    }) as typeof globalThis.fetch,
  });
  const error = await assertRejects(() => facta.recoverOperation("bound-operation", { request, archive }), FactaError);
  assertEquals(error.code, "archive_integrity_error");
  assertEquals(calls.filter((call) => call.method === "POST").length, 0);
});

Deno.test("legacy journals without identity remain inspectable but cannot be replayed", async () => {
  const archive = new MemoryArchive();
  archive.operation = {
    id: "legacy-operation",
    idempotencyKey: "legacy-key",
    requestSha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(request))),
    request,
    createdAt: new Date().toISOString(),
    state: "started",
  };
  const { fetch, calls } = transport();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch });
  assertEquals((await facta.listPendingOperations(archive))[0]?.id, "legacy-operation");
  const error = await assertRejects(() => facta.recoverOperation("legacy-operation", { request, archive }), FactaError);
  assertEquals(error.code, "archive_integrity_error");
  assertEquals(calls.some((call) => call.url.endsWith("/v1/dte")), false);
});

Deno.test("partial archive recovery reuses the exact saved PDF and downloads only a missing ticket", async () => {
  const archive = new MemoryArchive();
  const first = transport(200, 500);
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: first.fetch });
  const initial = await facta.issueAndArchive(request, {
    archive,
    operationId: "partial-artifacts",
    idempotencyKey: "partial-artifacts",
  });
  assertEquals(initial.archive.state, "needs_attention");
  const originalPdf = archive.artifacts.find((artifact) => artifact.kind === "pdf")!.bytes;

  const recovery = transport(500, 200);
  const resumed = new Facta({ apiKey: "facta_test_x.secret", fetch: recovery.fetch });
  const result = await resumed.recoverOperation("partial-artifacts", { request, archive });
  assertEquals(result.archive.state, "complete");
  assertEquals(recovery.calls.some((call) => call.url.includes("kind=pdf")), false);
  assertEquals([...archive.artifacts.find((artifact) => artifact.kind === "pdf")!.bytes], [...originalPdf]);
  assertEquals(recovery.calls.some((call) => call.url.includes("kind=ticket")), true);
  assertEquals(recovery.calls.some((call) => call.key !== undefined && call.url.endsWith("/v1/dte")), false);
});

Deno.test("encrypted file archive survives restart, verifies bytes and resumes an issued journal", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-archive-test-" });
  const passphrase = "unique-archive-secret-4cS8vK2wP9nR5xJ7mQ3t";
  try {
    const [first, concurrent] = await Promise.all([
      FileInvoiceArchive.open({ directory, passphrase }),
      FileInvoiceArchive.open({ directory, passphrase }),
    ]);
    await first.assertReady();
    const operation: ArchiveOperation = {
      id: "sale-restart",
      idempotencyKey: "sale-restart",
      requestSha256: "a".repeat(64),
      request,
      createdAt: new Date().toISOString(),
      state: "started",
    };
    await assertRejects(
      () => first.begin({ ...operation, ticketPaperWidthMm: 58.5 }),
      TypeError,
    );
    const beginResults = await Promise.all([
      first.begin(operation),
      concurrent.begin(operation),
    ]);
    assertEquals(beginResults.sort(), [false, true]);
    await first.markIssued("sale-restart", issuance);

    const json = new TextEncoder().encode('{"private":"exact json bytes"}');
    const hash = async (bytes: Uint8Array) => {
      const value = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(bytes).buffer as ArrayBuffer,
        ),
      );
      return Array.from(value, (byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const jsonArtifact: ArchiveArtifact = {
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "json",
      filename: "invoice.json",
      contentType: "application/json",
      bytes: json,
      sha256: await hash(json),
    };
    await first.saveArtifact(jsonArtifact);

    const restarted = await FileInvoiceArchive.open({ directory, passphrase });
    const pending = await restarted.pending();
    assertEquals(pending.length, 1);
    assertEquals(pending[0].state, "issued");
    await restarted.saveArtifact(jsonArtifact);
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49]);
    await restarted.saveArtifact({
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "pdf",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      bytes: pdf,
      sha256: await hash(pdf),
    });
    const jws = new TextEncoder().encode(issuance.jws);
    await restarted.saveArtifact({
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "jws",
      filename: issuance.codigoGeneracion + ".jws",
      contentType: "application/jose",
      bytes: jws,
      sha256: await hash(jws),
    });
    const ticket = new Uint8Array([37, 80, 68, 70, 45, 84]);
    await restarted.saveArtifact({
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "ticket",
      filename: issuance.codigoGeneracion + "-ticket.pdf",
      contentType: "application/pdf",
      bytes: ticket,
      sha256: await hash(ticket),
    });
    await restarted.finish("sale-restart");
    assertEquals((await restarted.find("sale-restart"))?.state, "complete");
    assertEquals((await restarted.pending()).length, 0);
    const storedJson = await restarted.getArtifact(
      issuance.codigoGeneracion,
      "json",
    );
    assertEquals(
      storedJson && new TextDecoder().decode(storedJson.bytes),
      '{"private":"exact json bytes"}',
    );
    const storedJws = await restarted.getArtifact(issuance.codigoGeneracion, "jws");
    assertEquals(storedJws && new TextDecoder().decode(storedJws.bytes), issuance.jws);
    const storedTicket = await restarted.getArtifact(issuance.codigoGeneracion, "ticket");
    assertEquals(storedTicket && new TextDecoder().decode(storedTicket.bytes), "%PDF-T");

    await restarted.recordRemoteCopy("sale-restart", {
      destinationId: "remote-a",
      kind: "json",
      label: "Remote archive",
      state: "unknown",
      sha256: storedJson!.sha256,
      updatedAt: new Date().toISOString(),
      detail: "The remote response was ambiguous.",
    });
    const reopened = await FileInvoiceArchive.open({ directory, passphrase });
    const reopenedOperation = await reopened.find("sale-restart");
    assertEquals(reopenedOperation?.remoteCopies?.[0]?.state, "unknown");
    assertEquals(reopenedOperation?.request, request);
    assertEquals((await reopened.pending()).length, 1);

    let plaintextFound = false;
    let encryptedArtifactPath = "";
    for await (const entry of Deno.readDir(directory + "/artifacts")) {
      const path = directory + "/artifacts/" + entry.name;
      const bytes = await Deno.readFile(path);
      const text = new TextDecoder().decode(bytes);
      if (text.includes("private") || text.includes("exact json bytes")) {
        plaintextFound = true;
      }
    }
    encryptedArtifactPath = directory + "/artifacts/" +
      await hash(new TextEncoder().encode(issuance.codigoGeneracion + ":json")) + ".enc";
    const encryptedOperationPath = directory + "/operations/" +
      await hash(new TextEncoder().encode("sale-restart")) + ".enc";
    const operationText = new TextDecoder().decode(await Deno.readFile(encryptedOperationPath));
    assertEquals(operationText.includes('"descripcion":"Tea"'), false, "journal request must be encrypted at rest");
    assertEquals(
      plaintextFound,
      false,
      "document artifacts must be encrypted at rest",
    );
    const damaged = await Deno.readFile(encryptedArtifactPath);
    damaged[damaged.length - 1] ^= 1;
    await Deno.writeFile(encryptedArtifactPath, damaged);
    await assertRejects(
      () => restarted.getArtifact(issuance.codigoGeneracion, "json"),
      Error,
    );

    await assertRejects(
      () =>
        FileInvoiceArchive.open({
          directory,
          passphrase: "incorrect-archive-secret-4cS8vK2wP9nR5xJ7mQ3t",
        }),
      Error,
      "Incorrect archive passphrase",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file archive refuses to treat partial artifact files as missing or overwrite them", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-partial-artifact-test-" });
  try {
    const archive = await FileInvoiceArchive.open({ directory, passphrase: "partial-artifact-secret-long-enough-32-chars" });
    await archive.begin({
      id: "partial-pair",
      identity: IDENTITY_X,
      idempotencyKey: "partial-pair",
      requestSha256: "d".repeat(64),
      request,
      createdAt: new Date().toISOString(),
      state: "started",
    });
    await archive.markIssued("partial-pair", issuance);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await archive.saveArtifact({
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "pdf",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      bytes,
      sha256: await sha256Hex(bytes),
    });
    const base = directory + "/artifacts/" + await sha256Hex(new TextEncoder().encode(issuance.codigoGeneracion + ":pdf"));
    await Deno.remove(base + ".meta.enc");
    await assertRejects(() => archive.getArtifact(issuance.codigoGeneracion, "pdf"), FactaError);
    const replacementBytes = new Uint8Array([37, 80, 68, 70, 50]);
    const replacementSha256 = await sha256Hex(replacementBytes);
    await assertRejects(() => archive.saveArtifact({
      codigoGeneracion: issuance.codigoGeneracion,
      kind: "pdf",
      filename: "regenerated.pdf",
      contentType: "application/pdf",
      bytes: replacementBytes,
      sha256: replacementSha256,
    }), FactaError);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file archive reads legacy journal rows and rejects unknown schema versions", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-archive-schema-test-" });
  const passphrase = "unique-archive-secret-2mR7pX4cN9vB6kL3qT8s";
  const operationId = "schema-version-sale";
  const encodeHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const keyFor = async () => {
    const config = JSON.parse(await Deno.readTextFile(directory + "/facta-archive.json")) as { salt: string };
    const saltBytes = Uint8Array.from(atob(config.salt), (char) => char.charCodeAt(0));
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: 310_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt", "encrypt"],
    );
  };
  const rewriteRecord = async (
    version: "legacy" | 1 | 2,
    recordId = operationId,
    folder = "operations",
    aad = "operation-record",
  ) => {
    const pathHash = encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(recordId))));
    const path = directory + "/" + folder + "/" + pathHash + ".enc";
    const sealed = await Deno.readFile(path);
    const key = await keyFor();
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: new TextEncoder().encode(aad) },
      key,
      sealed.slice(12),
    ));
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
    if (version === "legacy") delete value.schemaVersion;
    else value.schemaVersion = version;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ));
    const next = new Uint8Array(iv.length + ciphertext.length);
    next.set(iv);
    next.set(ciphertext, iv.length);
    await Deno.writeFile(path, next);
    return value;
  };

  try {
    const archive = await FileInvoiceArchive.open({ directory, passphrase });
    await archive.begin({
      id: operationId,
      idempotencyKey: operationId,
      requestSha256: "b".repeat(64),
      createdAt: new Date().toISOString(),
      state: "started",
    });

    await rewriteRecord("legacy");
    assertEquals((await archive.find(operationId))?.id, operationId);
    assertEquals((await archive.pending()).length, 1);

    await archive.markNeedsAttention(operationId, "test rewrite");
    assertEquals((await rewriteRecord(1)).schemaVersion, 1, "rewritten records must declare schema v1");

    await rewriteRecord(2);
    await assertRejects(
      () => archive.find(operationId),
      FactaError,
      "journal schema version is unsupported",
    );
    await assertRejects(
      () => archive.pending(),
      FactaError,
      "journal schema version is unsupported",
    );

    const eventId = "schema-version-event";
    await archive.beginInvalidation({
      id: eventId,
      targetCodigoGeneracion: issuance.codigoGeneracion,
      idempotencyKey: eventId,
      requestSha256: "c".repeat(64),
      request: INVALIDATION_REQUEST,
      createdAt: new Date().toISOString(),
      state: "started",
    });
    await rewriteRecord("legacy", eventId, "events", "invalidation-record");
    assertEquals((await archive.findInvalidation(eventId))?.id, eventId);
    assertEquals((await archive.pendingInvalidations()).length, 1);

    await archive.markInvalidationNeedsAttention(eventId, "test rewrite");
    assertEquals(
      (await rewriteRecord(1, eventId, "events", "invalidation-record")).schemaVersion,
      1,
      "rewritten invalidation rows must declare schema v1",
    );
    await rewriteRecord(2, eventId, "events", "invalidation-record");
    await assertRejects(
      () => archive.findInvalidation(eventId),
      FactaError,
      "journal schema version is unsupported",
    );
    await assertRejects(
      () => archive.pendingInvalidations(),
      FactaError,
      "journal schema version is unsupported",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("file archive never steals a stale writer lock and supports explicit recovery", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-archive-lock-test-" });
  const passphrase = "unique-archive-secret-7pQ3vN8mC5xR2kL9dA4s";
  const lockPath = directory + "/.facta-writer-lock";
  try {
    const archive = await FileInvoiceArchive.open({ directory, passphrase, lockTimeoutMs: 30 });
    await Deno.mkdir(lockPath);
    await Deno.writeTextFile(lockPath + "/owner.json", JSON.stringify({
      lockId: "stale-test-lock",
      processId: 12345,
      acquiredAt: new Date(0).toISOString(),
    }));

    await assertRejects(
      () => archive.assertReady(),
      Error,
      "releaseStaleLock",
    );
    assertEquals(await Deno.stat(lockPath).then(() => true), true);
    assertEquals(await FileInvoiceArchive.releaseStaleLock({
      directory,
      confirmNoConcurrentWriters: true,
    }), true);
    assertEquals(await Deno.stat(lockPath).then(() => true).catch(() => false), false);
    await archive.assertReady();

    await Deno.mkdir(lockPath);
    await assertRejects(() => archive.assertReady(), Error, "releaseStaleLock");
    assertEquals(await FileInvoiceArchive.releaseStaleLock({
      directory,
      confirmNoConcurrentWriters: true,
    }), true);
    await archive.assertReady();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("invalidation recovery reuses its key and encrypts the exact event JWS", async () => {
  const directory = await Deno.makeTempDir({ prefix: "facta-invalidation-archive-test-" });
  const passphrase = "unique-invalidation-secret-7pQ3vN8mC5xR2kL9dA4s";
  const archive = await FileInvoiceArchive.open({ directory, passphrase });
  const first = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    signKey: "factask_signing-secret",
    maxRetries: 0,
    fetch: (async (input) => {
      if (String(input).endsWith("/v1/status")) return Response.json({ ok: true, ambiente: "00", emisor: { nit: IDENTITY_A.issuerNit, nombre: "Issuer", ambiente: "00" }, llave: { keyId: IDENTITY_A.keyId, label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null } });
      throw new TypeError("connection reset");
    }) as typeof globalThis.fetch,
  });
  try {
    const failure = await assertRejects(
      () => first.invalidateAndArchive(issuance.codigoGeneracion, INVALIDATION_REQUEST, {
        archive,
        operationId: "invalidate-order-42",
        idempotencyKey: "invalidate-order-42",
      }),
      FactaError,
    );
    assertEquals(failure.code, "network_error");
    assertEquals((await archive.findInvalidation("invalidate-order-42"))?.state, "started");
    await assertRejects(
      () => archive.beginInvalidation({
        id: "invalidate-order-42",
        identity: IDENTITY_A,
        targetCodigoGeneracion: issuance.codigoGeneracion,
        idempotencyKey: "invalidate-order-42",
        requestSha256: "d".repeat(64),
        request: INVALIDATION_REQUEST,
        createdAt: new Date().toISOString(),
        state: "started",
      }),
      Error,
      "different request",
    );

    const restartedArchive = await FileInvoiceArchive.open({ directory, passphrase });
    let replayedKey: string | null = null;
    const restartedFacta = new Facta({
      apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
      signKey: "factask_signing-secret",
      maxRetries: 0,
      fetch: (async (_input, init) => {
        if (String(_input).endsWith("/v1/status")) return Response.json({ ok: true, ambiente: "00", emisor: { nit: IDENTITY_A.issuerNit, nombre: "Issuer", ambiente: "00" }, llave: { keyId: IDENTITY_A.keyId, label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null } });
        replayedKey = new Headers(init?.headers).get("Idempotency-Key");
        return Response.json(INVALIDATION_RESULT);
      }) as typeof globalThis.fetch,
    });
    const recovered = await restartedFacta.recoverInvalidation(
      "invalidate-order-42",
      restartedArchive,
    );
    assertEquals(replayedKey, "invalidate-order-42");
    assertEquals(recovered.archive.state, "complete");
    assertEquals(
      recovered.invalidation && "jws" in recovered.invalidation
        ? recovered.invalidation.jws
        : null,
      INVALIDATION_RESULT.jws,
    );

    const finalArchive = await FileInvoiceArchive.open({ directory, passphrase });
    const stored = await finalArchive.findInvalidation("invalidate-order-42");
    assertEquals(stored?.state, "complete");
    assertEquals(stored?.eventJwsSha256, await sha256Hex(new TextEncoder().encode(INVALIDATION_RESULT.jws)));
    assertEquals((await finalArchive.pendingInvalidations()).length, 0);
    const eventDirectory = directory + "/events";
    for await (const entry of Deno.readDir(eventDirectory)) {
      const encrypted = await Deno.readFile(eventDirectory + "/" + entry.name);
      assertEquals(new TextDecoder().decode(encrypted).includes(INVALIDATION_RESULT.jws), false);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("sparse already-invalidated response and expired event recovery never resend", async () => {
  const archive = new MemoryInvalidationArchive();
  let requests = 0;
  const facta = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    signKey: "factask_signing-secret",
    maxRetries: 0,
    runtime: { version: 1, invalidationArchive: archive },
    fetch: (async (input) => {
      // Status is a read-only identity preflight; only invalidation counts below.
      if (String(input).endsWith("/v1/status")) return Response.json({ ok: true, ambiente: "00", emisor: { nit: IDENTITY_A.issuerNit, nombre: "Issuer", ambiente: "00" }, llave: { keyId: IDENTITY_A.keyId, label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null } });
      requests += 1;
      return Response.json({
        estado: "invalidado",
        codigoGeneracion: issuance.codigoGeneracion,
        numeroControl: issuance.numeroControl,
        yaEstabaInvalidado: true,
      });
    }) as typeof globalThis.fetch,
  });
  const sparse = await facta.invalidateAndArchive(issuance.codigoGeneracion, INVALIDATION_REQUEST, {
    operationId: "already-invalidated",
    idempotencyKey: "already-invalidated",
  });
  assertEquals(sparse.archive.state, "needs_attention");
  assertEquals(requests, 1);
  const pending = await facta.listPendingInvalidations();
  assertEquals(pending[0].targetCodigoGeneracion, issuance.codigoGeneracion);
  const sparseRecoveryError = await assertRejects(
    () => facta.recoverInvalidation("already-invalidated"),
    FactaError,
  );
  assertEquals(sparseRecoveryError.code, "operation_outcome_unknown");
  assertEquals(requests, 1);

  await archive.beginInvalidation({
    id: "expired-event",
    identity: IDENTITY_A,
    targetCodigoGeneracion: issuance.codigoGeneracion,
    idempotencyKey: "expired-event",
    requestSha256: "b".repeat(64),
    request: INVALIDATION_REQUEST,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    state: "started",
  });
  const expiredRecoveryError = await assertRejects(
    () => facta.recoverInvalidation("expired-event", archive),
    FactaError,
  );
  assertEquals(expiredRecoveryError.code, "operation_outcome_unknown");
  assertEquals(requests, 1);
});

Deno.test("invalidation archive refuses a response for a different target document", async () => {
  const archive = new MemoryInvalidationArchive();
  const facta = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    signKey: "factask_signing-secret",
    maxRetries: 0,
    fetch: (async (input) => String(input).endsWith("/v1/status")
      ? Response.json({ ok: true, ambiente: "00", emisor: { nit: IDENTITY_A.issuerNit, nombre: "Issuer", ambiente: "00" }, llave: { keyId: IDENTITY_A.keyId, label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null } })
      : Response.json({
      ...INVALIDATION_RESULT,
      codigoGeneracion: "A1A08A1C-1722-4E35-AEA6-52AB1234CDEF",
    })) as typeof globalThis.fetch,
  });
  const error = await assertRejects(
    () => facta.invalidateAndArchive(issuance.codigoGeneracion, INVALIDATION_REQUEST, {
      archive,
      operationId: "mismatched-invalidation",
      idempotencyKey: "mismatched-invalidation",
    }),
    FactaError,
  );
  assertEquals(error.code, "internal_error");
  assertEquals((await archive.findInvalidation("mismatched-invalidation"))?.state, "needs_attention");
});
