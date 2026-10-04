// Opt-in example: this file makes no network calls until main() is invoked.
// Configure FACTA_API_BASE_URL for the target environment and use test keys
// during staging validation. Test issuance consumes a test fiscal sequence.
import { Facta } from "@facta-dte/api";

// Keep runtime-specific access local; never place credentials in source control.
// deno-lint-ignore no-explicit-any
const runtime = globalThis as any;
const env = (name: string): string | undefined =>
  runtime.Deno?.env.get(name) ?? runtime.process?.env?.[name];

export async function inspectManagedStorage(generationCode: string) {
  const apiKey = env("FACTA_API_KEY");
  if (!apiKey) throw new Error("FACTA_API_KEY is required");
  const facta = new Facta({ apiKey, baseUrl: env("FACTA_API_BASE_URL") });
  const [status, copies] = await Promise.all([
    facta.getStorageStatus(),
    facta.getDocumentCopies({ generationCode }),
  ]);
  return {
    ready: status.managed.ready || status.byos.ready,
    copies: copies.map(({ kind, state, bytes, sha256 }) => ({ kind, state, bytes, sha256 })),
  };
}

export async function repairManagedStorage(generationCode: string) {
  const apiKey = env("FACTA_API_KEY");
  if (!apiKey) throw new Error("FACTA_API_KEY is required");
  const facta = new Facta({ apiKey, baseUrl: env("FACTA_API_BASE_URL") });
  return await facta.retryDocumentStorage(generationCode);
}
