// Recipe 15 · What this key is and what the API offers: `status()`, `environment` and `getContract()`.
//
// `status()` is the health check: environment, the scopes and DTE types of the key, how it reaches the catalog,
// the ceilings left on it, and the API's region. It is the only call that does not count against the key's rate
// limit. `facta.environment` is read from the key's prefix (`facta_test_` is "00", `facta_live_` is "01") without
// any request. `getContract()` returns the OpenAPI document the server publishes: the authority on every HTTP field.
import type { Facta, Status } from "../../../mod.ts";

export interface Output {
  /** From the key's prefix, no request. */
  environment: "00" | "01" | null;
  health: Pick<Status, "ok" | "version" | "ambiente"> & { apiRegion: string | null };
  key: { scopes: string[]; dteTypes: string[]; catalogMode: string | null };
  limits: Status["limites"];
  contract: { title: string | null; version: string | null; operations: number; paths: string[] };
}

export async function run(facta: Facta, _input?: null): Promise<Output> {
  const status = await facta.status();
  const contract = (await facta.getContract()) as { info?: { title?: string; version?: string }; paths?: Record<string, unknown> };
  const paths = Object.keys(contract.paths ?? {});
  return {
    environment: facta.environment,
    health: { ok: status.ok, version: status.version, ambiente: status.ambiente, apiRegion: status.region ?? null },
    key: { scopes: status.llave.alcances, dteTypes: status.llave.tiposDte, catalogMode: status.llave.catalogMode ?? null },
    limits: status.limites,
    contract: { title: contract.info?.title ?? null, version: contract.info?.version ?? null, operations: paths.length, paths },
  };
}

// No input: the call reads only. Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: null = null;
