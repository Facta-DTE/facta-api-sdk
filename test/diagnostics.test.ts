import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { diagnoseStatus } from "../src/diagnostics.ts";
import type { Status } from "../src/types.ts";

function status(overrides: Partial<Status> = {}): Status {
  return {
    ok: true,
    version: "v1",
    ambiente: "00",
    emisor: { nit: "0614", nombre: "Example issuer", ambiente: "00" },
    llave: {
      keyId: "facta_test_key",
      label: null,
      modo: "byok",
      alcances: ["issue", "query", "download"],
      tiposDte: ["03"],
      venceEl: null,
    },
    firma: {
      vaultDeFirma: true,
      origenDeLaFirma: "vault",
      cabecera: "x-facta-sign-key",
      certificado: {
        fingerprint: "AB:CD:EF:01:23:45",
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2035-01-01T00:00:00Z",
        nit: "0614",
        environment: "00",
      },
    },
    sincronizacion: {
      sign: { desiredRevision: 1, publishedRevision: 1, status: "ready" },
      destinations: {
        desiredRevision: 2,
        publishedRevision: 2,
        status: "ready",
      },
      catalog: { desiredRevision: 5, publishedRevision: 5, status: "ready" },
    },
    limites: {
      hora: { limit: 20, used: 2, remaining: 18 },
      dia: { limit: 100, used: 2, remaining: 98 },
      estado: { limit: 240, used: 2, remaining: 238 },
      montoMaximoPorDocumentoCentavos: 100_000_00,
    },
    ...overrides,
  };
}

const readyArchive = {
  assertReady: async () => {},
  pending: async () => [],
} as unknown as import("../src/archive.ts").InvoiceArchive;

Deno.test("diagnostics distinguish issue readiness from optional durable archive readiness", async () => {
  const withoutArchive = await diagnoseStatus(status(), { dteType: "03" });
  assertEquals(withoutArchive.canIssue, true);
  assertEquals(withoutArchive.canIssueAndArchive, false);
  assertEquals(withoutArchive.overall, "attention");

  const withArchive = await diagnoseStatus(status(), {
    dteType: "03",
    archive: readyArchive,
  });
  assertEquals(withArchive.canIssue, true);
  assertEquals(withArchive.canIssueAndArchive, true);
  assertEquals(withArchive.pendingArchiveOperations, 0);
  assertEquals(withArchive.revisions, {
    sign: { desiredRevision: 1, publishedRevision: 1, status: "ready" },
    destinations: { desiredRevision: 2, publishedRevision: 2, status: "ready" },
    catalog: { desiredRevision: 5, publishedRevision: 5, status: "ready" },
  });
  assertEquals(withArchive.overall, "ready");
});

Deno.test("diagnostics reports pending archive operations without exposing journal data", async () => {
  const report = await diagnoseStatus(status(), {
    archive: {
      assertReady: async () => {},
      pending:
        async () => [{
          id: "private-order",
          state: "complete",
          requestSha256: "secret-hash",
          remoteCopies: [{ destinationId: "private-destination", kind: "json", state: "unknown", sha256: "private-digest" }],
        }],
    } as unknown as import("../src/archive.ts").InvoiceArchive,
  });
  assertEquals(report.canIssue, true);
  assertEquals(report.canIssueAndArchive, true);
  assertEquals(report.pendingArchiveOperations, 1);
  assertEquals(report.overall, "attention");
  assertEquals(
    report.checks.some((check) => check.message.includes("private-order")),
    false,
  );
  assertEquals(
    report.checks.some((check) => check.message.includes("secret-hash")),
    false,
  );
});

Deno.test("pending destinations block issuance while an outdated catalog permits inline data", async () => {
  const report = await diagnoseStatus(status({
    sincronizacion: {
      destinations: {
        desiredRevision: 4,
        publishedRevision: 3,
        status: "pending",
      },
      catalog: { desiredRevision: 8, publishedRevision: 7, status: "pending" },
    },
  }));
  assertEquals(report.canIssue, false);
  assertEquals(report.canQuery, true);
  assertEquals(
    report.checks.find((check) => check.id === "catalog-sync")?.state,
    "warning",
  );
});

Deno.test("missing signing provision and an expired key block issuance without hiding queries", async () => {
  const report = await diagnoseStatus(status({
    firma: {
      vaultDeFirma: false,
      origenDeLaFirma: "sin-provisionar",
      cabecera: "x-facta-sign-key",
    },
    llave: { ...status().llave, venceEl: "2020-01-01T00:00:00Z" },
  }));
  assertEquals(report.canIssue, false);
  assertEquals(report.canQuery, true);
  assertEquals(report.overall, "blocked");
});

Deno.test("diagnostics blocks an expired signing certificate and recommends app sync", async () => {
  const report = await diagnoseStatus(status({
    firma: {
      ...status().firma!,
      certificado: {
        fingerprint: "AB:CD:EF:01:23:45",
        validFrom: "2020-01-01T00:00:00Z",
        validTo: "2021-01-01T00:00:00Z",
        nit: "0614",
        environment: "00",
      },
    },
  }), { dteType: "03" });
  assertEquals(report.canIssue, false);
  assertEquals(report.canQuery, true);
  assertEquals(
    report.checks.find((check) => check.id === "certificate-validity")?.state,
    "blocked",
  );
  assertEquals(
    report.checks.find((check) => check.id === "certificate-validity")?.message.includes("sync the key from the app"),
    true,
  );
});

Deno.test("diagnostics blocks a signing certificate whose NIT disagrees", async () => {
  const report = await diagnoseStatus(status({
    firma: {
      ...status().firma!,
      certificado: {
        fingerprint: "AB:CD:EF:01:23:45",
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2035-01-01T00:00:00Z",
        nit: "0999",
        environment: "01",
      },
    },
  }), { dteType: "03" });
  assertEquals(report.canIssue, false);
  assertEquals(report.canQuery, true);
  assertEquals(report.checks.find((check) => check.id === "certificate-identity")?.state, "blocked");
  assertEquals(report.checks.find((check) => check.id === "certificate-environment")?.state, "warning");
});

Deno.test("diagnostics treats the registered certificate environment as advisory", async () => {
  const report = await diagnoseStatus(status({
    firma: {
      ...status().firma!,
      certificado: {
        fingerprint: "AB:CD:EF:01:23:45",
        validFrom: "2026-01-01T00:00:00Z",
        validTo: "2035-01-01T00:00:00Z",
        nit: "0614",
        environment: "01",
      },
    },
  }), { dteType: "03" });
  assertEquals(report.canIssue, true);
  assertEquals(report.overall, "attention");
  assertEquals(report.checks.find((check) => check.id === "certificate-environment")?.state, "warning");
});

Deno.test("missing legacy certificate metadata warns but does not disable an otherwise valid key", async () => {
  const report = await diagnoseStatus(status({
    firma: {
      vaultDeFirma: true,
      origenDeLaFirma: "vault",
      cabecera: "x-facta-sign-key",
      certificado: null,
    },
  }), { dteType: "03" });
  assertEquals(report.canIssue, true);
  assertEquals(report.overall, "attention");
  assertEquals(report.checks.find((check) => check.id === "certificate-metadata")?.state, "unknown");
});

Deno.test("diagnose turns an API status failure into a safe blocked report", async () => {
  const calls: RequestInit[] = [];
  const facta = new Facta({
    apiKey: "facta_test_key.secret",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return Response.json({
        error: { code: "service_unavailable", message: "offline" },
      }, { status: 503 });
    }) as typeof globalThis.fetch,
  });
  const report = await facta.diagnose({ dteType: "03" });
  assertEquals(report.overall, "blocked");
  assertEquals(report.canIssue, false);
  assertEquals(report.checks[0].message.includes("service_unavailable"), true);
  assertEquals(new Headers(calls[0].headers).has("Idempotency-Key"), false);
});


Deno.test("configured environment and scopes are verified against live key status", async () => {
  const current = status();
  const mismatch = await diagnoseStatus(status({ llave: { ...current.llave, alcances: ["issue"] } }), {
    expectedEnvironment: "01",
    requiredScopes: ["issue", "download"],
  });
  assertEquals(mismatch.canIssue, false);
  assertEquals(mismatch.checks.find((check) => check.id === "configured-environment")?.state, "blocked");
  assertEquals(mismatch.checks.find((check) => check.id === "configured-scope-download")?.state, "blocked");
});

Deno.test("legacy status without a synchronization block retains guarded archive readiness", async () => {
  const legacy = status({ sincronizacion: undefined });
  const report = await diagnoseStatus(legacy, {
    dteType: "03", archive: readyArchive, expectedEnvironment: "00",
    requiredScopes: ["issue", "query", "download"],
  });
  assertEquals(report.canIssueAndArchive, true);
  assertEquals(report.overall, "attention");
  assertEquals(report.checks.find((check) => check.id === "sign-sync")?.state, "warning");
  assertEquals(report.checks.find((check) => check.id === "destinations-sync")?.state, "warning");

  for (const guarded of [
    { ...legacy, firma: { ...legacy.firma!, vaultDeFirma: false, origenDeLaFirma: "sin-provisionar" as const } },
    { ...legacy, limites: { ...legacy.limites, hora: null } },
    { ...legacy, llave: { ...legacy.llave, alcances: ["issue", "query"] } },
  ]) {
    const blocked = await diagnoseStatus(guarded, {
      archive: readyArchive, requiredScopes: ["issue", "query", "download"],
    });
    assertEquals(blocked.canIssueAndArchive, false);
  }
});

Deno.test("present incomplete or failed synchronization metadata never uses legacy compatibility", async () => {
  const ready = { desiredRevision: 1, publishedRevision: 1, status: "ready" as const };
  for (const sincronizacion of [
    null,
    {},
    { sign: ready },
    { destinations: ready },
    { sign: { ...ready, status: "pending" }, destinations: ready },
    { sign: ready, destinations: { ...ready, status: "error" } },
    { sign: { ...ready, publishedRevision: 0 }, destinations: ready },
  ]) {
    const fixture = { ...status(), sincronizacion } as unknown as Status;
    const report = await diagnoseStatus(fixture, { archive: readyArchive });
    assertEquals(report.canIssueAndArchive, false);
    assertEquals(report.overall, "blocked");
  }
});
