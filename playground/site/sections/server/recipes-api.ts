import { ApiError } from "../../api.ts";
import { turnstileHeaders } from "../../turnstile.ts";

export interface RunStep {
  method: string;
  endpoint: string;
  status: number | null;
  ms: number;
  request?: unknown;
}

export interface RunFile {
  name: string;
  contentType: string;
  size: number;
  base64?: string;
}

export interface RunResponse {
  recipe: string;
  stage: string;
  runId: string;
  ok: boolean;
  steps: RunStep[];
  totalMs: number;
  result: unknown;
  files: RunFile[];
  error?: { code: string; status: number; message: string; spent?: { codigoGeneracion: string; numeroControl: string }; observations?: string[] };
  issued: Array<{ codigoGeneracion: string; tipoDte?: string }>;
  invalidated: string[];
  continuation?: string;
}

export async function runRecipe(body: { recipe: string; stage?: string; runId?: string; params: Record<string, unknown> }): Promise<RunResponse> {
  const response = await fetch("/api/recipes/run", {
    method: "POST",
    headers: { "content-type": "application/json", "x-facta-ui": "1", ...turnstileHeaders() },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (RunResponse & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error?.code ?? "request_failed", payload?.error?.message ?? "No se pudo ejecutar la receta.", response.status);
  }
  return payload as RunResponse;
}

export interface MyDocument {
  codigoGeneracion: string;
  tipoDte?: string;
  estado?: string;
}

/** The visitor's own documents from the Registro endpoint; empty when it is not available. */
export async function loadMine(): Promise<MyDocument[]> {
  try {
    const response = await fetch("/api/registro", { headers: { accept: "application/json" } });
    if (!response.ok) return [];
    const body = (await response.json()) as { documents?: MyDocument[] };
    return Array.isArray(body.documents) ? body.documents : [];
  } catch {
    return [];
  }
}
