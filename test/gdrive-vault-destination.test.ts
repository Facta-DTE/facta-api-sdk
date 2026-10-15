import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import { buildSyncedDestinations, prepareDriveTokens } from "../src/byos-copies.ts";
import { DriveTokenBroker, type DriveTokenGrant } from "../src/drive-token.ts";
import type { ArchiveArtifact } from "../src/archive.ts";

const DRIVE_ID = "d4437815-0000-4000-8000-000000000001";
const OTHER_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY = { numeroControl: "DTE-01-M001P001-000000000000268", fecEmi: "2026-10-03" };
const CANONICAL_PDF = `DTE/pruebas/2026/10/${IDENTITY.numeroControl}.pdf`;
const bytes = new TextEncoder().encode("exact invoice bytes");

async function artifact(): Promise<ArchiveArtifact> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
    kind: "pdf",
    filename: "x.pdf",
    contentType: "application/pdf",
    bytes,
    sha256: Array.from(digest, (v) => v.toString(16).padStart(2, "0")).join(""),
  };
}

const driveEntry = (config: Record<string, unknown>) => ({
  id: DRIVE_ID,
  kind: "gdrive",
  label: "Company Drive",
  secret: JSON.stringify({ folderId: "root-folder", ...config }),
});

/** A Drive that accepts exactly the bearer tokens in `valid` and records uploaded folder paths. */
function fakeDrive(valid: Set<string>) {
  const folders = new Map<string, string>();
  const files = new Map<string, { path: string; appProperties: Record<string, string> }>();
  const seenBearers: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const bearer = new Headers(init?.headers).get("authorization") ?? "";
    seenBearers.push(bearer);
    if (!valid.has(bearer.replace("Bearer ", ""))) return new Response("denied", { status: 401 });
    if (method === "GET" && url.pathname.endsWith("/files") && url.searchParams.get("alt") !== "media") {
      const query = url.searchParams.get("q") ?? "";
      if (query.includes("appProperties has")) {
        const key = query.match(/value='([0-9a-f]+)'/)?.[1];
        return Response.json({ files: [...files.entries()].filter(([, f]) => f.appProperties.factaArtifactPath === key).map(([id, f]) => ({ id, appProperties: f.appProperties })) });
      }
      const m = query.match(/name = '((?:\\.|[^'])*)' and '([^']+)' in parents/);
      if (m) {
        const id = folders.get(`${m[2]}\0${m[1]}`);
        return Response.json({ files: id ? [{ id, name: m[1], mimeType: "application/vnd.google-apps.folder" }] : [] });
      }
      throw new Error("unexpected query " + query);
    }
    if (method === "POST" && url.pathname.endsWith("/upload/drive/v3/files")) {
      const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
      const text = new TextDecoder().decode(body.slice(0, 1500));
      const metadata = JSON.parse(text.match(/\r\n\r\n(\{.*?\})\r\n--/s)![1]) as { appProperties: Record<string, string> };
      const id = `file-${files.size + 1}`;
      files.set(id, { path: [...folders.keys()].join("|"), appProperties: metadata.appProperties });
      return Response.json({ id });
    }
    if (method === "POST" && url.pathname.endsWith("/files")) {
      const body = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
      const id = `folder-${folders.size + 1}`;
      folders.set(`${body.parents[0]}\0${body.name}`, id);
      return Response.json({ id });
    }
    if (method === "GET" && url.searchParams.get("alt") === "media") {
      return files.has(url.pathname.split("/").at(-1)!) ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { fetch: fetcher, folders, files, seenBearers };
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function fixedFetcher(c: { now: () => number }, log: Array<{ id: string; refreshToken: string }>, extra: Partial<DriveTokenGrant> = {}) {
  let n = 0;
  return async (id: string, refreshToken: string): Promise<DriveTokenGrant> => {
    log.push({ id, refreshToken });
    await new Promise((resolve) => setTimeout(resolve, 5));
    n++;
    return { accessToken: `tok-${n}`, expiresAt: c.now() + 3_600_000, ...extra };
  };
}

Deno.test("a Drive with a long key is written at the canonical path with a brokered token", async () => {
  const c = clock();
  const log: Array<{ id: string; refreshToken: string }> = [];
  const broker = new DriveTokenBroker(fixedFetcher(c, log), c.now);
  const drive = fakeDrive(new Set(["tok-1"]));
  const snapshot = { destinos: [driveEntry({ refreshToken: "long-key" })] };
  await prepareDriveTokens(snapshot, broker);
  const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, fetch: drive.fetch, drive: broker });
  assertEquals(built.skipped, []);
  assertEquals(built.destinations.length, 1);
  assertEquals(built.destinations[0]!.canonicalCopy?.pdfPath, CANONICAL_PDF);
  assertEquals(await built.destinations[0]!.write(await artifact()), "stored");
  assertEquals(log, [{ id: DRIVE_ID, refreshToken: "long-key" }]);
  const folderNames = [...drive.folders.keys()].map((key) => key.split("\0")[1]);
  assertEquals(folderNames, ["DTE", "pruebas", "2026", "10"]);
  assert(drive.seenBearers.every((b) => b === "Bearer tok-1"));
});

Deno.test("twelve concurrent artifacts make one route call, with or without a prepared token", async () => {
  for (const prepared of [true, false]) {
    const c = clock();
    const log: Array<{ id: string; refreshToken: string }> = [];
    const broker = new DriveTokenBroker(fixedFetcher(c, log), c.now);
    const drive = fakeDrive(new Set(["tok-1"]));
    const snapshot = { destinos: [driveEntry({ refreshToken: "long-key" })] };
    if (prepared) await prepareDriveTokens(snapshot, broker);
    const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, fetch: drive.fetch, drive: broker });
    const dest = built.destinations[0]!;
    const states = await Promise.all(Array.from({ length: 12 }, async () => dest.write(await artifact())));
    assertEquals(states, Array(12).fill("stored"));
    assertEquals(log.length, 1, `prepared=${prepared}`);
  }
});

Deno.test("a still-valid access token from the vault secret needs no route call", async () => {
  const c = clock();
  const log: Array<{ id: string; refreshToken: string }> = [];
  const broker = new DriveTokenBroker(fixedFetcher(c, log), c.now);
  const drive = fakeDrive(new Set(["from-vault"]));
  const snapshot = { destinos: [driveEntry({ refreshToken: "long-key", accessToken: "from-vault", expiresAt: c.now() + 30 * 60_000 })] };
  await prepareDriveTokens(snapshot, broker);
  const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, fetch: drive.fetch, drive: broker });
  assertEquals(await built.destinations[0]!.write(await artifact()), "stored");
  assertEquals(log.length, 0);
});

Deno.test("the token is renewed 60 s before it dies and a rotated long key is used next", async () => {
  const c = clock();
  const log: Array<{ id: string; refreshToken: string }> = [];
  let n = 0;
  const broker = new DriveTokenBroker(async (id, refreshToken) => {
    log.push({ id, refreshToken });
    n++;
    return { accessToken: `tok-${n}`, expiresAt: c.now() + 3_600_000, refreshToken: `rotated-${n}` };
  }, c.now);
  broker.seed(DRIVE_ID, { refreshToken: "long-key" });
  assertEquals(await broker.token(DRIVE_ID), "tok-1");
  c.advance(3_600_000 - 61_000);
  assertEquals(await broker.token(DRIVE_ID), "tok-1", "still inside the margin");
  c.advance(2_000);
  assertEquals(await broker.token(DRIVE_ID), "tok-2");
  assertEquals(log.map((row) => row.refreshToken), ["long-key", "rotated-1"]);
  broker.seed(DRIVE_ID, { refreshToken: "long-key" });
  c.advance(3_600_000);
  await broker.token(DRIVE_ID);
  assertEquals(log.at(-1)!.refreshToken, "rotated-2", "re-reading the same vault entry keeps the rotated key");
});

Deno.test("a 401 from Drive forces one renewal and the write still lands", async () => {
  const c = clock();
  const log: Array<{ id: string; refreshToken: string }> = [];
  const broker = new DriveTokenBroker(fixedFetcher(c, log), c.now);
  // Google revoked tok-1 early; only tok-2 works.
  const drive = fakeDrive(new Set(["tok-2"]));
  const snapshot = { destinos: [driveEntry({ refreshToken: "long-key" })] };
  await prepareDriveTokens(snapshot, broker);
  c.advance(11_000);
  const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, fetch: drive.fetch, drive: broker });
  assertEquals(await built.destinations[0]!.write(await artifact()), "stored");
  assertEquals(log.length, 2);
});

Deno.test("a Drive without a long key is skipped with a reason that says what to do", () => {
  const broker = new DriveTokenBroker(async () => { throw new Error("must not be called"); });
  for (const config of [{ accessToken: "short" }, { refreshToken: "   " }]) {
    const built = buildSyncedDestinations({ destinos: [driveEntry(config)] }, { environment: "00", identity: IDENTITY, drive: broker });
    assertEquals(built.destinations, []);
    assertEquals(built.skipped.length, 1);
    assertStringIncludes(built.skipped[0]!.reason, "«Confirmar en Google»");
    assertStringIncludes(built.skipped[0]!.reason, "no long key");
  }
});

Deno.test("a revoked long key is reported with its code and never blocks the other destinations", async () => {
  const broker = new DriveTokenBroker(async () => {
    throw new FactaError("drive_reauthorization_required", "revoked", 409);
  });
  const s3 = { id: OTHER_ID, kind: "s3", label: "Bucket", secret: JSON.stringify({ bucket: "b", region: "us-east-1", accessKeyId: "A", secretAccessKey: "S" }) };
  const snapshot = { destinos: [driveEntry({ refreshToken: "long-key" }), s3] };
  await prepareDriveTokens(snapshot, broker);
  const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, drive: broker });
  assertEquals(built.destinations.map((d) => d.id), [OTHER_ID]);
  assertEquals(built.skipped.length, 1);
  assertStringIncludes(built.skipped[0]!.reason, "drive_reauthorization_required");
  assertEquals(built.skipped[0]!.destinationId, DRIVE_ID);
});

Deno.test("without a prepared token a failing renewal makes the write unavailable instead of throwing", async () => {
  for (const code of ["drive_not_configured", "drive_token_failed"] as const) {
    const broker = new DriveTokenBroker(async () => { throw new FactaError(code, "no", code === "drive_token_failed" ? 502 : 503); });
    const drive = fakeDrive(new Set());
    const built = buildSyncedDestinations({ destinos: [driveEntry({ refreshToken: "long-key" })] }, {
      environment: "00", identity: IDENTITY, fetch: drive.fetch, drive: broker,
    });
    assertEquals(await built.destinations[0]!.write(await artifact()), "unavailable");
    assertEquals(broker.failure(DRIVE_ID), code);
    assertEquals(drive.seenBearers.length, 0, "Drive is never called without a token");
  }
});

Deno.test("transient failures are retried on the next attempt; permanent ones are not", async () => {
  let calls = 0;
  const broker = new DriveTokenBroker(async () => {
    calls++;
    if (calls === 1) throw new FactaError("drive_token_failed", "x", 502);
    return { accessToken: "ok", expiresAt: Date.now() + 3_600_000 };
  });
  broker.seed(DRIVE_ID, { refreshToken: "k" });
  await assertRejects(() => broker.token(DRIVE_ID));
  assertEquals(await broker.token(DRIVE_ID), "ok");
  assertEquals(broker.failure(DRIVE_ID), undefined);

  let revoked = 0;
  const dead = new DriveTokenBroker(async () => { revoked++; throw new FactaError("drive_reauthorization_required", "x", 409); });
  dead.seed(DRIVE_ID, { refreshToken: "k" });
  await assertRejects(() => dead.token(DRIVE_ID));
  await assertRejects(() => dead.token(DRIVE_ID));
  assertEquals(revoked, 1);
  dead.seed(DRIVE_ID, { refreshToken: "reconfirmed-in-the-app" });
  await assertRejects(() => dead.token(DRIVE_ID));
  assertEquals(revoked, 2, "a different long key starts over");
});

Deno.test("client.driveToken posts the long key to the route and maps every failure code", async () => {
  const calls: Array<{ url: string; method: string; key: string | null; body: unknown }> = [];
  let reply: () => Response = () => Response.json({ accessToken: "at", expiresIn: 3599, expiresAt: "2026-10-15T20:00:00.000Z", refreshToken: "new-rt" });
  const facta = new Facta({
    region: false,
    apiKey: "facta_test_x.secret",
    maxRetries: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input), method: init?.method ?? "GET",
        key: new Headers(init?.headers).get("x-facta-key"), body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return reply();
    }) as typeof fetch,
  });
  const ok = await facta.driveToken(DRIVE_ID, "long-key");
  assertEquals(ok, { accessToken: "at", expiresIn: 3599, expiresAt: "2026-10-15T20:00:00.000Z", refreshToken: "new-rt" });
  assertEquals(calls.length, 1);
  assert(calls[0]!.url.endsWith(`/v1/destinations/${DRIVE_ID}/drive-token`));
  assertEquals(calls[0]!.method, "POST");
  assertEquals(calls[0]!.key, "facta_test_x.secret");
  assertEquals(calls[0]!.body, { refreshToken: "long-key" });

  const cases: Array<[number, string]> = [
    [409, "drive_reauthorization_required"],
    [503, "drive_not_configured"],
    [502, "drive_token_failed"],
    [404, "not_found"],
    [429, "rate_limited"],
  ];
  for (const [status, code] of cases) {
    reply = () => Response.json({ error: { code, message: "es-SV message" } }, { status });
    const error = await assertRejects(() => facta.driveToken(DRIVE_ID, "long-key"), FactaError);
    assertEquals([error.code, error.status], [code, status]);
  }
  await assertRejects(() => facta.driveToken("not-a-uuid", "k"), TypeError);
  await assertRejects(() => facta.driveToken(DRIVE_ID, ""), TypeError);
});

Deno.test("the long key and access tokens never appear in errors or skip reasons", async () => {
  const broker = new DriveTokenBroker(async () => { throw new Error("boom long-key-secret"); });
  const snapshot = { destinos: [driveEntry({ refreshToken: "long-key-secret" })] };
  await prepareDriveTokens(snapshot, broker);
  const built = buildSyncedDestinations(snapshot, { environment: "00", identity: IDENTITY, drive: broker });
  assertEquals(built.skipped.some((s) => s.reason.includes("long-key-secret")), false);
});
