// Hello invoice: issue a DTE and handle both fiscal outcomes.
//
// Keep the integration small and readable: credentials come from the process
// environment, and an uncertain result must never trigger a duplicate issue.
//
//   Node:  FACTA_API_KEY=facta_test_… FACTA_SIGN_KEY=factask_… \
//            node --experimental-strip-types examples/hola-factura.ts
//   Deno:  FACTA_API_KEY=facta_test_… FACTA_SIGN_KEY=factask_… \
//            deno run --allow-net --allow-env examples/hola-factura.ts

import { Facta, FactaError } from "../mod.ts";

// Inject these values from a process secret manager, never from source control.
// Keep API and signing credentials separate where possible. FACTA_UNLOCK_KEY
// is omitted because the SDK never sends it to the API.
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const env = (name: string): string => g.Deno?.env.get(name) ?? g.process?.env?.[name];

const facta = new Facta({ apiKey: env("FACTA_API_KEY"), signKey: env("FACTA_SIGN_KEY") });

try {
  const dte = await facta.issue({
    tipoDte: "03",
    receptor: { customerId: "374114b6-e957-4c7a-8911-dd6381b1e0ea" },
    items: [{ descripcion: "Integración de la API", cantidad: 1, precioUni: 25 }],
  });
  // Totals are available only after Hacienda seals the document. A 202
  // contingency response has no final verdict, which the result type enforces.
  console.log(dte.estado, dte.numeroControl);
  if (dte.estado === "sellado") console.log("Seal:", dte.selloRecibido, dte.totales.totalPagar);
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    // Hacienda rejected the document after reserving its number. Use the same
    // number when correcting the rejected operation.
    console.error("Rejected:", error.message, "· number spent:", error.spent?.numeroControl);
  } else throw error;
}
