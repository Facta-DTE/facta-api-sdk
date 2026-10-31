// Pending documents: finish what an uncertain emission left, without issuing twice.
//
// After a 202, a 503, a dropped connection or a warning (`indice_pendiente`,
// `reserva_sin_asentar`) the document may already exist, signed, with its control
// number spent. List what is pending and retry it. Never issue again with a new key.
//
// Import the exported main() and invoke it explicitly after configuring a test
// API key and a signing key. Module import never calls the API.

import { Facta, FactaError } from "@facta-dte/api";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const env = (name: string): string => g.Deno?.env.get(name) ?? g.process?.env?.[name];

export async function main() {
  const apiKey = env("FACTA_API_KEY");
  const baseUrl = env("FACTA_API_BASE_URL");
  if (!apiKey?.startsWith("facta_test_") || !baseUrl) throw new Error("Configure a test key and an explicit API URL.");
  const facta = new Facta({ apiKey, signKey: env("FACTA_SIGN_KEY"), baseUrl });

  let cursor: string | undefined;
  do {
    const page = await facta.listPendingDocuments({ ...(cursor === undefined ? {} : { cursor }) });
    for (const doc of page.pendientes) {
      if (!doc.reintentable) {
        console.log(doc.codigoGeneracion, "retry it from the app:", doc.motivoNoReintentable);
        continue;
      }
      try {
        const result = await facta.retryDocument(doc.codigoGeneracion);
        console.log(doc.codigoGeneracion, result.estado, result.via);
      } catch (error) {
        if (error instanceof FactaError && error.isRejection) console.error("Hacienda refused:", error.mhObservations);
        else throw error;
      }
    }
    cursor = page.siguiente ?? undefined;
  } while (cursor !== undefined);
}
