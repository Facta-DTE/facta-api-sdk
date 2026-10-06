// Batch K: the client's reference clock (`clock` option).
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { DEFAULT_CLOCK_URL } from "../src/clock-config.ts";
import type { ArchiveOperation, InvoiceArchive } from "../src/archive.ts";

const BEHIND_MS = 7 * 60_000; // the device runs 7 minutes behind the Worker

interface Harness {
  clockCalls: string[];
  apiCalls: string[];
  fetch: typeof fetch;
}

function harness(opts: { clockDown?: boolean } = {}): Harness {
  const h: Harness = {
    clockCalls: [],
    apiCalls: [],
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname.endsWith("factadte.com") && !url.pathname.includes("/v1/")) {
        h.clockCalls.push(url.origin + url.pathname);
        if (opts.clockDown) throw new TypeError("clock unreachable");
        const t0 = Number(url.searchParams.get("t0"));
        const t1 = t0 + BEHIND_MS;
        return Response.json({
          v: 1, id: url.searchParams.get("id"), t0, t1, t2: t1, precisionMs: 1,
          nextSyncAfterMs: 21_600_000, colo: "SJO",
        });
      }
      h.apiCalls.push(url.pathname);
      return Response.json({
        ok: true,
        ambiente: "00",
        emisor: { nit: "0614-010101-101-1", nombre: "Issuer", ambiente: "00" },
        llave: { keyId: "facta_test_x", label: null, modo: "byok", alcances: [], tiposDte: [], venceEl: null },
      });
    }) as typeof fetch,
  };
  return h;
}

/** An archive that records the timestamp the SDK stamps, then stops the flow. */
function recordingArchive(): { archive: InvoiceArchive; createdAt: () => string } {
  let stamped = "";
  const archive = {
    async assertReady() {},
    async begin(value: ArchiveOperation) {
      stamped = value.createdAt;
      throw new Error("stop after begin");
    },
  } as unknown as InvoiceArchive;
  return { archive, createdAt: () => stamped };
}

const request = {
  tipoDte: "03" as const,
  items: [{ descripcion: "Tea", cantidad: 1, precioUni: 1 }],
};

async function stampedBy(facta: Facta): Promise<number> {
  const recorder = recordingArchive();
  await assertRejects(() =>
    facta.issueAndArchive(request, { archive: recorder.archive, operationId: "op-1", idempotencyKey: "op-1" })
  );
  return Date.parse(recorder.createdAt());
}

Deno.test("clock is on by default, one instance per client, nothing calibrated at construction", () => {
  const h = harness();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  assertEquals(facta.clock !== null, true);
  assertEquals(facta.clock, facta.clock);
  assertEquals(h.clockCalls.length, 0);
  assertEquals(facta.clock!.state().status, "device");
  const other = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  assertEquals(other.clock === facta.clock, false);
});

Deno.test("clock: false disables it and archive records use the device clock", async () => {
  const h = harness();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch, clock: false });
  assertEquals(facta.clock, null);
  const before = Date.now();
  const stamp = await stampedBy(facta);
  assertEquals(stamp >= before && stamp <= Date.now(), true);
  assertEquals(h.clockCalls.length, 0);
});

Deno.test("a URL overrides the default endpoint", async () => {
  const h = harness();
  const facta = new Facta({
    apiKey: "facta_test_x.secret",
    fetch: h.fetch,
    clock: "https://clock-staging.factadte.com/",
  });
  await facta.clock!.calibrate();
  assertEquals(h.clockCalls[0], "https://clock-staging.factadte.com/");
});

Deno.test("the default endpoint is the public Worker", async () => {
  const h = harness();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  await facta.clock!.calibrate();
  assertEquals(h.clockCalls[0], DEFAULT_CLOCK_URL);
});

Deno.test("an invalid clock option is refused", () => {
  assertThrows(
    () => new Facta({ apiKey: "facta_test_x.secret", clock: 5 as unknown as boolean }),
    TypeError,
  );
});

Deno.test("archive timestamps come from the corrected clock, calibrated lazily on the first call", async () => {
  const h = harness();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  const before = Date.now();
  const stamp = await stampedBy(facta);
  assertEquals(h.clockCalls.length >= 3, true);
  // ≈ device time + 7 minutes
  assertEquals(Math.abs(stamp - (before + BEHIND_MS)) < 5_000, true);
});

Deno.test("a second operation does not call the Worker again", async () => {
  const h = harness();
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  await stampedBy(facta);
  const calls = h.clockCalls.length;
  await stampedBy(facta);
  await stampedBy(facta);
  assertEquals(h.clockCalls.length, calls);
});

Deno.test("an unreachable clock never fails the operation and falls back to the device clock", async () => {
  const h = harness({ clockDown: true });
  const facta = new Facta({ apiKey: "facta_test_x.secret", fetch: h.fetch });
  const before = Date.now();
  const stamp = await stampedBy(facta); // still reaches `begin`
  assertEquals(stamp >= before && stamp <= Date.now() + 1000, true);
  assertEquals(facta.clock!.state().status, "device");
});

Deno.test("clockFetch carries only the calibration", async () => {
  const h = harness();
  const clockOnly: string[] = [];
  const facta = new Facta({
    apiKey: "facta_test_x.secret",
    fetch: h.fetch,
    clockFetch: (async (input: string | URL | Request, init?: RequestInit) => {
      clockOnly.push(String(input));
      return await h.fetch(input, init);
    }) as typeof fetch,
  });
  await stampedBy(facta);
  assertEquals(clockOnly.length >= 3, true);
  assertEquals(clockOnly.every((url) => url.startsWith(DEFAULT_CLOCK_URL)), true);
});
