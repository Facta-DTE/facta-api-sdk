// Recipe 10 · Where the API runs, and how long each step takes.
//
// REGION. Edge Functions run next to the database, not next to the caller: pinning every request to the
// API's region (`x-region`) measured POST /v1/dte at 7.2 s without it and 4.3 s with it. The client learns the
// region once from `GET /v1/status`; you can also fix it (`new Facta({ region: "us-west-2" })`, `config.region`,
// the FACTA_API_REGION variable) or turn it off (`region: false`). `facta.region()` reads the setting and
// `facta.servedRegion` is the region that actually answered the latest call (`x-sb-edge-region`).
//
// TIMINGS. A debugging aid, off by default and never for production traffic: `debug: { timings: true }` on the
// client, or on a single call as below. The API answers with its own per-step times and the SDK exposes them
// as `result.debug` (`{ timings: [{ step, ms }], totalMs, source }`).
import type { DebugInfo, Facta } from "../../../mod.ts";

export interface Output {
  /** What the client sends as `x-region` (the setting, or what `/v1/status` advertised). */
  functionsRegion: string | null;
  /** The region that served the last response. */
  servedFrom: string | null;
  /** The region the status document reports for the API. */
  apiRegion: string | null;
  /** Present when the API returned per-step times for this call. */
  debug: DebugInfo | null;
}

export async function run(facta: Facta, _input?: null): Promise<Output> {
  const functionsRegion = await facta.region();
  // One call with timings asked for, only for this call: the client's own `debug` option stays off.
  const status = await facta.status({ debug: { timings: true } });
  return {
    functionsRegion,
    servedFrom: facta.servedRegion,
    apiRegion: status.region ?? null,
    debug: (status as { debug?: DebugInfo }).debug ?? null,
  };
}

// No input: the call reads only. Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: null = null;
