// `representacion` (datos + plantilla) on issue / sign and `listTemplates`: what the SDK puts on the wire and how
// it types the answer. Whether the server honours the choice is the server's contract, not asserted here.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import type { DteRequest, IssueResult, RepresentationTemplates, TemplateNotAppliedWarning } from "../mod.ts";

interface Recorded { url: string; method: string; body: string | null }

function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function client(fetch: typeof globalThis.fetch) {
  return new Facta({ region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch });
}

const REQUEST: DteRequest = {
  tipoDte: "01",
  items: [{ descripcion: "Café", cantidad: 1, precioUni: 2.5 }],
  representacion: {
    datos: { mesa: "7", mesero: "Ana", comensales: 3, filas: [{ etiqueta: "Turno", valor: "Noche" }] },
    plantilla: { carta: "custom:0b8f5c3e-0000-4000-8000-000000000001", ticket: "ticket-3" },
  },
};

const WARNING: TemplateNotAppliedWarning = {
  codigo: "plantilla_no_aplicada",
  campo: "representacion.plantilla.carta",
  motivo: "plan",
  mensaje: "Su plan no incluye esta plantilla.",
};

const SEALED = {
  estado: "sellado",
  codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-14",
  horEmi: "09:00:00",
  selloRecibido: "SEAL",
  documento: {},
  jws: "jws",
  advertencias: [WARNING],
};

Deno.test("issue sends representacion untouched, with datos, filas and plantilla", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const result: IssueResult = await client(fetch).issue(REQUEST);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.endsWith("/v1/dte"), true);
  assertEquals(JSON.parse(calls[0].body!).representacion, REQUEST.representacion);
  // The refused choice is a typed warning, not an error.
  const warning = result.advertencias?.find((w): w is TemplateNotAppliedWarning => typeof w === "object" && "codigo" in w && w.codigo === "plantilla_no_aplicada");
  assertEquals(warning?.motivo, "plan");
  assertEquals(warning?.campo, "representacion.plantilla.carta");
});

Deno.test("issue without representacion sends none", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  await client(fetch).issue({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] });
  assertEquals("representacion" in JSON.parse(calls[0].body!), false);
});

Deno.test("prepare never sends representacion (the API rejects it); sign carries its own", async () => {
  const prepared = { estado: "preparado", codigoGeneracion: SEALED.codigoGeneracion, numeroControl: SEALED.numeroControl, tipoDte: "01", ambiente: "00", totales: {}, documento: { a: 1 }, prepareToken: "tok" };
  const { fetch, calls } = fakeFetch([{ status: 200, body: prepared }, { status: 200, body: SEALED }, { status: 200, body: SEALED }]);
  const facta = client(fetch);
  const p = await facta.prepare(REQUEST);
  assertEquals("representacion" in JSON.parse(calls[0].body!), false);
  await facta.sign(p, { representacion: REQUEST.representacion });
  assertEquals(calls[1].url.endsWith("/v1/dte/sign"), true);
  assertEquals(JSON.parse(calls[1].body!), { prepareToken: "tok", documento: { a: 1 }, representacion: REQUEST.representacion });
  await facta.sign(p);
  assertEquals("representacion" in JSON.parse(calls[2].body!), false);
});

const TEMPLATES: RepresentationTemplates = {
  predeterminada: { carta: "carta-a", ticket: "ticket-1" },
  plantillas: [
    { id: "carta-a", tipo: "carta", nombre: "Clásica", origen: "catalogo", permitida: true, clavesDatos: [] },
    { id: "carta-m", tipo: "carta", nombre: "Menú", origen: "catalogo", permitida: false, motivo: "plan", tiposDte: ["01"], clavesDatos: ["mesa", "mesero"] },
  ],
};

Deno.test("listTemplates asks for the DTE type and returns the typed list", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: TEMPLATES }]);
  const list = await client(fetch).listTemplates({ tipoDte: "03" });
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].url.endsWith("/v1/representacion/plantillas?tipoDte=03"), true);
  assertEquals(list.plantillas[1].clavesDatos, ["mesa", "mesero"]);
  assertEquals(list.predeterminada.ticket, "ticket-1");
});

Deno.test("listTemplates without a type has no query", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: TEMPLATES }]);
  await client(fetch).listTemplates();
  assertEquals(calls[0].url.endsWith("/v1/representacion/plantillas"), true);
});

Deno.test("listTemplates on a server without the endpoint rejects with a 404 FactaError", async () => {
  const { fetch } = fakeFetch([{ status: 404, body: { error: "not_found", mensaje: "no route" } }]);
  const error = await assertRejects(() => client(fetch).listTemplates(), FactaError);
  assertEquals((error as FactaError).status, 404);
});

// ---- the handler forwards only the template warnings --------------------------------------------------------

import { createFactaHandler, createFactaSession, type FactaLike } from "../server.ts";

Deno.test("the browser handler forwards plantilla_no_aplicada warnings and nothing else from advertencias", async () => {
  const SECRET = "x".repeat(48);
  const facta: FactaLike = {
    issue: () => Promise.resolve({
      ...SEALED,
      advertencias: [WARNING, { code: "sin_almacenamiento_duradero", mensaje: "private storage detail" }, "texto suelto"],
    } as unknown as IssueResult),
    getDocumentStatus: () => Promise.reject(new Error("unused")),
  };
  const handler = createFactaHandler({ facta, sessionSecret: SECRET, authorize: "session-only" });
  const session = await createFactaSession({ request: REQUEST, idempotencyKey: "order-1", display: { total: 2.5, title: "t", reference: "r" } }, SECRET);
  const res = await handler(new Request("https://shop.test/api/facta", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1" },
    body: JSON.stringify({ action: "issue", session }),
  }));
  assertEquals(res.status, 200);
  const { result } = await res.json();
  assertEquals(result.advertencias, [WARNING]);
});

Deno.test("PDF and ticket downloads expose the applied template from X-Facta-Plantilla; JSON and bad tags do not", async () => {
  const answer = (tag: string | null) => ((_: unknown) =>
    Promise.resolve(new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { "Content-Type": "application/pdf", ...(tag === null ? {} : { "X-Facta-Plantilla": tag }) },
    }))) as unknown as typeof globalThis.fetch;
  const cg = SEALED.codigoGeneracion;
  const custom = "custom:0b8f5c3e-0000-4000-8000-000000000001@3";
  assertEquals((await client(answer("letter-clasica")).downloadDocument(cg, "pdf")).plantilla, "letter-clasica");
  assertEquals((await client(answer(custom)).downloadDocument(cg, "ticket")).plantilla, custom);
  assertEquals((await client(answer(null)).downloadDocument(cg, "pdf")).plantilla, undefined);
  assertEquals((await client(answer("not a tag!")).downloadDocument(cg, "pdf")).plantilla, undefined);
  assertEquals((await client(answer("letter-clasica")).downloadDocument(cg, "json")).plantilla, undefined);
});
