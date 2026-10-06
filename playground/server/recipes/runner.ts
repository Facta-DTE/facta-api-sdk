// Runs one recipe stage: builds a recording client, executes, then turns the
// outcome into what the browser may see (steps, redacted result, files).

import { Facta } from "../../../src/client.ts";
import { FactaError } from "../../../src/errors.ts";
import type { PlaygroundEnv } from "../env.ts";
import { redact, redactText, type RedactOptions } from "./redact.ts";

export interface Step {
  method: string;
  /** Path and query below the API's base URL. */
  endpoint: string;
  status: number | null;
  ms: number;
  /** Request body, redacted and shortened. Absent for GET. */
  request?: unknown;
}

export interface FileOut {
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
  continuation?: string;
  /** Bulky members to keep in the redacted result (e.g. the canonical `documento`). */
  keep?: string[];
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

/** Pull the files out of a result: a sealed document's PDF/JSON and any downloaded bytes. */
export function collectFiles(result: unknown): FileOut[] {
  const files: FileOut[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number) => {
    if (!isRecord(node) || depth > 3 || seen.has(node)) return;
    seen.add(node);
    const code = typeof node.codigoGeneracion === "string" ? node.codigoGeneracion : null;
    if (code !== null && typeof node.representacionGrafica === "string" && node.representacionGrafica !== "") {
      const bytes = Uint8Array.from(atob(node.representacionGrafica), (c) => c.charCodeAt(0));
      files.push(fileOf(`${code}.pdf`, "application/pdf", bytes));
    }
    if (code !== null && typeof node.archivoJson === "string" && node.archivoJson !== "") {
      files.push(fileOf(`${code}.json`, "application/json", new TextEncoder().encode(node.archivoJson)));
    }
    if (node.bytes instanceof Uint8Array) {
      const kind = typeof node.kind === "string" ? node.kind : "archivo";
      const extension = kind === "json" ? "json" : "pdf";
      files.push(fileOf(`${code ?? "documento"}.${extension}`, typeof node.contentType === "string" ? node.contentType : "application/octet-stream", node.bytes));
    }
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(result, 0);
  return files;
}

export interface Recorder {
  fetch: typeof globalThis.fetch;
  steps: Step[];
}

/** A fetch that records method, endpoint, status, duration and the redacted body. Never headers. */
export function recordingFetch(base: string, inner: typeof globalThis.fetch, redaction: RedactOptions): Recorder {
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

export function buildRecordedFacta(env: PlaygroundEnv, innerFetch: typeof globalThis.fetch | undefined, redaction: RedactOptions) {
  const base = env.FACTA_API_BASE_URL!.replace(/\/+$/, "");
  const recorder = recordingFetch(base, innerFetch ?? ((input, init) => globalThis.fetch(input, init)), redaction);
  const facta = new Facta({
    apiKey: env.FACTA_API_KEY!,
    signKey: env.FACTA_SIGN_KEY!,
    ...(env.FACTA_UNLOCK_KEY ? { unlockKey: env.FACTA_UNLOCK_KEY } : {}),
    baseUrl: base,
    fetch: recorder.fetch,
  });
  return { facta, recorder };
}

export async function execute(
  env: PlaygroundEnv,
  innerFetch: typeof globalThis.fetch | undefined,
  exec: (facta: Facta) => Promise<ExecOutcome>,
): Promise<{ output: RunOutput; outcome: ExecOutcome | null }> {
  const redaction: RedactOptions = { secrets: secretsOf(env) };
  const { facta, recorder } = buildRecordedFacta(env, innerFetch, redaction);
  const started = Date.now();
  let outcome: ExecOutcome | null = null;
  let error: RunOutput["error"];
  try {
    outcome = await exec(facta);
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
  const options: RedactOptions = { ...redaction, ...(outcome?.keep ? { keep: outcome.keep } : {}) };
  const output: RunOutput = {
    ok: error === undefined,
    steps: recorder.steps,
    totalMs: Date.now() - started,
    result: outcome === null ? null : redact(outcome.result, options),
    files: outcome === null ? [] : collectFiles(outcome.result),
    ...(error === undefined ? {} : { error }),
  };
  return { output, outcome };
}
