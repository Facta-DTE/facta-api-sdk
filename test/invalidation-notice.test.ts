// `invalidate`: the filed event (`archivoEvento`, `storage`) and the automatic
// customer notice (`avisoCliente`). The server decides every state; these tests
// prove the SDK carries each one through typed and unchanged.

import { assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { invalidationEventFileOf } from "../mod.ts";
import type { CompleteInvalidationResult, InvalidationNotice, InvalidationRequest } from "../mod.ts";

const DOCUMENT = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const EVENT = "BEB08A1C-1722-4E35-AEA6-52AB1234CDEF";
const SIGN_KEY = `factask_${"A".repeat(43)}`;
const PERSON = { nombre: "A", tipoDocumento: "36", numDocumento: "06142803901121" };
const REQUEST: InvalidationRequest = { tipoAnulacion: 2, responsable: PERSON, solicita: PERSON };

const FILE = {
  nombre: `${DOCUMENT}.invalidacion.json`,
  ruta: `DTE/2026/10/${DOCUMENT}.invalidacion.json`,
  contenido: '{\n  "firmaElectronica": "jws",\n  "selloRecibido": "SEAL"\n}',
};
const artifact = (state: string) => ({ state, sha256: null, bytes: null, storedAt: null, errorCode: null, retryable: false });
const STORAGE = {
  destination: "managed", environment: "00", json: artifact("stored"), pdf: artifact("not_configured"), operationId: EVENT,
};

function answer(extra: Record<string, unknown>) {
  return {
    estado: "invalidado", codigoGeneracion: DOCUMENT, numeroControl: "DTE-01-M001P001-000000000000042", tipoDte: "01", ambiente: "00",
    evento: { codigoGeneracion: EVENT, selloRecibido: "SEAL", fhProcesamiento: "2026-10-17T10:00:00", observaciones: [], tipoAnulacion: 2 },
    documento: {}, jws: "signed-event-jws", anotadoEnElIndice: true, ...extra,
  };
}

function client(body: unknown) {
  const fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }))
  ) as unknown as typeof globalThis.fetch;
  return new Facta({ region: false, apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", signKey: SIGN_KEY, fetch });
}

async function invalidate(extra: Record<string, unknown>): Promise<CompleteInvalidationResult> {
  const result = await client(answer(extra)).invalidate(DOCUMENT, REQUEST);
  if (!("jws" in result)) throw new Error("expected a complete invalidation");
  return result;
}

Deno.test("invalidate carries archivoEvento and the managed storage receipt", async () => {
  const result = await invalidate({ archivoEvento: FILE, storage: STORAGE, avisoCliente: { estado: "enviado", destino: "a•••@ejemplo.com" } });
  assertEquals(result.archivoEvento, FILE);
  assertEquals(result.storage?.destination, "managed");
  assertEquals(result.storage?.json.state, "stored");
  assertEquals(invalidationEventFileOf(result), FILE);
});

Deno.test("a null archivoEvento means no file to archive", async () => {
  const result = await invalidate({ archivoEvento: null, storage: null, avisoCliente: { estado: "no_enviado", destino: null, motivo: "evento_ilegible" } });
  assertEquals(result.archivoEvento, null);
  assertEquals(invalidationEventFileOf(result), null);
});

Deno.test("an older server without the new fields still parses", async () => {
  const result = await invalidate({});
  assertEquals(result.archivoEvento, undefined);
  assertEquals(result.avisoCliente, undefined);
  assertEquals(invalidationEventFileOf(result), null);
});

Deno.test("invalidationEventFileOf refuses a file with a missing name, path or content", () => {
  assertEquals(invalidationEventFileOf({ archivoEvento: { ...FILE, contenido: "" } }), null);
  assertEquals(invalidationEventFileOf({ archivoEvento: { ...FILE, ruta: "" } }), null);
  assertEquals(invalidationEventFileOf({ archivoEvento: { ...FILE, nombre: "" } }), null);
  assertEquals(invalidationEventFileOf({}), null);
});

const NOTICES: InvalidationNotice[] = [
  { estado: "enviado", destino: "a•••@ejemplo.com" },
  { estado: "en_proceso", destino: "a•••@ejemplo.com" },
  { estado: "fallido", destino: "a•••@ejemplo.com", motivo: "quota_exceeded" },
  { estado: "fallido", destino: "a•••@ejemplo.com", motivo: "smtp_rejected" },
  { estado: "fallido", destino: "a•••@ejemplo.com", motivo: "document_rejected" },
  { estado: "fallido", destino: null, motivo: "provider_unavailable" },
  ...[
    "envio_automatico_desactivado",
    "servidor_de_correo_propio",
    "documento_no_disponible",
    "sin_correo",
    "evento_ilegible",
    "pdf_no_disponible",
    "no_anotado_en_el_indice",
  ].map((motivo) => ({ estado: "no_enviado", destino: null, motivo }) as InvalidationNotice),
];

for (const notice of NOTICES) {
  Deno.test(`avisoCliente ${notice.estado}${notice.motivo ? ` / ${notice.motivo}` : ""} is returned as sent`, async () => {
    const result = await invalidate({ archivoEvento: FILE, avisoCliente: notice });
    assertEquals(result.avisoCliente, notice);
    // Whatever the notice did, the invalidation itself stays a success.
    assertEquals(result.estado, "invalidado");
  });
}
