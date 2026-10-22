// Runs one recipe stage: builds a recording client, executes, then turns the
// outcome into what the browser may see (steps, redacted result, files).

import { Facta } from "../../../src/client.ts";
import { FactaError } from "../../../src/errors.ts";
import type { PlaygroundEnv } from "../env.ts";
import { archivoDteFromStored, archivoDteOf, dteFileName, rawFileName } from "../../shared/archivo-dte.ts";
import { debugFromBody, debugFromServerTiming } from "../../../src/debug.ts";
import type { DebugInfo } from "../../../src/types.ts";
import { refuseCatalogWrites } from "../catalog-writes.ts";
import { leaksSecret, redact, redactText, type RedactOptions } from "./redact.ts";

export interface Step {
  method: string;
  /** Path and query below the API's base URL. */
  endpoint: string;
  status: number | null;
  ms: number;
  /** Request body, redacted and shortened. Absent for GET. */
  request?: unknown;
  /** Epoch ms when the call started (only with timings on). */
  at?: number;
  /** What the API reported about its own processing of this call (only with timings on and an API that returns it). */
  api?: DebugInfo;
}

export interface FileOut {
  /** `dte` is the Archivo DTE (what the visitor should see), `raw` the stored original; absent for a PDF. */
  role?: "dte" | "raw";
  name: string;
  contentType: string;
  size: number;
  /** Absent when the file is larger than the cap. */
  base64?: string;
}

export interface ExecOutcome {
  result: unknown;
  /** Documents sealed (or in contingency) by this stage, to hand proofs for. */
  issued?: Array<{ codigoGeneracion: string; tipoDte: string; numeroControl: string; estado: string; total?: number }>;
  invalidated?: string[];
  /** Documents a return event was sealed on (counts like an issue). */
  returned?: string[];
  continuation?: string;
  /** Bulky members to keep in the redacted result (e.g. the canonical `documento`). */
  keep?: string[];
  /** Exact result paths whose `token` member is shown on purpose (see `RedactOptions.keepAt`). */
  keepAt?: string[];
}

export interface RunOutput {
  ok: boolean;
  steps: Step[];
  totalMs: number;
  result: unknown;
  files: FileOut[];
  error?: { code: string; status: number; message: string; spent?: { codigoGeneracion: string; numeroControl: string }; observations?: string[] };
}

export const MAX_FILE_BYTES = 2_000_000;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const SAFE_NAME = /[^A-Za-z0-9._-]/g;

function fileOf(name: string, contentType: string, bytes: Uint8Array): FileOut {
  const safe = name.replace(SAFE_NAME, "_").slice(0, 80) || "archivo";
  return {
    name: safe,
    contentType,
    size: bytes.byteLength,
    ...(bytes.byteLength <= MAX_FILE_BYTES ? { base64: toBase64(bytes) } : {}),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Pull the files out of a result: a sealed document's PDF and JSON and any downloaded bytes.
 *
 * The JSON comes in two files: `<code>.json`, the Archivo DTE (always, once there is a seal), and
 * `<code>.raw.json`, the stored original. A document in contingency has no seal yet, so it has no
 * Archivo DTE: only the raw file is offered. A file that would carry a credential or a storage path
 * is dropped instead of sent.
 */
export function collectFiles(result: unknown, secrets: readonly (string | undefined)[] = []): FileOut[] {
  const files: FileOut[] = [];
  const seen = new Set<unknown>();
  const add = (file: FileOut, text?: string) => {
    if (text !== undefined && leaksSecret(text, secrets)) return;
    files.push(file);
  };
  const visit = (node: unknown, depth: number, seal: string | null) => {
    if (!isRecord(node) || depth > 3 || seen.has(node)) return;
    seen.add(node);
    const here = typeof node.selloRecibido === "string" && node.selloRecibido !== "" ? node.selloRecibido : seal;
    const code = typeof node.codigoGeneracion === "string" ? node.codigoGeneracion : null;
    if (code !== null && typeof node.representacionGrafica === "string" && node.representacionGrafica !== "") {
      const bytes = Uint8Array.from(atob(node.representacionGrafica), (c) => c.charCodeAt(0));
      files.push(fileOf(`${code}.pdf`, "application/pdf", bytes));
    }
    if (code !== null && (typeof node.jws === "string" || typeof node.archivoDte === "string")) {
      const dte = archivoDteOf(node);
      if (dte !== null) add({ role: "dte", ...fileOf(dteFileName(code), "application/json", new TextEncoder().encode(dte)) }, dte);
    }
    if (code !== null && typeof node.archivoJson === "string" && node.archivoJson !== "") {
      add({ role: "raw", ...fileOf(rawFileName(code), "application/json", new TextEncoder().encode(node.archivoJson)) }, node.archivoJson);
    }
    if (node.bytes instanceof Uint8Array) {
      const kind = typeof node.kind === "string" ? node.kind : "archivo";
      const type = typeof node.contentType === "string" ? node.contentType : "application/octet-stream";
      if (kind === "json") {
        const name = code ?? "documento";
        const stored = new TextDecoder().decode(node.bytes);
        const dte = archivoDteFromStored(stored, here);
        if (dte !== null) add({ role: "dte", ...fileOf(dteFileName(name), type, new TextEncoder().encode(dte)) }, dte);
        add({ role: "raw", ...fileOf(rawFileName(name), type, node.bytes) }, stored);
      } else {
        files.push(fileOf(`${code ?? "documento"}.pdf`, type, node.bytes));
      }
    }
    for (const child of Object.values(node)) visit(child, depth + 1, here);
  };
  visit(result, 0, null);
  return files;
}

export interface Recorder {
  fetch: typeof globalThis.fetch;
  steps: Step[];
}

/** A fetch that records method, endpoint, status, duration and the redacted body. Never headers. */
export function recordingFetch(base: string, inner: typeof globalThis.fetch, redaction: RedactOptions, captureDebug = false): Recorder {
  const steps: Step[] = [];
  const recorded: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const started = Date.now();
    const step: Step = { method, endpoint: url.startsWith(base) ? url.slice(base.length) : "(otra dirección)", status: null, ms: 0 };
    if (typeof init?.body === "string") {
      try {
        step.request = redact(JSON.parse(init.body), { ...redaction, maxString: 200 });
      } catch {
        step.request = "[cuerpo no JSON]";
      }
    }
    steps.push(step);
    try {
      const response = await inner(input, init);
      step.status = response.status;
      if (captureDebug) {
        step.at = started;
        // The API's own breakdown: the body's `debug` member first, the Server-Timing header as the fallback.
        let fromBody: DebugInfo | null = null;
        if ((response.headers.get("content-type") ?? "").includes("json")) {
          fromBody = debugFromBody(((await response.clone().json().catch(() => null)) as { debug?: unknown } | null)?.debug);
        }
        const found = fromBody ?? debugFromServerTiming(response.headers.get("server-timing"));
        if (found !== null) step.api = found;
      }
      return response;
    } finally {
      step.ms = Date.now() - started;
    }
  };
  return { fetch: recorded, steps };
}

export function secretsOf(env: PlaygroundEnv): string[] {
  return [env.FACTA_API_KEY, env.FACTA_SIGN_KEY, env.FACTA_UNLOCK_KEY, env.FACTA_SESSION_SECRET].filter((v): v is string => Boolean(v));
}

// What this Worker isolate learned from `/v1/status`. A recipe builds a fresh client per run; handing it the
// region keeps the discovery request out of the steps the page shows.
let learnedRegion: string | undefined;

/** The `region` option for a recipe client: learned once per isolate, never throws, `{}` when unknown. */
async function regionOption(env: PlaygroundEnv, innerFetch: typeof globalThis.fetch | undefined): Promise<{ region?: string }> {
  if (learnedRegion === undefined) {
    try {
      const probe = new Facta({
        apiKey: env.FACTA_API_KEY!,
        baseUrl: env.FACTA_API_BASE_URL!.replace(/\/+$/, ""),
        fetch: innerFetch ?? ((input, init) => globalThis.fetch(input, init)),
        clock: false,
        maxRetries: 0,
      });
      learnedRegion = (await probe.region()) ?? undefined;
    } catch { /* the SDK never throws here; belt and braces */ }
  }
  return learnedRegion === undefined ? {} : { region: learnedRegion };
}

export function buildRecordedFacta(env: PlaygroundEnv, innerFetch: typeof globalThis.fetch | undefined, redaction: RedactOptions, timings = false, region: { region?: string } = {}) {
  const base = env.FACTA_API_BASE_URL!.replace(/\/+$/, "");
  const recorder = recordingFetch(base, innerFetch ?? ((input, init) => globalThis.fetch(input, init)), redaction, timings);
  const facta = new Facta({
    apiKey: env.FACTA_API_KEY!,
    signKey: env.FACTA_SIGN_KEY!,
    ...(env.FACTA_UNLOCK_KEY ? { unlockKey: env.FACTA_UNLOCK_KEY } : {}),
    baseUrl: base,
    fetch: recorder.fetch,
    ...region,
    // A debugging aid, only when the page asked for timings: the SDK then sends `X-Facta-Debug: timings`.
    ...(timings ? { debug: { timings: true } } : {}),
  });
  return { facta, recorder };
}

export async function execute(
  env: PlaygroundEnv,
  innerFetch: typeof globalThis.fetch | undefined,
  exec: (facta: Facta) => Promise<ExecOutcome>,
  run: { timings?: boolean } = {},
): Promise<{ output: RunOutput; outcome: ExecOutcome | null; servedRegion: string | null }> {
  const redaction: RedactOptions = { secrets: secretsOf(env) };
  const { facta, recorder } = buildRecordedFacta(env, innerFetch, redaction, run.timings === true, await regionOption(env, innerFetch));
  const started = Date.now();
  let outcome: ExecOutcome | null = null;
  let error: RunOutput["error"];
  try {
    outcome = await exec(refuseCatalogWrites(facta));
  } catch (cause) {
    if (cause instanceof FactaError) {
      const spent = cause.spent;
      error = {
        code: cause.code,
        status: cause.status,
        message: redactText(cause.message, redaction),
        ...(spent === null ? {} : { spent }),
        ...(cause.mhObservations.length === 0 ? {} : { observations: cause.mhObservations.map((o) => redactText(o, redaction)) }),
      };
    } else {
      const name = (cause as { name?: unknown } | null)?.name;
      error = { code: "recipe_failed", status: 0, message: name === "AbortError" || name === "TimeoutError" ? "La llamada se canceló por tiempo." : "La receta no pudo completarse." };
    }
  }
  const options: RedactOptions = { ...redaction, ...(outcome?.keep ? { keep: outcome.keep } : {}), ...(outcome?.keepAt ? { keepAt: outcome.keepAt } : {}) };
  const output: RunOutput = {
    ok: error === undefined,
    steps: recorder.steps,
    totalMs: Date.now() - started,
    result: outcome === null ? null : redact(outcome.result, options),
    files: outcome === null ? [] : collectFiles(outcome.result, redaction.secrets),
    ...(error === undefined ? {} : { error }),
  };
  return { output, outcome, servedRegion: facta.servedRegion };
}
