// Reference clock: a local clock calibrated against `clock.factadte.com`.
//
// Plan: docs/plan/tareas/qa-findings-fix-plan.md §1 (batch K). The protocol is
// NTP's four timestamps; the Worker is consulted to CALIBRATE, and afterwards
// the monotonic clock answers every «what time is it» with no network call.
//
//   t0  client send time (wall clock), echoed by the Worker
//   t1  server receive time        t2  server send time
//   t3  client receive time
//
//   delay        δ = (t3 − t0) − (t2 − t1)
//   offset       θ = ((t1 − t0) + (t2 − t3)) / 2     (server − client)
//   uncertainty  ε = δ / 2 + precisionMs
//
// Design decisions (each one is a test):
//   · The anchor is `{ mono, utc }`: the monotonic reading at `t3` and the
//     server time at that instant. `now() = utc + (mono_now − mono)`. The
//     device's wall clock is exactly what is not trusted, so it is only read
//     to detect a jump and to send `t0`.
//   · `t3` is derived as `t0 + (mono3 − mono0)`, so the device time being
//     changed in the middle of a request cannot corrupt a sample.
//   · Three samples, the smallest δ wins; up to two more while the best ε is
//     above 250 ms; a sample with δ > 3 s or a mismatching echo is discarded.
//   · Uncertainty decays as `ε + driftRate × elapsed` (100 ppm assumed, or
//     measured between two calibrations, clamped to ±200 ppm). The measured
//     rate only WIDENS the uncertainty; it is never subtracted from `now()`,
//     because a rate measured from noisy samples is not a correction.
//   · `ensure()` never touches the network while the uncertainty is under the
//     limit; it recalibrates for: no calibration yet, uncertainty over the
//     limit, anchor older than `nextSyncAfterMs`, a wall/monotonic jump over
//     2 s. The Hacienda time rejection is the caller's: `calibrate()`.
//   · Nothing here throws. Unreachable Worker → the best estimate there is
//     (provisional, else the device clock) and `state().status` says so.
//     After a failure `ensure()` does not retry for `retryCooldownMs`, so an
//     emission never pays a burst of timeouts per click.
//
// Runtime-agnostic: browser, Node, Deno. No imports. The TypeScript SDK ships
// a byte-identical copy (`sdks/typescript/src/reference-clock.ts`) because it
// is a standalone package; `test/clock-sdk-copy.test.ts` pins them equal.

export interface ClockSample {
  /** Round-trip delay without the server's own processing, ms. */
  delayMs: number;
  /** server − client, ms. */
  offsetMs: number;
  /** Worst-case error of `offsetMs`: δ/2 + precision. */
  uncertaintyMs: number;
}

/** The four-timestamp arithmetic of one sample (pure). */
export function computeSample(
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  precisionMs: number,
): ClockSample {
  const delayMs = t3 - t0 - (t2 - t1);
  const offsetMs = (t1 - t0 + (t2 - t3)) / 2;
  return { delayMs, offsetMs, uncertaintyMs: delayMs / 2 + precisionMs };
}

/** What survives a reload. The monotonic anchor does not. */
export interface StoredCalibration {
  /** server − device wall clock when it was taken, ms. */
  offsetMs: number;
  driftPpm: number;
  /** Server time (epoch ms) of the calibration. */
  at: number;
  /** Uncertainty at that moment, ms. */
  uncertaintyMs: number;
}

export interface ClockStore {
  load(): StoredCalibration | null;
  save(value: StoredCalibration): void;
}

export type ClockStatus = "calibrated" | "provisional" | "device";

export interface ClockState {
  status: ClockStatus;
  /** Correct time − device wall clock, right now, ms. 0 when `device`. */
  offsetMs: number;
  /** Current worst-case error, ms. `Infinity` when `device` (unknown). */
  uncertaintyMs: number;
  /** Drift rate used for the uncertainty (assumed 100 until measured). */
  driftPpm: number;
  driftMeasured: boolean;
  /** Server time (epoch ms) of the last calibration, or null. */
  calibratedAt: number | null;
  /** Wall − monotonic disagreement seen at the last check, ms (0 if none). */
  lastJumpMs: number;
  /** Valid samples the last calibration took (the smallest delay won). */
  samples: number;
  /** Round-trip delay of the winning sample, ms. */
  delayMs: number | null;
  /** Cloudflare data centre that answered. */
  colo: string | null;
  nextSyncAfterMs: number;
  /** Short reason of the last failed calibration, or null. */
  lastError: string | null;
}

export interface ReferenceClockOptions {
  /** `https://clock.factadte.com/` */
  url: string;
  fetch: typeof fetch;
  /** Device wall clock, epoch ms. */
  wallNow: () => number;
  /** Monotonic clock, ms (`performance.now`). */
  monoNow: () => number;
  store?: ClockStore;
  /** Ids for the samples. Defaults to `Math.random`. */
  random?: () => number;
  /** Waits between the samples of a burst. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Gap between samples of a burst, ms. Default 300. */
  sampleSpacingMs?: number;
  /** Per-request timeout, ms. Default 3000 (a slower answer is discarded anyway). */
  timeoutMs?: number;
  /** After a failed calibration `ensure()` waits this long to try again. Default 60 s. */
  retryCooldownMs?: number;
}

export interface ReferenceClock {
  /** Corrected time. Synchronous, no network, never throws. */
  now(): Date;
  state(): ClockState;
  /** Calibrates only when the rules ask for it. Never throws. */
  ensure(options?: { maxUncertaintyMs?: number }): Promise<ClockState>;
  /** Forces a burst (e.g. after Hacienda rejects the time). Never throws. */
  calibrate(): Promise<ClockState>;
}

export const CLOCK_DEFAULTS = Object.freeze({
  maxUncertaintyMs: 500,
  targetUncertaintyMs: 250,
  discardDelayMs: 3000,
  jumpThresholdMs: 2000,
  assumedDriftPpm: 100,
  maxDriftPpm: 200,
  minMeasuredDriftPpm: 5,
  minDriftWindowMs: 10 * 60 * 1000,
  baseSamples: 3,
  maxSamples: 5,
  defaultNextSyncAfterMs: 6 * 60 * 60 * 1000,
});

interface Anchor {
  mono: number;
  utc: number;
  /** Wall reading at the same instant as `mono`, to detect a jump. */
  wall: number;
  uncertaintyMs: number;
  offsetMs: number;
  delayMs: number;
  samples: number;
  colo: string | null;
  nextSyncAfterMs: number;
}

interface Provisional {
  offsetMs: number;
  uncertaintyMs: number;
  at: number;
}

interface Measured {
  sample: ClockSample;
  /** Server-time estimate at `mono`/`wall` of receipt. */
  mono: number;
  wall: number;
  nextSyncAfterMs: number;
  colo: string | null;
}

const clampDrift = (ppm: number): number =>
  Math.max(-CLOCK_DEFAULTS.maxDriftPpm, Math.min(CLOCK_DEFAULTS.maxDriftPpm, ppm));

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function createReferenceClock(options: ReferenceClockOptions): ReferenceClock {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const spacingMs = options.sampleSpacingMs ?? 300;
  const timeoutMs = options.timeoutMs ?? CLOCK_DEFAULTS.discardDelayMs;
  const cooldownMs = options.retryCooldownMs ?? 60_000;

  let anchor: Anchor | null = null;
  let provisional: Provisional | null = null;
  let driftPpm: number = CLOCK_DEFAULTS.assumedDriftPpm;
  let driftMeasured = false;
  let lastJumpMs = 0;
  let lastError: string | null = null;
  let failedAtMono: number | null = null;
  let backgroundStarted = false;
  let inflight: Promise<ClockState> | null = null;

  // ---------------------------------------------------------------- store
  try {
    const stored = options.store?.load();
    if (
      stored && isFiniteNumber(stored.offsetMs) && isFiniteNumber(stored.at) &&
      isFiniteNumber(stored.uncertaintyMs)
    ) {
      provisional = { offsetMs: stored.offsetMs, uncertaintyMs: stored.uncertaintyMs, at: stored.at };
      if (isFiniteNumber(stored.driftPpm)) {
        driftPpm = Math.max(CLOCK_DEFAULTS.minMeasuredDriftPpm, Math.min(CLOCK_DEFAULTS.maxDriftPpm, Math.abs(stored.driftPpm)));
        driftMeasured = true;
      }
    }
  } catch {
    provisional = null;
  }

  // -------------------------------------------------------------- helpers
  function jumpOf(a: Anchor): number {
    return options.wallNow() - a.wall - (options.monoNow() - a.mono);
  }

  function anchorNow(a: Anchor): number {
    return a.utc + (options.monoNow() - a.mono);
  }

  function anchorUncertainty(a: Anchor): number {
    const elapsed = Math.max(0, options.monoNow() - a.mono);
    let value = a.uncertaintyMs + (Math.abs(driftPpm) * 1e-6) * elapsed;
    const jump = Math.abs(jumpOf(a));
    if (jump > CLOCK_DEFAULTS.jumpThresholdMs) value = Math.max(value, jump);
    return value;
  }

  function provisionalNow(p: Provisional): number {
    return options.wallNow() + p.offsetMs;
  }

  function provisionalUncertainty(p: Provisional): number {
    const sinceMs = Math.abs(provisionalNow(p) - p.at);
    return p.uncertaintyMs + CLOCK_DEFAULTS.maxDriftPpm * 1e-6 * sinceMs;
  }

  function safe<T>(fn: () => T, fallback: () => T): T {
    try {
      return fn();
    } catch {
      return fallback();
    }
  }

  function deviceDate(): Date {
    return safe(() => new Date(options.wallNow()), () => new Date());
  }

  function now(): Date {
    return safe(() => {
      if (anchor) {
        const value = anchorNow(anchor);
        if (Number.isFinite(value)) return new Date(Math.round(value));
      }
      if (provisional) {
        const value = provisionalNow(provisional);
        if (Number.isFinite(value)) return new Date(Math.round(value));
      }
      return deviceDate();
    }, deviceDate);
  }

  function state(): ClockState {
    return safe((): ClockState => {
      const base = {
        driftPpm,
        driftMeasured,
        lastJumpMs,
        lastError,
        nextSyncAfterMs: anchor?.nextSyncAfterMs ?? CLOCK_DEFAULTS.defaultNextSyncAfterMs,
      };
      if (anchor) {
        const jump = jumpOf(anchor);
        return {
          ...base,
          status: "calibrated",
          offsetMs: anchorNow(anchor) - options.wallNow(),
          uncertaintyMs: anchorUncertainty(anchor),
          calibratedAt: Math.round(anchor.utc),
          lastJumpMs: Math.abs(jump) > CLOCK_DEFAULTS.jumpThresholdMs ? jump : lastJumpMs,
          samples: anchor.samples,
          delayMs: anchor.delayMs,
          colo: anchor.colo,
        };
      }
      if (provisional) {
        return {
          ...base,
          status: "provisional",
          offsetMs: provisional.offsetMs,
          uncertaintyMs: provisionalUncertainty(provisional),
          calibratedAt: provisional.at,
          samples: 0,
          delayMs: null,
          colo: null,
        };
      }
      return {
        ...base,
        status: "device",
        offsetMs: 0,
        uncertaintyMs: Number.POSITIVE_INFINITY,
        calibratedAt: null,
        samples: 0,
        delayMs: null,
        colo: null,
      };
    }, (): ClockState => ({
      status: "device",
      offsetMs: 0,
      uncertaintyMs: Number.POSITIVE_INFINITY,
      driftPpm: CLOCK_DEFAULTS.assumedDriftPpm,
      driftMeasured: false,
      calibratedAt: null,
      lastJumpMs: 0,
      samples: 0,
      delayMs: null,
      colo: null,
      nextSyncAfterMs: CLOCK_DEFAULTS.defaultNextSyncAfterMs,
      lastError: "state_unavailable",
    }));
  }

  // --------------------------------------------------------------- sampling
  async function takeSample(): Promise<Measured | string> {
    const id = Math.floor(random() * 0xffffffff).toString(16).padStart(8, "0");
    const mono0 = options.monoNow();
    const t0 = Math.round(options.wallNow());
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const target = new URL(options.url);
      target.searchParams.set("t0", String(t0));
      target.searchParams.set("id", id);
      const response = await options.fetch(target.toString(), {
        method: "GET",
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      const mono3 = options.monoNow();
      if (!response.ok) return `http_${response.status}`;
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) return "bad_body";
      const data = body as Record<string, unknown>;
      if (data.v !== 1) return "bad_version";
      if (data.t0 !== t0 || data.id !== id) return "echo_mismatch";
      const { t1, t2, precisionMs } = data;
      if (!isFiniteNumber(t1) || !isFiniteNumber(t2) || !isFiniteNumber(precisionMs)) return "bad_fields";
      if (t2 < t1 || precisionMs < 0) return "bad_fields";
      // `t3` follows the monotonic clock, so a wall-clock change mid-request
      // cannot skew the sample.
      const t3 = t0 + (mono3 - mono0);
      const sample = computeSample(t0, t1, t2, t3, precisionMs);
      if (sample.delayMs > CLOCK_DEFAULTS.discardDelayMs) return "slow";
      if (sample.delayMs < -1) return "negative_delay";
      if (sample.delayMs < 0) {
        sample.delayMs = 0;
        sample.uncertaintyMs = precisionMs;
      }
      const next = data.nextSyncAfterMs;
      return {
        sample,
        mono: mono3,
        wall: t3,
        nextSyncAfterMs: isFiniteNumber(next) && next > 0 ? next : CLOCK_DEFAULTS.defaultNextSyncAfterMs,
        colo: typeof data.colo === "string" ? data.colo : null,
      };
    } catch (error) {
      return error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function burst(): Promise<{ best: Measured | null; valid: number; error: string | null }> {
    let valid = 0;
    let best: Measured | null = null;
    let taken = 0;
    let failures = 0;
    let error: string | null = null;
    while (taken < CLOCK_DEFAULTS.maxSamples) {
      const enough = taken >= CLOCK_DEFAULTS.baseSamples &&
        best !== null && best.sample.uncertaintyMs <= CLOCK_DEFAULTS.targetUncertaintyMs;
      if (enough) break;
      if (taken > 0) await sleep(spacingMs);
      taken += 1;
      const outcome = await takeSample();
      if (typeof outcome === "string") {
        error = outcome;
        failures += 1;
        if (failures >= 2 && best === null) break;
        continue;
      }
      valid += 1;
      if (best === null || outcome.sample.delayMs < best.sample.delayMs) best = outcome;
    }
    return { best, valid, error: best ? null : error ?? "no_samples" };
  }

  function adopt(measured: Measured, valid: number): void {
    const utc = measured.wall + measured.sample.offsetMs;
    const fresh: Anchor = {
      mono: measured.mono,
      utc,
      wall: measured.wall,
      uncertaintyMs: measured.sample.uncertaintyMs,
      offsetMs: measured.sample.offsetMs,
      delayMs: measured.sample.delayMs,
      samples: valid,
      colo: measured.colo,
      nextSyncAfterMs: measured.nextSyncAfterMs,
    };
    // Drift: how far the raw monotonic clock walked away from the server
    // between two calibrations. Short windows are noise, so they are skipped.
    if (anchor) {
      const elapsed = fresh.mono - anchor.mono;
      if (elapsed >= CLOCK_DEFAULTS.minDriftWindowMs) {
        const predicted = anchor.utc + elapsed;
        const ppm = ((utc - predicted) / elapsed) * 1e6;
        driftPpm = Math.max(CLOCK_DEFAULTS.minMeasuredDriftPpm, Math.abs(clampDrift(ppm)));
        driftMeasured = true;
      }
    }
    anchor = fresh;
    provisional = null;
    lastJumpMs = 0;
    lastError = null;
    failedAtMono = null;
    safe(() => options.store?.save({
      offsetMs: fresh.offsetMs,
      driftPpm,
      at: utc,
      uncertaintyMs: fresh.uncertaintyMs,
    }), () => undefined);
  }

  function runCalibration(): Promise<ClockState> {
    if (inflight) return inflight;
    backgroundStarted = true;
    inflight = (async () => {
      try {
        const { best, valid, error } = await burst();
        if (best) adopt(best, valid);
        else {
          lastError = error;
          failedAtMono = safe(() => options.monoNow(), () => 0);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.name : "error";
        failedAtMono = safe(() => options.monoNow(), () => 0);
      } finally {
        inflight = null;
      }
      return state();
    })();
    return inflight;
  }

  // ------------------------------------------------------------------- API
  async function ensure(opts: { maxUncertaintyMs?: number } = {}): Promise<ClockState> {
    try {
      const limit = opts.maxUncertaintyMs ?? CLOCK_DEFAULTS.maxUncertaintyMs;
      if (inflight && !anchor) return await inflight;
      if (anchor) {
        const jump = jumpOf(anchor);
        if (Math.abs(jump) > CLOCK_DEFAULTS.jumpThresholdMs) lastJumpMs = jump;
        const age = options.monoNow() - anchor.mono;
        const stale = Math.abs(jump) > CLOCK_DEFAULTS.jumpThresholdMs ||
          anchorUncertainty(anchor) > limit || age > anchor.nextSyncAfterMs;
        if (!stale) return state();
      } else if (provisional && provisionalUncertainty(provisional) <= limit) {
        // Usable estimate: refresh it in the background, once per load.
        if (!backgroundStarted && !cooling()) void runCalibration();
        return state();
      }
      if (cooling()) return state();
      return await runCalibration();
    } catch {
      return state();
    }
  }

  function cooling(): boolean {
    if (failedAtMono === null) return false;
    return safe(() => options.monoNow() - failedAtMono! < cooldownMs, () => false);
  }

  async function calibrate(): Promise<ClockState> {
    try {
      return await runCalibration();
    } catch {
      return state();
    }
  }

  return { now, state, ensure, calibrate };
}

/** `localStorage`-backed store; every access is wrapped, failure is harmless. */
export function createLocalStorageClockStore(
  key = "facta.clock",
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined =
    (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage,
): ClockStore {
  return {
    load() {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<StoredCalibration>;
        if (
          isFiniteNumber(value.offsetMs) && isFiniteNumber(value.at) &&
          isFiniteNumber(value.uncertaintyMs) && isFiniteNumber(value.driftPpm)
        ) {
          return value as StoredCalibration;
        }
        return null;
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
  };
}
