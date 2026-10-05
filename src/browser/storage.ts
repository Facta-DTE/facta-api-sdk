// A quiet summary of where the document's copies stand. It never alters the
// fiscal outcome: «pending» is the integrator's server catching up, not a failure.

import type { StorageSummary } from "./wire.ts";

export type StorageTone = "saved" | "pending" | "off";

export function storageTone(storage: StorageSummary | undefined): StorageTone | null {
  if (!storage) return null;
  const { managed, archive, copies } = storage;
  const copiesPending = (copies?.pending ?? 0) + (copies?.failed ?? 0) > 0;
  if (archive === "partial" || archive === "failed" || copiesPending || managed === "pending" || managed === "failed") {
    return "pending";
  }
  if (archive === "complete" || managed === "stored") return "saved";
  return "off";
}
