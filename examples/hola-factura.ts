// Hello invoice: issue a DTE and handle both fiscal outcomes.
//
// Keep the integration small and readable: credentials come from the process
// environment, and an uncertain result must never trigger a duplicate issue.
//
// Import the exported main() and invoke it explicitly after configuring a
// test API/signing key and a stable ERP_ORDER_ID. Module import never issues.

import { Facta } from "@facta-dte/api";

// Inject these values from a process secret manager, never from source control.
// Keep API and signing credentials separate where possible. FACTA_UNLOCK_KEY
// is omitted because the SDK never sends it to the API.
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const env = (name: string): string => g.Deno?.env.get(name) ?? g.process?.env?.[name];

export async function main() {
  const facta = new Facta({ apiKey: env("FACTA_API_KEY"), signKey: env("FACTA_SIGN_KEY"), baseUrl: env("FACTA_API_BASE_URL") });
  const result = await facta.issue({ tipoDte: "01", items: [{ descripcion: "Sample item", cantidad: 1, precioUni: 1 }] }, { idempotencyKey: env("ERP_ORDER_ID") });
  if (result.estado === "sellado") console.log("Sealed; managed JSON/PDF:", result.storage?.json.state, result.storage?.pdf.state);
  else console.log("Fiscal status:", result.estado);
}
