// Debug timings: a debugging aid, never on unless the caller asks (`debug: { timings: true }`).
// The API answers with `debug: { timings, totalMs }` in the body and a `Server-Timing` header;
// this module reads either, defensively, because it is untrusted input from the network.

import type { DebugInfo, DebugTiming } from "./types.ts";

export const DEBUG_HEADER = "X-Facta-Debug";
export const DEBUG_TIMINGS = "timings";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The body's `debug` member, kept only when it has the documented shape. */
export function debugFromBody(value: unknown): DebugInfo | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as { timings?: unknown; totalMs?: unknown };
  if (!Array.isArray(raw.timings)) return null;
  const timings: DebugTiming[] = [];
  for (const entry of raw.timings) {
    const item = entry as { step?: unknown; ms?: unknown; startedAtMs?: unknown } | null;
    if (item === null || typeof item !== "object" || typeof item.step !== "string" || !finite(item.ms)) continue;
    timings.push({ step: item.step.slice(0, 80), ms: item.ms, ...(finite(item.startedAtMs) ? { startedAtMs: item.startedAtMs } : {}) });
  }
  const totalMs = finite(raw.totalMs) ? raw.totalMs : timings.reduce((sum, t) => sum + t.ms, 0);
  return { timings, totalMs, source: "body" };
}

/**
 * `Server-Timing: auth;dur=3.2, mh;dur=410, total;dur=498` -> steps. A metric named `total`
 * is the total, not a step. Null when the header names no duration.
 */
export function debugFromServerTiming(header: string | null): DebugInfo | null {
  if (header === null || header.trim() === "") return null;
  const timings: DebugTiming[] = [];
  let total: number | null = null;
  for (const metric of header.split(",")) {
    const [name, ...params] = metric.split(";").map((part) => part.trim());
    if (name === undefined || name === "") continue;
    const dur = params.map((p) => /^dur=([0-9.]+)$/i.exec(p)?.[1]).find((v) => v !== undefined);
    const ms = dur === undefined ? Number.NaN : Number(dur);
    if (!finite(ms)) continue;
    if (name.toLowerCase() === "total") total = ms;
    else timings.push({ step: name.slice(0, 80), ms });
  }
  if (timings.length === 0 && total === null) return null;
  return { timings, totalMs: total ?? timings.reduce((sum, t) => sum + t.ms, 0), source: "server-timing" };
}
