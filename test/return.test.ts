// `registerReturn`: the second-factor header, the retry contract and the local
// checks. What the server decides — the balance, the window, the seal — is not
// re-asserted here: a fake transport can only prove the fake works.

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { FactaError } from "../src/errors.ts";
import type { DocumentStatus, ReturnResult, ReturnRequest } from "../mod.ts";

const SIGN_KEY = `factask_${"A".repeat(43)}`;
const DOCUMENT = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const EVENT = "BEB08A1C-1722-4E35-AEA6-52AB1234CDEF";

interface Recorded { url: string; method: string; headers: Record<string, string>; body: string | null }

function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  let index = 0;
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const answer = answers[Math.min(index++, answers.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const base = {
  codigoGeneracion: EVENT,
  documentoRelacionado: { codigoGeneracion: DOCUMENT, numeroControl: "DTE-01-M001P001-000000000001038", tipoDte: "01", fecEmi: "2026-10-05" },
  ambiente: "00",
  fecEmi: "2026-10-06",
  horEmi: "09:00:00",
  totales: { totalGravada: 8.85, totalExenta: 0, totalNoSuj: 0, totalIva: 1.15, totalPagar: 10 },
  documento: {},
  jws: "signed-event-jws",
  archivoJson: "{}",
  disponible: [{ linea: 1, vendida: 3, devuelta: 1, disponible: 2, noGravado: null }],
};
const SEALED = { estado: "sellado", ...base, selloRecibido: "SEAL", representacionGrafica: null, anotadoEnElLibro: true };

const REQUEST: ReturnRequest = { items: [{ linea: 1, cantidad: 1 }] };

function client(fetch: typeof globalThis.fetch) {
  return new Facta({ region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: SIGN_KEY, fetch });
}

Deno.test("registerReturn posts to the document's /return with the sign key and an idempotency key", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const result = await client(fetch).registerReturn(DOCUMENT, REQUEST);
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].url.endsWith(`/v1/dte/${DOCUMENT}/return`), true);
  assertEquals(calls[0].headers["X-Facta-Sign-Key"], SIGN_KEY);
  assertEquals(typeof calls[0].headers["Idempotency-Key"], "string");
  assertEquals(JSON.parse(calls[0].body ?? "{}"), REQUEST);
  assertEquals(result.estado, "sellado");
  assertEquals(result.disponible[0]?.disponible, 2);
});

Deno.test("the second factor still travels only on routes that sign", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { estado: "sellado", retornos: [], disponible: [] } }]);
  const facta = client(fetch);
  await facta.getDocumentStatus(DOCUMENT);
  assertEquals(calls[0].headers["X-Facta-Sign-Key"], undefined);
  // …and not on a lookalike path of the same document.
  await facta.downloadDocument(DOCUMENT, "json").catch(() => undefined);
  assertEquals(calls[1]?.headers["X-Facta-Sign-Key"], undefined);
});

Deno.test("a 202 is a pending result, not an error, and carries what the retry resends", async () => {
  const pending = { estado: "firmado", ...base, detalle: "no pudimos llegar", almacenamiento: "retencion" };
  const { fetch } = fakeFetch([{ status: 202, body: pending }]);
  const result: ReturnResult = await client(fetch).registerReturn(DOCUMENT, REQUEST);
  assertEquals(result.estado, "firmado");
  if (result.estado === "firmado") assertEquals(result.jws, "signed-event-jws");
});

Deno.test("a retry with the same idempotencyKey sends the same key twice", async () => {
  const { fetch, calls } = fakeFetch([{ status: 202, body: { estado: "firmado", ...base, detalle: "x" } }, { status: 200, body: SEALED }]);
  const facta = client(fetch);
  await facta.registerReturn(DOCUMENT, REQUEST, { idempotencyKey: "ret-1" });
  const second = await facta.registerReturn(DOCUMENT, REQUEST, { idempotencyKey: "ret-1" });
  assertEquals(calls[0].headers["Idempotency-Key"], "ret-1");
  assertEquals(calls[1].headers["Idempotency-Key"], "ret-1");
  assertEquals(second.estado, "sellado");
});

Deno.test("the return errors reach the caller as codes, with the offending lines", async () => {
  const { fetch } = fakeFetch([{
    status: 422,
    body: { error: { code: "return_exceeds_available", message: "más de lo que queda", details: { lineas: [{ linea: 1, solicitado: 2, disponible: 1 }] } } },
  }]);
  const error = await assertRejects(() => client(fetch).registerReturn(DOCUMENT, REQUEST), FactaError) as FactaError;
  assertEquals(error.code, "return_exceeds_available");
  assertEquals(error.status, 422);
  assertEquals((error.details as { lineas: unknown[] }).lineas.length, 1);
});

Deno.test("invalidate on a document with returns is a 409 has_return_events", async () => {
  const { fetch } = fakeFetch([{ status: 409, body: { error: { code: "has_return_events", message: "x" } } }]);
  const error = await assertRejects(
    () => client(fetch).invalidate(DOCUMENT, {
      tipoAnulacion: 2,
      responsable: { nombre: "A", tipoDocumento: "36", numDocumento: "06142803901121" },
      solicita: { nombre: "A", tipoDocumento: "36", numDocumento: "06142803901121" },
    }),
    FactaError,
  ) as FactaError;
  assertEquals(error.code, "has_return_events");
  assertEquals(error.status, 409);
});

Deno.test("lookup types carry the returns and the balance", async () => {
  const status: DocumentStatus = {
    estado: "sellado", codigoGeneracion: DOCUMENT, numeroControl: "n", tipoDte: "01", ambiente: "00",
    fecEmi: "2026-10-05", selloRecibido: "S", totales: {},
    retornos: [{ codigoGeneracion: EVENT, estado: "sellado", fecha: "2026-10-06", selloRecibido: "S",
      totales: { totalGravada: 8.85, totalIva: 1.15, totalPagar: 10 }, lineas: [{ linea: 1, cantidad: 1 }] }],
    disponible: [{ linea: 1, vendida: 3, devuelta: 1, disponible: 2, noGravado: null }],
  };
  const { fetch } = fakeFetch([{ status: 200, body: status }]);
  const read = await client(fetch).getDocumentStatus(DOCUMENT);
  assertEquals(read.retornos?.[0]?.lineas[0]?.cantidad, 1);
  assertEquals(read.disponible?.[0]?.disponible, 2);
});

Deno.test("local checks refuse what the server would, before any request", () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: SEALED }]);
  const facta = client(fetch);
  const bad: unknown[] = [
    { items: [] },
    { items: [{ linea: 0, cantidad: 1 }] },
    { items: [{ linea: 1.5, cantidad: 1 }] },
    { items: [{ linea: 1 }] },
    { items: [{ linea: 1, cantidad: 1, noGravado: 2 }] },
    { items: [{ linea: 1, cantidad: 0 }] },
    { items: [{ linea: 1, noGravado: 0 }] },
    { items: [{ linea: 1, cantidad: 1 }], fechaEvento: "06/10/2026" },
  ];
  for (const request of bad) {
    assertThrows(() => facta.registerReturn(DOCUMENT, request as ReturnRequest));
  }
  assertEquals(calls.length, 0);
});
