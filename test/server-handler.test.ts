import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import type { IssueResult } from "../src/types.ts";
import {
  createFactaHandler,
  createFactaSession,
  type CreateFactaSessionInput,
  extractFieldIssues,
  type FactaHandlerEvent,
  type FactaLike,
  toNodeHandler,
} from "../server.ts";

const SECRET = "x".repeat(48);
const API_KEY = "facta_test_a.apikey-must-never-leak";
const SIGN_KEY = "factask_sign-key-must-never-leak";
const UNLOCK_KEY = "factauk_unlock-key-must-never-leak";
const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";

const SEALED = {
  estado: "sellado",
  codigoGeneracion: CG,
  numeroControl: "DTE-01-M001P001-000000000000175",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "10:00:00",
  selloRecibido: "2026ABC",
  fhProcesamiento: null,
  observaciones: [],
  totales: { totalPagar: 11.3 },
  documento: { identificacion: { numeroControl: "x" } },
  jws: "header.payload.sig",
  archivoJson: "{\"json\":true}",
  representacionGrafica: "UERG",
};
const CONTINGENCY = {
  estado: "contingencia",
  codigoGeneracion: CG,
  numeroControl: "DTE-01-M001P001-000000000000176",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "10:00:00",
  detalle: "Hacienda no respondió",
  documento: {},
  jws: "h.p.s",
  archivoJson: "{}",
};
const REQUEST = {
  tipoDte: "01" as const,
  items: [{ descripcion: "Plan", cantidad: 1, precioUni: 10 }],
};

interface Call {
  method: string;
  request?: unknown;
  key?: string;
  code?: string;
}

function fakeFacta(answers: { issue?: unknown; status?: unknown } = {}) {
  const calls: Call[] = [];
  const facta: FactaLike = {
    issue: (request, options) => {
      calls.push({ method: "issue", request, key: options?.idempotencyKey });
      return Promise.resolve((answers.issue ?? SEALED) as IssueResult);
    },
    getDocumentStatus: (code) => {
      calls.push({ method: "status", code });
      return Promise.resolve((answers.status ?? { ...SEALED, receptor: { nombre: "secret person" }, motivo: "m" }) as never);
    },
  };
  return { facta, calls };
}

function session(patch: Partial<CreateFactaSessionInput> = {}): Promise<string> {
  return createFactaSession({
    request: REQUEST,
    idempotencyKey: "order-1",
    ...patch,
  }, SECRET);
}

function post(
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  init: { headers?: Record<string, string | null>; method?: string; raw?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-facta-ui": "1" };
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return handler(new Request("https://shop.test/api/facta", {
    method: init.method ?? "POST",
    headers,
    body: init.method === "GET" ? undefined : (init.raw ?? JSON.stringify(body)),
  }));
}

function make(options: Partial<Parameters<typeof createFactaHandler>[0]> = {}, answers = {}) {
  const fake = fakeFacta(answers);
  const handler = createFactaHandler({ facta: fake.facta, sessionSecret: SECRET, authorize: "session-only", ...options });
  return { handler, ...fake };
}

Deno.test("authorize is required at construction", () => {
  const { facta } = fakeFacta();
  assertThrows(() => createFactaHandler({ facta, sessionSecret: SECRET } as never), TypeError, "authorize");
  assertThrows(() => createFactaHandler({ facta, sessionSecret: SECRET, authorize: "anything" } as never), TypeError);
  assertThrows(() => createFactaHandler({ facta, sessionSecret: "short", authorize: "session-only" }), TypeError);
});

Deno.test("session.describe returns the draft without calling the API", async () => {
  const { handler, calls } = make();
  const res = await post(handler, { action: "session.describe", session: await session({ display: { total: 11.3, title: "Plan" } }) });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.draft, REQUEST);
  assertEquals(body.download, true);
  assertEquals(body.display, { total: 11.3, title: "Plan" });
  assert(typeof body.expiresAt === "string");
  assertEquals("allow" in body || "mode" in body, false);
  assertEquals(calls.length, 0);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
});

Deno.test("a tampered or foreign session is session_invalid; an expired one session_expired", async () => {
  const { handler, calls } = make();
  const token = await session();
  const res = await post(handler, { action: "issue", session: token.slice(0, -3) + "AAA" });
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error.code, "session_invalid");
  const expired = await createFactaSession({ request: REQUEST, idempotencyKey: "o", expiresIn: 1 }, SECRET, Date.now() - 10_000);
  const res2 = await post(handler, { action: "issue", session: expired });
  assertEquals(res2.status, 401);
  assertEquals((await res2.json()).error.code, "session_expired");
  assertEquals(calls.length, 0);
});

Deno.test("issue seals, uses the session idempotency key and minimises the response", async () => {
  const { handler, calls } = make();
  const res = await post(handler, { action: "issue", session: await session() });
  assertEquals(res.status, 200);
  const { result } = await res.json();
  assertEquals(calls[0].key, "order-1");
  assertEquals(result.estado, "sellado");
  assertEquals(result.selloRecibido, "2026ABC");
  assertEquals(result.totales, { totalPagar: 11.3 });
  assertEquals(result.archivoJson, "{\"json\":true}");
  assertEquals(result.representacionGrafica, "UERG");
  assertEquals("jws" in result, false);
  assertEquals("documento" in result, false);
});

Deno.test("download:false drops the files; exposeDocument adds jws and documento", async () => {
  const a = make();
  const { result } = await (await post(a.handler, { action: "issue", session: await session({ download: false }) })).json();
  assertEquals("archivoJson" in result || "representacionGrafica" in result, false);
  const b = make({ exposeDocument: true });
  const exposed = (await (await post(b.handler, { action: "issue", session: await session() })).json()).result;
  assertEquals(exposed.jws, "header.payload.sig");
  assertEquals(exposed.documento, SEALED.documento);
});

Deno.test("contingency is a success with its detail", async () => {
  const { handler } = make({}, { issue: CONTINGENCY });
  const res = await post(handler, { action: "issue", session: await session() });
  assertEquals(res.status, 200);
  const { result } = await res.json();
  assertEquals(result.estado, "contingencia");
  assertEquals(result.detalle, "Hacienda no respondió");
  assertEquals(result.archivoJson, "{}");
});

Deno.test("the request is final: browser-supplied recipient and tipoDte are ignored", async () => {
  const { handler, calls } = make();
  const res = await post(handler, {
    action: "issue",
    session: await session(),
    tipoDte: "03",
    recipient: { nombre: "Injected" },
    receptor: { nombre: "Injected" },
    request: { tipoDte: "11" },
  });
  assertEquals(res.status, 200);
  assertEquals(calls[0].request, REQUEST);
});

Deno.test("prepare and sign no longer exist", async () => {
  const { handler, calls } = make();
  for (const action of ["prepare", "sign"]) {
    const res = await post(handler, { action, session: await session() });
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error.code, "bad_request");
  }
  assertEquals(calls.length, 0);
});

Deno.test("status returns only the summary", async () => {
  const { handler, calls } = make();
  const res = await post(handler, { action: "status", session: await session(), codigoGeneracion: CG });
  const { status } = await res.json();
  assertEquals(calls[0].code, CG);
  assertEquals(status.estado, "sellado");
  assertEquals("receptor" in status, false);
  assertEquals("motivo" in status, false);
  const bad = await post(handler, { action: "status", session: await session(), codigoGeneracion: "../x" });
  assertEquals(bad.status, 400);
});

Deno.test("CSRF guards: method, content type, header, size, JSON", async () => {
  const { handler, calls } = make();
  const token = await session();
  const body = { action: "session.describe", session: token };
  const get = await post(handler, body, { method: "GET" });
  assertEquals(get.status, 405);
  assertEquals(get.headers.get("allow"), "POST");
  assertEquals((await post(handler, body, { headers: { "content-type": "text/plain" } })).status, 415);
  assertEquals((await post(handler, body, { headers: { "content-type": null } })).status, 415);
  assertEquals((await post(handler, body, { headers: { "x-facta-ui": null } })).status, 400);
  assertEquals((await post(handler, body, { headers: { "x-facta-ui": "0" } })).status, 400);
  assertEquals((await post(handler, body, { raw: "{nope" })).status, 400);
  assertEquals((await post(handler, [1])).status, 400);
  assertEquals((await post(handler, { action: "teleport", session: token })).status, 400);
  assertEquals((await post(handler, body, { raw: JSON.stringify({ ...body, pad: "a".repeat(33 * 1024) }) })).status, 413);
  assertEquals((await post(handler, body)).status, 200);
  assertEquals(calls.length, 0);
});

Deno.test("an oversize body without content-length is still refused (stream limit)", async () => {
  const { handler } = make({ maxBodyBytes: 64 });
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("{\"pad\":\"" + "a".repeat(200) + "\"}"));
      c.close();
    },
  });
  const res = await handler(new Request("https://shop.test/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
    body: stream,
    // deno-lint-ignore no-explicit-any
    duplex: "half",
  } as any));
  assertEquals(res.status, 413);
});

Deno.test("authorize: false is 403, a throw is 401, true passes; it sees the session", async () => {
  const token = await session();
  const body = { action: "session.describe", session: token };
  assertEquals((await post(make({ authorize: () => false }).handler, body)).status, 403);
  assertEquals((await post(make({ authorize: () => { throw new Error("db down"); } }).handler, body)).status, 401);
  assertEquals((await post(make({ authorize: () => Promise.resolve(undefined as never) }).handler, body)).status, 403);
  let seen = "";
  const ok = make({ authorize: (_req, s) => { seen = s.idempotencyKey; return true; } });
  assertEquals((await post(ok.handler, body)).status, 200);
  assertEquals(seen, "order-1");
  const denied = await (await post(make({ authorize: () => false }).handler, body)).json();
  assertEquals(denied.error.code, "unauthorized");
});

function realFacta(answer: { status: number; body: unknown } | "network") {
  const fetch = (() => {
    if (answer === "network") return Promise.reject(new Error(`boom ${API_KEY}`));
    return Promise.resolve(new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    }));
  }) as unknown as typeof globalThis.fetch;
  return new Facta({ apiKey: API_KEY, signKey: SIGN_KEY, unlockKey: UNLOCK_KEY, maxRetries: 0, fetch });
}

Deno.test("mh_rejected keeps the observaciones verbatim and the spent correlative", async () => {
  const facta = realFacta({
    status: 422,
    body: {
      error: {
        code: "mh_rejected",
        message: "Hacienda rechazó el documento",
        details: { codigoGeneracion: CG, numeroControl: "DTE-01-X", observaciones: ["[identificacion.fecEmi] fecha inválida"] },
      },
    },
  });
  const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only" });
  const res = await post(handler, { action: "issue", session: await session() });
  assertEquals(res.status, 422);
  const { error } = await res.json();
  assertEquals(error.code, "mh_rejected");
  assertEquals(error.fields, [{ path: "identificacion.fecEmi", message: "[identificacion.fecEmi] fecha inválida" }]);
  assertEquals(error.retryable, false);
  assertEquals(error.observaciones, ["[identificacion.fecEmi] fecha inválida"]);
  assertEquals(error.spent, { codigoGeneracion: CG, numeroControl: "DTE-01-X" });
});

Deno.test("a network failure is retryable and never leaks credentials", async () => {
  const handler = createFactaHandler({ facta: realFacta("network"), sessionSecret: SECRET, authorize: "session-only" });
  const res = await post(handler, { action: "issue", session: await session() });
  assertEquals(res.status, 502);
  const text = await res.text();
  const { error } = JSON.parse(text);
  assertEquals(error.code, "network_error");
  assertEquals(error.retryable, true);
  assertEquals(text.includes("boom"), false);
});

Deno.test("retryable matches the contract table", async () => {
  const expectations: Record<string, boolean> = {
    mh_unreachable: true, service_unavailable: true, rate_limited: true, idempotency_in_flight: true,
    operation_outcome_unknown: true, validation_failed: false, sign_key_invalid: false, idempotency_key_reuse: false,
  };
  for (const [code, retryable] of Object.entries(expectations)) {
    const facta: FactaLike = {
      ...fakeFacta().facta,
      issue: () => Promise.reject(new FactaError(code as never, "m", 503)),
    };
    const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only" });
    const res = await post(handler, { action: "issue", session: await session() });
    assertEquals((await res.json()).error.retryable, retryable, code);
  }
});

Deno.test("an unknown exception becomes a generic 500 without its text", async () => {
  const facta: FactaLike = { ...fakeFacta().facta, issue: () => Promise.reject(new Error(`secret ${SECRET}`)) };
  const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only" });
  const res = await post(handler, { action: "issue", session: await session() });
  assertEquals(res.status, 500);
  const text = await res.text();
  assertEquals(JSON.parse(text).error.code, "internal_error");
  assertEquals(text.includes(SECRET), false);
});

Deno.test("no response or error ever contains apiKey, signKey, unlockKey or the session secret", async () => {
  const sealedFetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ...SEALED, note: "ok" }), { status: 200, headers: { "content-type": "application/json" } }))
  ) as unknown as typeof globalThis.fetch;
  const leaky = new Facta({ apiKey: API_KEY, signKey: SIGN_KEY, unlockKey: UNLOCK_KEY, maxRetries: 0, fetch: sealedFetch });
  const failing = realFacta({
    status: 500,
    body: { error: { code: "internal_error", message: `bad ${API_KEY} ${SIGN_KEY} ${UNLOCK_KEY} ${SECRET}`, details: { observaciones: [`x ${SIGN_KEY}`] } } },
  });
  const token = await session();
  const secrets = [API_KEY, SIGN_KEY, UNLOCK_KEY, SECRET];
  const texts: string[] = [];
  for (const facta of [leaky, failing, realFacta("network")]) {
    const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only", exposeDocument: true });
    for (const body of [
      { action: "issue", session: token },
      { action: "session.describe", session: token },
      { action: "status", session: token, codigoGeneracion: CG },
      { action: "issue", session: "garbage" },
    ]) {
      const res = await post(handler, body);
      texts.push(await res.text(), JSON.stringify([...res.headers]));
    }
  }
  for (const text of texts) for (const secret of secrets) assertEquals(text.includes(secret), false);
});

Deno.test("toNodeHandler bridges node:http-style objects", async () => {
  const { handler } = make();
  const node = toNodeHandler(handler);
  const token = await session();
  const payload = JSON.stringify({ action: "session.describe", session: token });
  const req = {
    method: "POST",
    url: "/api/facta",
    headers: { host: "shop.test", "content-type": "application/json", "x-facta-ui": "1", "content-length": String(payload.length) },
    async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(payload); },
  };
  const out: { statusCode: number; headers: Record<string, string>; body: string } = { statusCode: 0, headers: {}, body: "" };
  await node(req, {
    get statusCode() { return out.statusCode; },
    set statusCode(v: number) { out.statusCode = v; },
    setHeader(name: string, value: string) { out.headers[name] = value; },
    end(chunk?: string | Uint8Array) { out.body = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); },
  });
  assertEquals(out.statusCode, 200);
  assertEquals(JSON.parse(out.body).download, true);
  assertEquals(out.headers["content-type"].startsWith("application/json"), true);

  // A body already parsed by express.json() is re-serialised.
  const parsed = { ...req, body: JSON.parse(payload), async *[Symbol.asyncIterator]() { /* consumed */ } };
  await node(parsed, { statusCode: 0, setHeader() {}, end(chunk?: string | Uint8Array) { out.body = new TextDecoder().decode(chunk as Uint8Array); } });
  assertEquals(JSON.parse(out.body).download, true);
});

Deno.test("the server code carries no fiscal arithmetic", async () => {
  const patterns = [/0\.13|1\.13|13\s*\/\s*100|\*\s*13\b/, /ventaGravada\s*=/, /total(?:Pagar|Iva|Gravada)\s*=[^=]/, /CAT-0\d\d/];
  for (const file of ["session", "handler"]) {
    const text = await Deno.readTextFile(new URL(`../src/server/${file}.ts`, import.meta.url));
    for (const p of patterns) assertEquals(p.test(text), false, `${file}.ts matches ${p}`);
  }
});

function errorWith(observaciones: string[], details: Record<string, unknown> = {}): FactaError {
  return new FactaError("mh_rejected", "Rechazado", 422, { observaciones, ...details });
}

Deno.test("field paths are read from observaciones in every shape, and only those", () => {
  const fields = extractFieldIssues(errorWith([
    "#/receptor/nrc no cumple el formato",
    "Campo /receptor/numDocumento no cumple",
    "items[2].precioUni debe ser mayor que 0",
    "[identificacion.fecEmi] fecha inválida",
    "/cuerpoDocumento/0/cantidad inválida",
    "El NRC no existe en el registro (e.g. revisar)",
    "Visite https://hacienda.test/receptor/ayuda",
  ])).map((f) => f.path);
  assertEquals(fields, [
    "receptor.nrc",
    "receptor.numDocumento",
    "items[2].precioUni",
    "identificacion.fecEmi",
    "cuerpoDocumento[0].cantidad",
  ]);
});

Deno.test("field paths come from structured validation details too", () => {
  const error = new FactaError("validation_failed", "Invalid", 422, {
    errors: [
      { instancePath: "/receptor/nrc", message: "must match pattern" },
      { field: "items[1].cantidad" },
      { field: "not a path" },
    ],
  });
  assertEquals(extractFieldIssues(error), [
    { path: "receptor.nrc", message: "must match pattern" },
    { path: "items[1].cantidad", message: "Invalid" },
  ]);
  assertEquals(extractFieldIssues(new FactaError("internal_error", "boom", 500)), []);
});

Deno.test("fields are omitted when no path can be read", async () => {
  const facta: FactaLike = { ...fakeFacta().facta, issue: () => Promise.reject(errorWith(["El documento ya existe"])) };
  const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only" });
  const { error } = await (await post(handler, { action: "issue", session: await session() })).json();
  assertEquals("fields" in error, false);
  assertEquals(error.observaciones, ["El documento ya existe"]);
});

async function events(facta: FactaLike, body: (token: string) => unknown) {
  const seen: FactaHandlerEvent[] = [];
  const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only", onEvent: (e) => { seen.push(e); } });
  await post(handler, body(await session()));
  await new Promise((r) => setTimeout(r, 0));
  return seen;
}

Deno.test("onEvent reports issued, contingency, rejected and error without secrets", async () => {
  const issue = (value: unknown): FactaLike => ({ ...fakeFacta().facta, issue: () => value instanceof Error ? Promise.reject(value) : Promise.resolve(value as IssueResult) });
  const issued = await events(issue(SEALED), (session) => ({ action: "issue", session }));
  assertEquals(issued, [{ type: "issued", idempotencyKey: "order-1", codigoGeneracion: CG, numeroControl: SEALED.numeroControl, tipoDte: "01", ambiente: "00" }]);
  const cont = await events(issue(CONTINGENCY), (session) => ({ action: "issue", session }));
  assertEquals(cont[0].type, "contingency");
  const rejected = await events(issue(new FactaError("mh_rejected", "no", 422, { observaciones: ["x"], codigoGeneracion: CG, numeroControl: "N" })), (session) => ({ action: "issue", session }));
  assertEquals(rejected, [{ type: "rejected", idempotencyKey: "order-1", code: "mh_rejected", status: 422, observaciones: ["x"], spent: { codigoGeneracion: CG, numeroControl: "N" } }]);
  const failed = await events(issue(new FactaError("mh_unreachable", "down", 503)), (session) => ({ action: "issue", session }));
  assertEquals(failed, [{ type: "error", idempotencyKey: "order-1", code: "mh_unreachable", status: 503, retryable: true }]);
  const early = await events(fakeFacta().facta, () => ({ action: "issue", session: "bad" }));
  assertEquals(early, [{ type: "error", code: "session_invalid", status: 401, retryable: false }]);
  for (const e of [...issued, ...cont, ...rejected, ...failed]) {
    for (const secret of [API_KEY, SIGN_KEY, UNLOCK_KEY, SECRET]) assertEquals(JSON.stringify(e).includes(secret), false);
  }
});

Deno.test("a throwing or rejecting onEvent never changes the response", async () => {
  for (const onEvent of [() => { throw new Error("hook"); }, () => Promise.reject(new Error("hook"))]) {
    const handler = createFactaHandler({ facta: fakeFacta().facta, sessionSecret: SECRET, authorize: "session-only", onEvent });
    assertEquals((await post(handler, { action: "issue", session: await session() })).status, 200);
  }
});
