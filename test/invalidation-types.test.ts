import { assertEquals } from "jsr:@std/assert@1";
import type { InvalidationResult } from "../mod.ts";

const completedInvalidation: InvalidationResult = {
  estado: "invalidado",
  codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-03-M001P001-000000000000175",
  tipoDte: "03",
  ambiente: "00",
  evento: {
    codigoGeneracion: "BEB08A1C-1722-4E35-AEA6-52AB1234CDEF",
    selloRecibido: "event-seal",
    tipoAnulacion: 1,
  },
  documento: {},
  jws: "signed-event-jws",
  anotadoEnElIndice: true,
};

const previouslyInvalidated: InvalidationResult = {
  estado: "invalidado",
  codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  numeroControl: "DTE-03-M001P001-000000000000175",
  yaEstabaInvalidado: true,
};

function archivedJws(result: InvalidationResult): string | null {
  return "jws" in result ? result.jws : null;
}

Deno.test("public invalidation result type distinguishes archived and sparse outcomes", () => {
  assertEquals(archivedJws(completedInvalidation), "signed-event-jws");
  assertEquals(archivedJws(previouslyInvalidated), null);
});
