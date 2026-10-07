// Recipe 13 · The reference clock.
//
// The SDK writes timestamps of its own: the records of a local archive and the signed requests of S3 uploads. A
// server whose clock drifted would stamp them wrongly, so by default the client calibrates a local clock against
// `https://clock.factadte.com/` (NTP's four timestamps, three samples) and then keeps time with the monotonic
// clock, with no further requests for hours. The date and time OF A DOCUMENT are always set by the Facta server;
// this clock never touches them. An unreachable clock service falls back to the device clock and never fails an
// operation.
//
// `facta.clock` is that clock (`null` when disabled with `clock: false`); share it with other adapters, for example
// `createS3ArtifactDestination({ …, clock: facta.clock ?? false })`. `createReferenceClock` builds a standalone one.
import type { ClockState, Facta } from "../../../mod.ts";

export interface Output {
  enabled: boolean;
  /** The corrected time (the device clock while `state.status` is `device`). */
  corrected: string | null;
  /** The device clock, for comparison. */
  device: string;
  state: ClockState | null;
}

export async function run(facta: Facta, _input?: null): Promise<Output> {
  const clock = facta.clock;
  if (clock === null) return { enabled: false, corrected: null, device: new Date().toISOString(), state: null };
  // `ensure()` calibrates only when its rules ask for it; `calibrate()` forces a burst. Neither throws.
  const state = await clock.ensure();
  return { enabled: true, corrected: clock.now().toISOString(), device: new Date().toISOString(), state };
}

// No input: the call reads only. Used by «Copiar para Node/Deno» and the downloadable project.
export const sample: null = null;
