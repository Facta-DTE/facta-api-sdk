// Completing `listDocuments({ include: ["dte"] })` rows.
//
// The API opens what it can (retention area, managed storage, the JWS it keeps
// for documents it issued). A document issued from the Facta app whose only
// copy lives in the company's own storage is marked `needs_local_decrypt` with
// the ledger's pointers; this module finishes those rows locally, with the
// destinations that `unlockKey` opens, so the integrator gets `archivoDte` and
// `resumen` either way. Nothing here is sent to Facta.

import { archivoDteOf } from "./archivo-dte.ts";
import { summarizeArchivoDte } from "./archivo-dte-summary.ts";
import type { RemoteArtifactDestination } from "./archive.ts";
import type { ListedDte, ListedDteError } from "./types.ts";

export const LOCAL_READ_CONCURRENCY = 4;

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The Archivo DTE of a stored JSON in any of the shapes a destination holds:
 * the app's archived record (`firma` + `documento` + `respuestaMh`), the API's
 * stored original (`jws`), or a receiver file that already is the Archivo DTE.
 * The row's own seal fills in when the file has none. `null` when it is none of
 * them or the document has no seal.
 */
export function archivoDteFromStored(stored: string | Uint8Array, rowSeal: string | null): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof stored === "string" ? stored : new TextDecoder().decode(stored));
  } catch {
    return null;
  }
  if (!isDict(parsed)) return null;
  const compact = (value: unknown): value is string => typeof value === "string" && value.split(".").length === 3;
  if (compact(parsed["firmaElectronica"]) && isDict(parsed["identificacion"])) {
    // Already the receiver's file: hand it back as the destination holds it.
    return nonEmpty(parsed["selloRecibido"]) !== null || rowSeal === null
      ? (typeof stored === "string" ? stored : new TextDecoder().decode(stored))
      : archivoDteOf({ jws: parsed["firmaElectronica"], selloRecibido: rowSeal });
  }
  if (compact(parsed["firma"]) && isDict(parsed["documento"])) {
    const response = parsed["respuestaMh"];
    const seal = (isDict(response) ? nonEmpty(response["selloRecibido"]) : null) ?? rowSeal;
    return archivoDteOf({ jws: parsed["firma"], documento: parsed["documento"], selloRecibido: seal });
  }
  if (compact(parsed["jws"])) {
    return archivoDteOf({ jws: parsed["jws"], selloRecibido: nonEmpty(parsed["selloRecibido"]) ?? rowSeal });
  }
  return null;
}

/** Attach `resumen` to rows that carry `archivoDte`; a text that is not a DTE becomes a `dteError`. */
export function summarizeRows(rows: ListedDte[]): void {
  for (const row of rows) {
    if (typeof row.archivoDte !== "string") continue;
    const resumen = summarizeArchivoDte(row.archivoDte);
    if (resumen === null) {
      delete row.archivoDte;
      row.dteError = { code: "invalid_archivo_dte", message: "El documento recibido no tiene la forma de un Archivo DTE." };
    } else {
      row.resumen = resumen;
    }
  }
}

export const NEEDS_UNLOCK_KEY: ListedDteError = {
  code: "needs_local_decrypt",
  message:
    "Este documento solo se puede leer desde su propio almacenamiento. Configure `unlockKey` (FACTA_UNLOCK_KEY) en el cliente para completarlo automáticamente.",
};

async function inBatches<T>(items: T[], width: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

/**
 * Finish every `needs_local_decrypt` row. `open` returns the destinations the
 * unlock key opens (called once, lazily); when it throws, each pending row
 * keeps a `dteError` saying why. Never throws.
 */
export async function completeLocally(
  rows: ListedDte[],
  options: { unlockKeyConfigured: boolean; open: () => Promise<RemoteArtifactDestination[]>; signal?: AbortSignal },
): Promise<void> {
  const pending = rows.filter((row) => row.dteError?.code === "needs_local_decrypt");
  if (pending.length === 0) return;
  if (!options.unlockKeyConfigured) {
    for (const row of pending) row.dteError = { ...NEEDS_UNLOCK_KEY, ...(row.dteError?.destinos ? { destinos: row.dteError.destinos } : {}) };
    return;
  }
  let destinations: RemoteArtifactDestination[];
  try {
    destinations = await options.open();
  } catch (cause) {
    const code = typeof (cause as { code?: unknown })?.code === "string" ? (cause as { code: string }).code : "unexpected_error";
    for (const row of pending) {
      row.dteError = {
        code: "destinations_unavailable",
        message: `No se pudieron abrir los destinos de almacenamiento con la unlockKey (${code}).`,
        ...(row.dteError?.destinos ? { destinos: row.dteError.destinos } : {}),
      };
    }
    return;
  }
  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  await inBatches(pending, LOCAL_READ_CONCURRENCY, async (row) => {
    const pointers = [...(row.dteError?.destinos ?? [])].sort((a, b) => Number(b.verificada) - Number(a.verificada));
    for (const pointer of pointers) {
      const destination = byId.get(pointer.id);
      if (destination?.read === undefined) continue;
      try {
        const bytes = await destination.read(pointer.rutaJson, options.signal ? { signal: options.signal } : {});
        if (bytes === null) continue;
        const archivo = archivoDteFromStored(bytes, row.selloRecibido ?? null);
        if (archivo === null) continue;
        delete row.dteError;
        row.archivoDte = archivo;
        return;
      } catch {
        // Never echo the error: it can quote the credential. Try the next copy.
      }
    }
    row.dteError = {
      code: "destination_read_failed",
      message: "Ninguna copia en sus destinos pudo leerse como Archivo DTE (¿sin sello, destino sin acceso o archivo ausente?).",
      ...(row.dteError?.destinos ? { destinos: row.dteError.destinos } : {}),
    };
  });
}
