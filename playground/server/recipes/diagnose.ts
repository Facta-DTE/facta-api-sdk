// Recipe 11 · Is this client ready to work? `diagnose()` and `catalogState()`.
//
// `diagnose()` answers «can this key issue, query, download, archive?» with a list of checks, each `ok`,
// `warning` or `blocked`, and says what to do. It reads `/v1/status`; it never opens a vault, reserves a
// control number or sends a document. Use it at start-up and in a health endpoint. Pass
// `config: { expectedEnvironment, requiredScopes }` to the client so a test key in production (or a missing
// scope) shows up here instead of at the first sale.
//
// `catalogState()` says how this key reaches the catalog (`encrypted`, `readable` or `plain`) and whether a
// local snapshot is `fresh`, `stale` or `missing`. It never throws: a failure is reported in `statusError`.
import type { CatalogState, DiagnosticsReport, Facta } from "../../../mod.ts";

export async function run(facta: Facta, _input?: null): Promise<{ diagnostics: DiagnosticsReport; catalog: CatalogState }> {
  const diagnostics = await facta.diagnose();
  const catalog = await facta.catalogState();
  return { diagnostics, catalog };
}

// No input: the call reads only. Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: null = null;
