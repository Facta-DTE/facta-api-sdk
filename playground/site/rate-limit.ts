// The API key of the playground has a rate limit of its own, shared by every visitor. When the API says
// `rate_limited`, the whole page shows ONE friendly banner (components/rate-limit-banner.tsx) instead of
// each component inventing its own error.

import { useSyncExternalStore } from "react";

export const RATE_LIMIT_BANNER = "El playground alcanzó el límite de pruebas por hora; intente en unos minutos.";
const SHOWN_FOR_MS = 60_000;

let until = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function reportRateLimit(): void {
  until = Date.now() + SHOWN_FOR_MS;
  clearTimeout(timer);
  timer = setTimeout(clearRateLimit, SHOWN_FOR_MS);
  emit();
}

export function clearRateLimit(): void {
  clearTimeout(timer);
  until = 0;
  emit();
}

export const isRateLimited = (): boolean => until > Date.now();

export function useRateLimited(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => void listeners.delete(listener); }, isRateLimited, () => false);
}

/** True for the API's own rate limit (not the playground's visitor quota, which is `quota_exceeded`). */
export const isApiRateLimit = (code: unknown): boolean => code === "rate_limited";
