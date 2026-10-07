// «Mostrar tiempos (depuración)»: a per-visitor switch, off by default, that asks the Worker for the processing
// time of every step. Persisted in this browser only. When it is off nothing extra is requested.
//
// This store also keeps what the last issue taught the page: was it a replay of an order already issued, and
// (when the switch is on) the timings of preparing the session and of issuing.

import { useSyncExternalStore } from "react";
import { TIMINGS_HEADER, type Timings } from "../shared/timings.ts";

const STORAGE_KEY = "facta-playground-timings";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let enabled = typeof window === "undefined" ? false : readStored();
/** What the last issue taught the page. */
export interface IssueInsight {
  /** The order was already issued: the API answered with the original document. */
  replay: boolean;
  /** Preparing the session (`POST /api/session`), when timings were on. */
  session: Timings | null;
  /** Issuing (`POST /api/facta`), when timings were on. */
  issue: Timings | null;
  code: string | null;
  /** Order number of the sale that was prepared last (what the key is made of). */
  orderNumber: string | null;
}

let sessionTimings: Timings | null = null;
let lastOrder: string | null = null;
let insight: IssueInsight | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); };

export const timingsEnabled = (): boolean => enabled;

export function setTimingsEnabled(value: boolean): void {
  enabled = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Private mode: the switch still works for this page view.
  }
  if (!value) {
    sessionTimings = null;
    if (insight !== null) insight = { ...insight, session: null, issue: null };
  }
  emit();
}

export function useTimingsEnabled(): boolean {
  return useSyncExternalStore(subscribe, timingsEnabled, () => false);
}

/** The header that asks the Worker for its timings; empty when the switch is off. */
export const timingsHeaders = (): Record<string, string> => (enabled ? { [TIMINGS_HEADER]: "1" } : {});

/** From `POST /api/session`: remember the session's timings and the order number it was built from. */
export function publishSession(timings: Timings | undefined, orderNumber: string | null): void {
  sessionTimings = timings ?? null;
  lastOrder = orderNumber;
  // A new session is a new attempt: what the previous issue taught no longer describes what is on screen.
  insight = null;
  emit();
}

/** From `POST /api/facta` (issue): the replay flag and the timings. */
export function publishIssue(meta: { replay: boolean; timings?: Timings }, code: string | null): void {
  insight = { replay: meta.replay, session: sessionTimings, issue: meta.timings ?? null, code, orderNumber: lastOrder };
  emit();
}

export const clearInsight = (): void => { insight = null; emit(); };

export function useIssueInsight(): IssueInsight | null {
  return useSyncExternalStore(subscribe, () => insight, () => null);
}
