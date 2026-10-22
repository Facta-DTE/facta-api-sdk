// Processing times shown by the playground when «Mostrar tiempos (depuración)» is on. Pure data shared by the
// Worker (which measures its own steps) and the page (which draws them). Nothing here is secret.
//
// Two sources are merged into one list:
//   playground  the steps of THIS Worker: Turnstile, building the session, the quota gates, the SDK handler…
//   api         the steps the API reports when the request carries `X-Facta-Debug: timings`
//               (the SDK's `debug: { timings: true }`). Until the API ships that, only the first kind exists.

/** Request header the page sends to ask the Worker for its timings. Off by default. */
export const TIMINGS_HEADER = "x-playground-timings";

export interface TimingStep {
  step: string;
  /** Duration, milliseconds. */
  ms: number;
  /** Milliseconds from the start of the request to the start of this step. */
  startedAtMs: number;
  source: "playground" | "api";
}

export interface Timings {
  steps: TimingStep[];
  /** Wall time of the request as the Worker saw it. */
  totalMs: number;
  /** True when the API returned its own breakdown (so `source: "api"` steps exist). */
  apiBreakdown: boolean;
  /** The functions region that served the API calls (`x-sb-edge-region`), when known. */
  region?: string | null;
}

/** The note the page shows while the API has not returned a breakdown. */
export const API_BREAKDOWN_PENDING = "El desglose del API aparece cuando el API lo devuelva.";

/** Rounds to one decimal: the table is for reading, not for benchmarking. */
export const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

/** Collects steps relative to one start. `now` is injectable for tests. */
export class Timeline {
  readonly #steps: TimingStep[] = [];
  readonly #t0: number;
  #apiBreakdown = false;
  #region: string | null = null;

  constructor(readonly now: () => number = Date.now) {
    this.#t0 = now();
  }

  /** Runs `fn` and records how long it took, even when it throws. */
  async measure<T>(step: string, fn: () => Promise<T> | T, source: TimingStep["source"] = "playground"): Promise<T> {
    const started = this.now();
    try {
      return await fn();
    } finally {
      this.#steps.push({ step, ms: roundMs(this.now() - started), startedAtMs: roundMs(started - this.#t0), source });
    }
  }

  /** Records a step that was measured elsewhere, at an absolute epoch time. */
  record(step: string, ms: number, startedAt: number, source: TimingStep["source"] = "playground"): void {
    this.#steps.push({ step, ms: roundMs(ms), startedAtMs: roundMs(Math.max(0, startedAt - this.#t0)), source });
  }

  /**
   * Adds what the API reported for one call that started `callStartedAt` (epoch ms). Steps without a start
   * are laid end to end from the call's start.
   */
  addApi(debug: { timings?: Array<{ step: string; ms: number; startedAtMs?: number }> } | null | undefined, callStartedAt: number, label = "API"): void {
    if (debug === null || debug === undefined || !Array.isArray(debug.timings) || debug.timings.length === 0) return;
    this.#apiBreakdown = true;
    let cursor = 0;
    for (const t of debug.timings) {
      const offset = t.startedAtMs ?? cursor;
      cursor = offset + t.ms;
      this.record(`${label} · ${t.step}`, t.ms, callStartedAt + offset, "api");
    }
  }

  /** The region the API answered from, shown above the steps. */
  setRegion(region: string | null | undefined): void {
    if (typeof region === "string" && region !== "") this.#region = region;
  }

  toJSON(): Timings {
    const steps = [...this.#steps].sort((a, b) => a.startedAtMs - b.startedAtMs);
    return {
      steps,
      totalMs: roundMs(this.now() - this.#t0),
      apiBreakdown: this.#apiBreakdown,
      ...(this.#region === null ? {} : { region: this.#region }),
    };
  }
}

/** Does this request ask for timings? */
export const wantsTimings = (request: Request): boolean => request.headers.get(TIMINGS_HEADER) === "1";
