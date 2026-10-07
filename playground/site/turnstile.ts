// Cloudflare Turnstile on the page: one single-use token per costly action.
//
// `TurnstileBox` (components/turnstile.tsx) renders the managed widget beside the action's button and
// hands every solved token to this store. The API calls that cost something (a sale session, a resend,
// a recipe run, an invalidation) call `turnstileHeaders()`, which TAKES the token (it is single-use) and
// asks the widget for a fresh one. Buttons stay disabled until `useTurnstileReady()` says a token exists.

import { useSyncExternalStore } from "react";

let token: string | null = null;
/** True once the server's state said Turnstile is on for this deployment. */
let required = false;
const listeners = new Set<() => void>();
const resetters = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function setTurnstileRequired(value: boolean): void {
  if (required === value) return;
  required = value;
  emit();
}

export function setTurnstileToken(next: string | null): void {
  token = next;
  emit();
}

/** Widgets register here so a spent token is replaced by a fresh challenge. */
export function onTurnstileReset(reset: () => void): () => void {
  resetters.add(reset);
  return () => void resetters.delete(reset);
}

/** The header for one costly request. Takes the token: it cannot be used twice. */
export function turnstileHeaders(): Record<string, string> {
  if (!required) return {};
  const taken = token;
  token = null;
  emit();
  resetters.forEach((reset) => reset());
  return taken === null ? {} : { "x-turnstile-token": taken };
}

/** True when no verification is needed, or a solved token is waiting. */
export function useTurnstileReady(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => void listeners.delete(listener); },
    () => !required || token !== null,
    () => true,
  );
}
