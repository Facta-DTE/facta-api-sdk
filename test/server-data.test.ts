import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  createFactaHandler,
  createFactaInvalidationSession,
  createFactaSession,
  type FactaAuthorizeContext,
  type FactaCapabilities,
  type FactaLike,
  maskDocumentNumber,
  verifyFactaInvalidationSession,
  verifyFactaSession,
} from "../server.ts";
import { FactaError } from "../src/errors.ts";

const SECRET = "x".repeat(48);
const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const CG2 = "9A3F2C71-5B80-4D16-A2E9-0C47D81B35F6";
const PERSON = { nombre: "Laura Ortiz", tipoDocumento: "13", numDocumento: "000000019" };
const LEAKS = ["facta_test_a.apikey", "factask_sign-key", "factauk_unlock-key", SECRET, "jws-never", "sha256-never", "bucket-never"];

const LISTED = {
  estado: "sellado",
  codigoGeneracion: CG,
  numeroControl: "DTE-01-M001P001-000000000000042",
  tipoDte: "01",
  fecEmi: "2026-10-05",
  horEmi: "09:52:00",
  selloRecibido: "2026SEAL",
  totales: { totalGravada: 100, totalIva: 13, totalPagar: 113, internal: "nope" },
  receptor: { nombre: "María Ejemplo", numDocumento: "000000019", correo: "private@example.test" },
  jws: "jws-never",
};

function fake(patch: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = <T>(method: string, value: T) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve(value);
  };
  const facta = {
    issue: rec("issue", {}),
    environment: "00",
    getDocumentStatus: rec("getDocumentStatus", { ...LISTED, ambiente: "00", observaciones: ["ok"], motivo: { raw: "x" } }),
    listDocuments: rec("listDocuments", { documentos: [LISTED], siguiente: "cur-2" }),
    downloadDocument: rec("downloadDocument", { bytes: new Uint8Array([37, 80, 68, 70]), filename: "../../etc/pa ss.pdf", contentType: "application/pdf", storageSource: "bucket-never" }),
    getDocumentCopies: rec("getDocumentCopies", [{ generationCode: CG, kind: "json", environment: "00", state: "stored", bytes: 10, sha256: "sha256-never", issuedDate: "2026-10-05", storedAt: "2026-10-05T10:00:00Z" }]),
    retryDocumentStorage: rec("retryDocumentStorage", { destination: "managed", environment: "00", operationId: "op", json: { state: "stored" }, pdf: { state: "pending" } }),
    listHolding: rec("listHolding", { documentos: [{ codigoGeneracion: CG, ambiente: "00", whereLanded: "holding", gaveUp: false, attempts: 2, expiresAt: "2026-10-06T00:00:00Z", downloadCount: 0, createdAt: "x" }] }),
    searchCustomers: rec("searchCustomers", [{ id: "c1", name: "Ferretería San Miguel", doc_type: "36", doc_number: "06142103891024", nrc: "1234567", email: "hide@example.test", address: { complemento: "hide" } }]),
    getCustomer: (id: string) => Promise.resolve(id === "c1" ? { id: "c1", name: "Ferretería San Miguel", doc_type: "36", doc_number: "06142103891024" } : null),
    searchProducts: rec("searchProducts", [
      { id: "p1", code: "DIS-114", description: "Disco", unit_price: 2.85, vat_included: true, barcode: "hide" },
      { id: "p2", code: "OLD", description: "Viejo", unit_price: 1, active: false },
    ]),
    getProduct: () => Promise.resolve(null),
    status: rec("status", { ok: true }),
    diagnose: rec("diagnose", { overall: "ready", checks: [{ id: "api", state: "ok", message: "x" }] }),
    getStorageStatus: rec("getStorageStatus", {
      capabilityVersion: 1,
      managed: { configured: true, ready: true, state: "ready", integration: "ready", quotaBytes: 5000, usedBytes: 1200, reservedBytes: 0, usedBytesTotal: 1, reservedBytesTotal: 1, coveredUntil: null, accessUntil: null, bucketState: "bucket-never", backupState: null },
      byos: { ready: false },
      supportedKinds: ["json"],
      unsupportedKinds: [],
    }),
    invalidate: rec("invalidate", {
      estado: "invalidado", codigoGeneracion: CG, numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: "00",
      evento: { codigoGeneracion: CG2, selloRecibido: "EVSEAL", fhProcesamiento: "2026-10-05T11:30:00", tipoAnulacion: 2 },
      documento: {}, jws: "jws-never", anotadoEnElIndice: true,
    }),
    ...patch,
  } as unknown as FactaLike;
  return { facta, calls };
}

const ALL: FactaCapabilities = { documents: "read", downloads: true, catalog: "read", status: true, storage: "read", retryStorage: true, invalidate: "session" };

function make(options: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) {
  const f = fake(patch);
  const handler = createFactaHandler({ facta: f.facta, sessionSecret: SECRET, authorize: () => true, capabilities: ALL, ...options } as never);
  return { handler, ...f };
}

function post(handler: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string | null> = {}) {
  const h: Record<string, string> = { "content-type": "application/json", "x-facta-ui": "1" };
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  return handler(new Request("https://shop.test/api/facta", { method: "POST", headers: h, body: JSON.stringify(body) }));
}

async function ok(handler: (r: Request) => Promise<Response>, body: unknown) {
  const res = await post(handler, body);
  const text = await res.text();
  assertEquals(res.status, 200, text);
  for (const leak of LEAKS) assert(!text.includes(leak), `response leaks ${leak}`);
  return JSON.parse(text);
}

Deno.test("capabilities default to nothing: every data action is action_not_allowed", async () => {
  const { handler } = make({ capabilities: undefined });
  for (const action of ["documents.list", "documents.get", "documents.download", "documents.copies", "documents.retryStorage", "documents.holding", "catalog.customers.search", "catalog.products.get", "service.status", "storage.status"]) {
    const res = await post(handler, { action, codigoGeneracion: CG, kind: "pdf", query: "ab", id: "c1" });
    assertEquals(res.status, 403, action);
    assertEquals((await res.json()).error.code, "action_not_allowed", action);
  }
  const res = await post(handler, { action: "invalidate", session: "x" });
  assertEquals(res.status, 403);
});

Deno.test("each capability unlocks only its own actions", async () => {
  const { handler } = make({ capabilities: { documents: "read" } });
  assertEquals((await post(handler, { action: "documents.list" })).status, 200);
  assertEquals((await post(handler, { action: "documents.download", codigoGeneracion: CG, kind: "pdf" })).status, 403);
  assertEquals((await post(handler, { action: "catalog.customers.search", query: "fe" })).status, 403);
  assertEquals((await post(handler, { action: "service.status" })).status, 403);
  assertEquals((await post(handler, { action: "documents.retryStorage", codigoGeneracion: CG })).status, 403);
});

Deno.test("invalid capabilities are refused at construction", () => {
  const { facta } = fake();
  const base = { facta, sessionSecret: SECRET, authorize: "session-only" as const };
  assertThrows(() => createFactaHandler({ ...base, capabilities: { documents: "write" } as never }), TypeError);
  assertThrows(() => createFactaHandler({ ...base, capabilities: { nuke: true } as never }), TypeError);
  assertThrows(() => createFactaHandler({ ...base, capabilities: { downloads: ["exe"] } as never }), TypeError);
});

Deno.test("reads need the CSRF header and JSON, and authorize sees the action", async () => {
  const seen: FactaAuthorizeContext[] = [];
  const { handler } = make({ authorize: (_r: Request, c: FactaAuthorizeContext) => { seen.push(c); return c.action !== "documents.holding"; } });
  assertEquals((await post(handler, { action: "documents.list" }, { "x-facta-ui": null })).status, 400);
  assertEquals((await post(handler, { action: "documents.list" }, { "content-type": "text/plain" })).status, 415);
  assertEquals((await post(handler, { action: "documents.list" })).status, 200);
  assertEquals((await post(handler, { action: "documents.holding" })).status, 403);
  assertEquals(seen.map((s) => s.action), ["documents.list", "documents.holding"]);
  assertEquals(seen[0].session, undefined);
});

Deno.test("authorize throwing is 401 for reads", async () => {
  const { handler } = make({ authorize: () => { throw new Error("db"); } });
  assertEquals((await post(handler, { action: "documents.list" })).status, 401);
});

Deno.test("issue sessions still pass the legacy session fields to authorize", async () => {
  let key = "";
  const { handler } = make({ authorize: (_r: Request, c: FactaAuthorizeContext) => { key = c.idempotencyKey ?? ""; return true; } });
  const token = await createFactaSession({ request: { tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] }, idempotencyKey: "order-9" }, SECRET);
  await post(handler, { action: "session.describe", session: token });
  assertEquals(key, "order-9");
});

Deno.test("documents.list projects fields, hides the receiver by default and bounds the filters", async () => {
  const { handler, calls } = make();
  const body = await ok(handler, { action: "documents.list", desde: "2026-10-01", estado: "sellado", limit: 10, cursor: "c1" });
  assertEquals(body.siguiente, "cur-2");
  const row = body.documentos[0];
  assertEquals(row.totales, { totalGravada: 100, totalIva: 13, totalPagar: 113 });
  assert(!("receptor" in row) && !("jws" in row));
  assertEquals(calls[0].args[0], { desde: "2026-10-01", estado: "sellado", limit: 10, cursor: "c1" });
  for (const bad of [{ desde: "yesterday" }, { estado: "rechazado" }, { tipoDte: "99" }, { limit: 1000 }, { cursor: 5 }]) {
    assertEquals((await post(handler, { action: "documents.list", ...bad })).status, 400, JSON.stringify(bad));
  }
});

Deno.test("exposeRecipient adds the name and a masked document, never the rest", async () => {
  const { handler } = make({ exposeRecipient: true });
  const row = (await ok(handler, { action: "documents.list" })).documentos[0];
  assertEquals(row.receptor, { nombre: "María Ejemplo", numDocumento: "0000 ••••• 9" });
  assert(!JSON.stringify(row).includes("private@example.test"));
  const doc = (await ok(handler, { action: "documents.get", codigoGeneracion: CG })).document;
  assertEquals(doc.receptor.nombre, "María Ejemplo");
});

Deno.test("scope forces filters over whatever the browser sends", async () => {
  const { handler, calls } = make({ scope: () => ({ tipoDte: "03", desde: "2026-10-03" }) });
  await ok(handler, { action: "documents.list", tipoDte: "01", desde: "2020-01-01", hasta: "2026-10-05" });
  assertEquals(calls[0].args[0], { desde: "2026-10-03", hasta: "2026-10-05", tipoDte: "03", limit: 25 });
});

Deno.test("documents.get returns a projection and refuses a malformed code", async () => {
  const { handler } = make();
  const doc = (await ok(handler, { action: "documents.get", codigoGeneracion: CG.toLowerCase() })).document;
  assertEquals(doc.codigoGeneracion, CG);
  assert(!("motivo" in doc));
  assertEquals((await post(handler, { action: "documents.get", codigoGeneracion: "../x" })).status, 400);
});

Deno.test("documents.download returns base64, a safe filename and honours the kind allow-list and size cap", async () => {
  const { handler } = make({ capabilities: { downloads: ["pdf"] } });
  const { file } = await ok(handler, { action: "documents.download", codigoGeneracion: CG, kind: "pdf" });
  assertEquals(file.base64, "JVBERg==");
  assertEquals(file.contentType, "application/pdf");
  assert(/^[\w.\-]+$/.test(file.filename) && !file.filename.includes("/"), file.filename);
  assertEquals((await post(handler, { action: "documents.download", codigoGeneracion: CG, kind: "json" })).status, 403);
  assertEquals((await post(handler, { action: "documents.download", codigoGeneracion: CG, kind: "exe" })).status, 400);
  const tiny = make({ maxDownloadBytes: 2 });
  const res = await post(tiny.handler, { action: "documents.download", codigoGeneracion: CG, kind: "pdf" });
  assertEquals(res.status, 413);
  assertEquals((await res.json()).error.code, "payload_too_large");
  const ticket = make();
  await ok(ticket.handler, { action: "documents.download", codigoGeneracion: CG, kind: "ticket", paperWidthMm: 58 });
  assertEquals(ticket.calls.at(-1)!.args[2], { paperWidthMm: 58 });
  assertEquals((await post(ticket.handler, { action: "documents.download", codigoGeneracion: CG, kind: "pdf", paperWidthMm: 58 })).status, 400);
});

Deno.test("copies, retry and holding expose states only", async () => {
  const { handler } = make();
  assertEquals((await ok(handler, { action: "documents.copies", codigoGeneracion: CG })).copies[0], { kind: "json", state: "stored", bytes: 10, storedAt: "2026-10-05T10:00:00Z", environment: "00" });
  assertEquals((await ok(handler, { action: "documents.retryStorage", codigoGeneracion: CG })).storage, { json: "stored", pdf: "pending" });
  assertEquals((await ok(handler, { action: "documents.holding" })).documentos[0].attempts, 2);
});

Deno.test("catalog: display projection, masked numbers by default, inactive products dropped", async () => {
  const masked = make();
  const c = (await ok(masked.handler, { action: "catalog.customers.search", query: "ferre" })).items[0];
  assertEquals(c, { id: "c1", name: "Ferretería San Miguel", docType: "NIT", docNumber: "0614 ••••• 4", nrc: "1234 ••••• 7" });
  const open = make({ exposeRecipient: true });
  assertEquals((await ok(open.handler, { action: "catalog.customers.get", id: "c1" })).item.docNumber, "0614-210389-102-4");
  const products = (await ok(masked.handler, { action: "catalog.products.search", query: "dis" })).items;
  assertEquals(products, [{ id: "p1", code: "DIS-114", description: "Disco", price: 2.85, vatIncluded: true }]);
  assertEquals((await post(masked.handler, { action: "catalog.products.get", id: "zz" })).status, 404);
  assertEquals((await post(masked.handler, { action: "catalog.customers.search", query: "" })).status, 400);
});

Deno.test("service.status maps diagnose, detects the contingency queue and caches briefly", async () => {
  const online = make({}, { listDocuments: () => Promise.resolve({ documentos: [], siguiente: null }) });
  assertEquals((await ok(online.handler, { action: "service.status" })).state, "online");
  await ok(online.handler, { action: "service.status" });
  assertEquals(online.calls.filter((c) => c.method === "diagnose").length, 1);
  const queued = make();
  assertEquals((await ok(queued.handler, { action: "service.status" })).state, "contingency");
  const down = make({}, { diagnose: () => Promise.reject(new FactaError("network_error", "down", 0)) });
  assertEquals((await ok(down.handler, { action: "service.status" })).state, "offline");
  const degraded = make({}, { diagnose: () => Promise.resolve({ overall: "attention", checks: [{ id: "api", state: "ok" }] }), listDocuments: () => Promise.resolve({ documentos: [] }) });
  assertEquals((await ok(degraded.handler, { action: "service.status" })).state, "degraded");
  const apiBlocked = make({}, { diagnose: () => Promise.resolve({ overall: "blocked", checks: [{ id: "api", state: "blocked" }] }) });
  assertEquals((await ok(apiBlocked.handler, { action: "service.status" })).state, "offline");
});

Deno.test("storage.status omits bucket and backup internals", async () => {
  const { handler } = make();
  const s = (await ok(handler, { action: "storage.status" })).storage;
  assertEquals(s.quotaBytes, 5000);
  assertEquals(s.usedBytes, 1200);
  assert(!("bucketState" in s));
});

Deno.test("API errors on reads keep their code and status", async () => {
  const { handler } = make({}, { listDocuments: () => Promise.reject(new FactaError("service_unavailable", "down", 503)) });
  const res = await post(handler, { action: "documents.list" });
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error.code, "service_unavailable");
  assertEquals(body.error.retryable, true);
});

Deno.test("invalidation session validates its data and does not verify as an issue session", async () => {
  const base = { generationCode: CG, tipoAnulacion: 2 as const, responsable: PERSON, solicita: PERSON };
  const token = await createFactaInvalidationSession(base, SECRET);
  const s = await verifyFactaInvalidationSession(token, SECRET);
  assertEquals(s.idempotencyKey, `invalidate:${CG}`);
  let threw = false;
  try { await verifyFactaSession(token, SECRET); } catch { threw = true; }
  assert(threw, "an invalidation token must not verify as an issue session");
  threw = false;
  const issue = await createFactaSession({ request: { tipoDte: "01", items: [] }, idempotencyKey: "o" }, SECRET);
  try { await verifyFactaInvalidationSession(issue, SECRET); } catch { threw = true; }
  assert(threw, "an issue token must not verify as an invalidation session");
  for (const bad of [{ tipoAnulacion: 1 }, { tipoAnulacion: 3 }, { tipoAnulacion: 2, codigoGeneracionReemplazo: CG2 }, { generationCode: "x" }, { responsable: { nombre: "a" } }]) {
    let rejected = false;
    try { await createFactaInvalidationSession({ ...base, ...bad } as never, SECRET); } catch (e) { rejected = e instanceof TypeError; }
    assert(rejected, JSON.stringify(bad));
  }
  await createFactaInvalidationSession({ ...base, tipoAnulacion: 1, codigoGeneracionReemplazo: CG2 }, SECRET);
  await createFactaInvalidationSession({ ...base, tipoAnulacion: 3, motivo: "Duplicado" }, SECRET);
});

Deno.test("invalidate.describe shows the session's data; invalidate runs it once with a stable key", async () => {
  const events: unknown[] = [];
  const { handler, calls } = make({ onEvent: (e: unknown) => { events.push(e); } });
  const token = await createFactaInvalidationSession({ generationCode: CG, tipoAnulacion: 2, responsable: PERSON, solicita: PERSON }, SECRET);
  const described = await ok(handler, { action: "invalidate.describe", session: token });
  assertEquals(described.invalidation.tipoAnulacion, 2);
  assertEquals(described.document.codigoGeneracion, CG);
  const done = await ok(handler, { action: "invalidate", session: token, tipoAnulacion: 1, motivo: "browser-injected" });
  assertEquals(done.result.evento, { codigoGeneracion: CG2, selloRecibido: "EVSEAL", fhProcesamiento: "2026-10-05T11:30:00", tipoAnulacion: 2 });
  const call = calls.find((c) => c.method === "invalidate")!;
  assertEquals(call.args[0], CG);
  assertEquals((call.args[1] as { tipoAnulacion: number; motivo: unknown }).tipoAnulacion, 2);
  assertEquals((call.args[1] as { motivo: unknown }).motivo, null);
  assertEquals(call.args[2], { idempotencyKey: `invalidate:${CG}` });
  await new Promise((r) => setTimeout(r, 0));
  assert(events.some((e) => (e as { type: string }).type === "invalidated"));
});

Deno.test("invalidate uses invalidateAndArchive when an invalidation archive is configured", async () => {
  const archived: unknown[] = [];
  const { handler } = make({}, {
    invalidationArchiveConfigured: true,
    invalidateAndArchive: (cg: string, _req: unknown, o: unknown) => {
      archived.push([cg, o]);
      return Promise.resolve({ invalidation: { estado: "invalidado", codigoGeneracion: CG, numeroControl: "n", yaEstabaInvalidado: true }, archive: { state: "complete", operationId: "o" } });
    },
  });
  const token = await createFactaInvalidationSession({ generationCode: CG, tipoAnulacion: 2, responsable: PERSON, solicita: PERSON }, SECRET);
  const done = await ok(handler, { action: "invalidate", session: token });
  assertEquals(done.result.yaEstabaInvalidado, true);
  assertEquals(archived.length, 1);
});

Deno.test("invalidate is gated by capability, authorize and the token", async () => {
  const token = await createFactaInvalidationSession({ generationCode: CG, tipoAnulacion: 2, responsable: PERSON, solicita: PERSON }, SECRET);
  const off = make({ capabilities: { documents: "read" } });
  assertEquals((await post(off.handler, { action: "invalidate", session: token })).status, 403);
  const cashier = make({ authorize: (_r: Request, c: FactaAuthorizeContext) => c.action !== "invalidate" });
  assertEquals((await post(cashier.handler, { action: "documents.list" })).status, 200);
  assertEquals((await post(cashier.handler, { action: "invalidate", session: token })).status, 403);
  const { handler } = make();
  const res = await post(handler, { action: "invalidate", session: token.slice(0, -2) + "xx" });
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, "session_invalid");
  assertEquals((await post(handler, { action: "invalidate" })).status, 401);
});

Deno.test("a Hacienda rejection of an invalidation is passed through verbatim", async () => {
  const msg = "[095] El documento no se encuentra dentro del plazo de anulación";
  const { handler } = make({}, {
    invalidate: () => Promise.reject(new FactaError("mh_rejected", msg, 422, { observaciones: [msg] })),
  });
  const token = await createFactaInvalidationSession({ generationCode: CG, tipoAnulacion: 2, responsable: PERSON, solicita: PERSON }, SECRET);
  const res = await post(handler, { action: "invalidate", session: token });
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.message, msg);
});

Deno.test("maskDocumentNumber hides all but the edges", () => {
  assertEquals(maskDocumentNumber("05308546-5"), "0530 ••••• 5");
  assertEquals(maskDocumentNumber("123"), "•••••");
  assertEquals(maskDocumentNumber(null), null);
});
