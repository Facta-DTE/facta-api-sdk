// Opt-in example: nothing runs until `drainUnconfirmed` is called. Run it from a DAILY job.
//
// Facta keeps an encrypted temporary copy of every sealed document and deletes it 2 days after
// you report the document stored, or 30 days after sealing if nobody does (the company owner is
// mailed from day one). This job lists what is still unreported, stores it where YOU keep your
// documents, and reports it. Configure FACTA_API_BASE_URL for the target environment; use test
// keys on staging. The key needs the `download` and `issue` scopes.
import { Facta } from "@facta-dte/api";

// deno-lint-ignore no-explicit-any
const runtime = globalThis as any;
const env = (name: string): string | undefined =>
  runtime.Deno?.env.get(name) ?? runtime.process?.env?.[name];

/**
 * `save(name, bytes)` is YOUR storage (a bucket, a database, a folder): resolve only when the
 * bytes are durably stored, throw otherwise.
 */
export async function drainUnconfirmed(save: (name: string, bytes: Uint8Array) => Promise<void>) {
  const apiKey = env("FACTA_API_KEY");
  if (!apiKey) throw new Error("FACTA_API_KEY is required");
  const facta = new Facta({ apiKey, baseUrl: env("FACTA_API_BASE_URL") });

  const report = await facta.storeAndConfirmUnconfirmed({
    where: "accounting-disk",
    store: async ({ codigoGeneracion, json, pdf }) => {
      // Resolve only when the files are durably stored; throw to leave the document
      // unconfirmed (it stays on the list and in the owner's mail).
      await save(`${codigoGeneracion}.json`, json);
      if (pdf) await save(`${codigoGeneracion}.pdf`, pdf);
    },
  });

  // `stopped` says why the run ended; `failed`/`results[].step` say what to fix;
  // `firstDeletionAt` is the earliest deadline among the documents still unconfirmed.
  if (report.failed > 0 || report.stopped !== "complete") {
    console.error("unconfirmed documents remain", {
      stopped: report.stopped,
      failed: report.failed,
      remaining: report.remaining,
      firstDeletionAt: report.firstDeletionAt,
      error: report.error,
    });
  }
  return report;
}
