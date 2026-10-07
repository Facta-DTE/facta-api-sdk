// The emergency safeguard: one integrator-supplied function, nothing built in.
//
// Facta keeps every sealed document in a one-hour holding copy while it is
// written to durable storage. When the server says it could not store the
// document anywhere durable (or the SDK's own replication failed everywhere),
// that holding copy is the only one left. The SDK then hands the JSON, the PDF
// and what happened to `runtime.emergencyStore`, once per document.
//
// Hard rules:
//   * It runs only in an emergency: never on a normal issue, never on a timer.
//   * It runs AFTER the fiscal result exists and never throws into it.
//   * The SDK ships no storage of its own and sends bytes nowhere else.

import type { ArchiveArtifact, RemoteArtifactDestination } from "./archive.ts";
import { archivoDteOf } from "./archivo-dte.ts";
import type { DownloadedDocument, IssueResult } from "./types.ts";

/** Why the safeguard ran. */
export type EmergencyTrigger = "server_warning" | "no_destination" | "all_destinations_failed";

/** Why nothing was saved (`saved: false`), or the trigger when it was. */
export type EmergencyReason = EmergencyTrigger | "not_configured" | "store_failed";

export interface EmergencyFiles {
  /** The receiver's Archivo DTE as exact UTF-8 text; absent in contingency. */
  archivoDte?: string;
  /** The stored original (`{codigoGeneracion, ambiente, jws}`). */
  jsonRaw: string;
  /** The PDF, or `null` when neither the response nor holding had it. */
  pdf: Uint8Array | null;
}

export interface EmergencyInfo {
  codigoGeneracion: string;
  numeroControl: string;
  tipoDte: string;
  ambiente: string;
  fecEmi: string | null;
  /** The trigger. */
  reason: EmergencyTrigger;
  /** Server warning codes, verbatim; empty when the SDK itself detected the emergency. */
  warnings: string[];
  occurredAt: string;
}

/** Your function: write the files somewhere you own; throw to say you could not. */
export type EmergencyStoreFn = (files: EmergencyFiles, info: EmergencyInfo) => Promise<void>;

/** What `result.emergency` carries. */
export interface EmergencyReport {
  saved: boolean;
  /** The trigger when saved; `not_configured` or `store_failed` when not. */
  reason: EmergencyReason;
  trigger: EmergencyTrigger;
  /** Human text; when not saved it says to keep the files from the result. */
  detail: string;
}

export type EmergencyEvent = { info: EmergencyInfo; report: EmergencyReport };

export interface EmergencyHost {
  stamp(): string;
  download(code: string, kind: "json" | "pdf", options: { raw?: boolean; signal?: AbortSignal }): Promise<DownloadedDocument>;
}

/** The fields of a sealed or contingency result the safeguard reads. */
export type EmergencySource = Pick<IssueResult, "codigoGeneracion" | "numeroControl" | "ambiente" | "estado" | "tipoDte" | "jws"> & {
  fecEmi?: string | undefined;
  archivoJson?: string | undefined;
  archivoDte?: string | undefined;
  documento?: Record<string, unknown> | undefined;
  selloRecibido?: string | undefined;
  representacionGrafica?: string | null | undefined;
};

const SERVER_CODES = new Set(["sin_almacenamiento_duradero", "sin_copia_en_servidor", "copia_solo_temporal"]);

function warningCode(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry !== null && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    for (const key of ["codigo", "code"]) if (typeof record[key] === "string") return record[key] as string;
  }
  return null;
}

/**
 * The server warning codes that mean «no durable copy»: the three documented
 * names, plus anything starting with `sin_` or containing `temporal` (the exact
 * names are the server's to confirm).
 */
export function emergencyWarningCodes(result: unknown): string[] {
  if (result === null || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["advertencias", "warnings", "avisos"]) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const code = warningCode(item);
      if (code !== null && (SERVER_CODES.has(code) || code.startsWith("sin_") || code.includes("temporal"))) out.push(code);
    }
  }
  return [...new Set(out)];
}

export const EMERGENCY_STORE_MISSING_MESSAGE =
  "Configure runtime.emergencyStore: es la salvaguarda para guardar el JSON y el PDF si Facta no logra almacenarlos; sin ella, en una emergencia solo tendrá la copia temporal de 1 hora.";

let warnedMissing = false;
/** Console warning, once per process. */
export function warnEmergencyStoreMissing(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(`[facta] ${EMERGENCY_STORE_MISSING_MESSAGE}`);
}
/** Test hook. */
export function resetEmergencyStoreWarning(): void { warnedMissing = false; }

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

const CALLBACK_TIMEOUT_MS = 5_000;

export class EmergencyDesk {
  readonly #store: EmergencyStoreFn | undefined;
  readonly #onEmergency: ((event: EmergencyEvent) => void | Promise<void>) | undefined;
  readonly #host: EmergencyHost;
  readonly #seen = new Map<string, EmergencyReport>();

  constructor(store: EmergencyStoreFn | undefined, onEmergency: ((event: EmergencyEvent) => void | Promise<void>) | undefined, host: EmergencyHost) {
    this.#store = store;
    this.#onEmergency = onEmergency;
    this.#host = host;
  }

  get configured(): boolean { return this.#store !== undefined; }

  async #files(source: EmergencySource, signal?: AbortSignal): Promise<EmergencyFiles> {
    const code = source.codigoGeneracion;
    const sealed = source.estado === "sellado";
    const held = async (kind: "json" | "pdf", raw?: boolean): Promise<Uint8Array | null> => {
      try {
        return (await this.#host.download(code, kind, { ...(raw === undefined ? {} : { raw }), ...(signal ? { signal } : {}) })).bytes;
      } catch { return null; }
    };
    const text = (bytes: Uint8Array | null) => bytes === null ? null : new TextDecoder().decode(bytes);
    let archivoDte: string | null = null;
    if (sealed) {
      // The server's own field, then holding, and only then a file built from the JWS.
      archivoDte = typeof source.archivoDte === "string" && source.archivoDte ? source.archivoDte
        : text(await held("json")) ?? archivoDteOf(source as Parameters<typeof archivoDteOf>[0]);
    }
    let jsonRaw: string | null = typeof source.archivoJson === "string" && source.archivoJson ? source.archivoJson : text(await held("json", true));
    jsonRaw ??= JSON.stringify({ codigoGeneracion: code, ambiente: source.ambiente, jws: source.jws });
    let pdf: Uint8Array | null = null;
    if (sealed) {
      try {
        pdf = typeof source.representacionGrafica === "string" && source.representacionGrafica ? base64Bytes(source.representacionGrafica) : null;
      } catch { pdf = null; }
      pdf ??= await held("pdf");
    }
    return { ...(archivoDte === null ? {} : { archivoDte }), jsonRaw, pdf };
  }

  /**
   * Hand the document to the integrator's function, once per code. Never throws;
   * a second call for the same document returns the first report.
   */
  async protect(source: EmergencySource, trigger: EmergencyTrigger, options: { signal?: AbortSignal; warnings?: string[] } = {}): Promise<EmergencyReport> {
    const code = source.codigoGeneracion;
    const earlier = this.#seen.get(code);
    if (earlier) return earlier;
    const info: EmergencyInfo = {
      codigoGeneracion: code,
      numeroControl: source.numeroControl,
      tipoDte: source.tipoDte,
      ambiente: source.ambiente,
      fecEmi: source.fecEmi ?? null,
      reason: trigger,
      warnings: options.warnings ?? emergencyWarningCodes(source),
      occurredAt: this.#host.stamp(),
    };
    let report: EmergencyReport;
    if (this.#store === undefined) {
      report = {
        saved: false, reason: "not_configured", trigger,
        detail: `${EMERGENCY_STORE_MISSING_MESSAGE} Keep archivoDte, archivoJson and representacionGrafica from this result: the server's holding copy lasts about one hour.`,
      };
    } else {
      try {
        await this.#store(await this.#files(source, options.signal), info);
        report = { saved: true, reason: trigger, trigger, detail: "This document is not in permanent storage; it was handed to runtime.emergencyStore." };
      } catch {
        report = {
          saved: false, reason: "store_failed", trigger,
          detail: "runtime.emergencyStore threw. Keep archivoDte, archivoJson and representacionGrafica from this result NOW: the server's holding copy lasts about one hour.",
        };
      }
    }
    this.#seen.set(code, report);
    if (this.#onEmergency) {
      try {
        await Promise.race([
          Promise.resolve(this.#onEmergency({ info, report })),
          new Promise<void>((resolve) => setTimeout(resolve, CALLBACK_TIMEOUT_MS)),
        ]);
      } catch { /* the integrator's alert must not break the safeguard */ }
    }
    return report;
  }
}

/** The pieces `replicate` needs from the client. */
export interface EmergencyReplicationHost {
  destinations(info: Pick<EmergencyInfo, "numeroControl" | "fecEmi">): Promise<RemoteArtifactDestination[]>;
  reportCopy(code: string, destination: RemoteArtifactDestination, pdfStored: boolean): Promise<boolean>;
}

export interface EmergencyReplication {
  /** Destinations that confirmed a verified copy of the JSON (and the PDF when given). */
  stored: string[];
  /** Destinations where it did not land. */
  failed: string[];
}

/**
 * Re-try normal replication from files the integrator hands back (the ones its
 * emergency store kept): every configured or synced destination, then the copy
 * report to Facta. Cheap, explicit, and the SDK keeps nothing.
 */
export async function replicateEmergency(
  host: EmergencyReplicationHost,
  files: EmergencyFiles,
  info: Pick<EmergencyInfo, "codigoGeneracion" | "numeroControl" | "fecEmi">,
  stamp: () => string,
): Promise<EmergencyReplication> {
  void stamp;
  const encoder = new TextEncoder();
  const sha = async (bytes: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer as ArrayBuffer)), (b) => b.toString(16).padStart(2, "0")).join("");
  const code = info.codigoGeneracion;
  const jsonBytes = encoder.encode(files.jsonRaw);
  const artifacts: ArchiveArtifact[] = [{ codigoGeneracion: code, kind: "json" as const, filename: `${code}.json`, contentType: "application/json", bytes: jsonBytes, sha256: await sha(jsonBytes) }];
  if (files.pdf) artifacts.push({ codigoGeneracion: code, kind: "pdf" as const, filename: `${code}.pdf`, contentType: "application/pdf", bytes: files.pdf, sha256: await sha(files.pdf) });
  const stored: string[] = [];
  const failed: string[] = [];
  for (const destination of await host.destinations(info)) {
    const wanted = artifacts.filter((artifact) => destination.kinds === undefined || destination.kinds.includes(artifact.kind));
    let ok = wanted.some((artifact) => artifact.kind === "json");
    const states = new Set<string>();
    for (const artifact of wanted) {
      try {
        if (await destination.write(artifact) === "stored") states.add(artifact.kind); else ok = false;
      } catch { ok = false; }
    }
    if (ok) {
      stored.push(destination.id);
      if (destination.canonicalCopy !== undefined) {
        try { await host.reportCopy(code, destination, states.has("pdf")); } catch { /* stored copy stays valid */ }
      }
    } else failed.push(destination.id);
  }
  return { stored, failed };
}
