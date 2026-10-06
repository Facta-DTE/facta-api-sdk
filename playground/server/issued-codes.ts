// Per-visitor record of the documents issued through the playground.
//
// Why it exists: the playground key's `documents.list` returns EVERY playground
// document, so «Registro» and every per-document read must be scoped to what the
// visitor issued themselves. The record lives inside the visitor's own Durable
// Object (the one `QuotaCounter` already uses, keyed by the verified e-mail), so
// it holds nothing but generation codes, type, control number, time and state:
// no receiver data, no file contents, no other visitor's e-mail.
//
// Interface for the other batches (see playground/README.md):
//   recordIssued(env, email, entry)       called by the handler's `onIssued` hook
//   listIssued(env, email)                newest first, at most MAX_ISSUED entries
//   ownsDocument(env, email, code)        the server-side ownership check
//   updateIssuedState(env, email, code, estado)  keep the last known state

import type { DurableObjectNamespaceLike } from "./env.ts";

export const MAX_ISSUED = 200;
const STORAGE_KEY = "issued";

export interface IssuedEntry {
  /** Upper-case generation code, the document's identity. */
  codigoGeneracion: string;
  tipoDte: string;
  numeroControl: string;
  /** ISO time the playground recorded the document. */
  issuedAt: string;
  /** Last known state: `sellado`, `contingencia`, `invalidado`… */
  estado: string;
}

const CODE = /^[0-9A-Fa-f-]{36}$/;

export const normalizeCode = (code: string): string => code.trim().toUpperCase();
export const isGenerationCode = (code: unknown): code is string => typeof code === "string" && CODE.test(code);

// --- Pure logic -------------------------------------------------------------------

/** Insert or replace by code, newest first, capped. */
export function addIssued(list: IssuedEntry[], entry: IssuedEntry, cap = MAX_ISSUED): IssuedEntry[] {
  const code = normalizeCode(entry.codigoGeneracion);
  const rest = list.filter((e) => e.codigoGeneracion !== code);
  const previous = list.find((e) => e.codigoGeneracion === code);
  // A replay keeps the first record's time.
  const next: IssuedEntry = { ...entry, codigoGeneracion: code, issuedAt: previous?.issuedAt ?? entry.issuedAt };
  return [next, ...rest].slice(0, cap);
}

export function ownsCode(list: IssuedEntry[], code: string): boolean {
  if (!isGenerationCode(code)) return false;
  const wanted = normalizeCode(code);
  return list.some((e) => e.codigoGeneracion === wanted);
}

export function withState(list: IssuedEntry[], code: string, estado: string): IssuedEntry[] {
  const wanted = normalizeCode(code);
  return list.map((e) => (e.codigoGeneracion === wanted ? { ...e, estado } : e));
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value !== "" && value.length <= max ? value : null;

/** Validate a record request body. Returns null when it is not a valid entry. */
export function parseEntry(value: unknown, now: number): IssuedEntry | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const code = text(v.codigoGeneracion, 36);
  const tipoDte = text(v.tipoDte, 4);
  const numeroControl = text(v.numeroControl, 60);
  const estado = text(v.estado, 30);
  if (code === null || !isGenerationCode(code) || tipoDte === null || numeroControl === null || estado === null) return null;
  return { codigoGeneracion: normalizeCode(code), tipoDte, numeroControl, estado, issuedAt: new Date(now).toISOString() };
}

// --- Durable Object side ----------------------------------------------------------

/** The slice of Durable Object storage used here (same shape `QuotaCounter` has). */
export interface IssuedStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/**
 * Serves `/issued/*` inside the visitor's Durable Object:
 *   POST /issued/record  {entry}   -> {ok}
 *   POST /issued/state   {codigoGeneracion, estado}
 *   GET  /issued/list              -> {entries}
 *   GET  /issued/owns?code=…       -> {owns}
 */
export async function handleIssuedRequest(storage: IssuedStorage, request: Request, now: number): Promise<Response> {
  const url = new URL(request.url);
  const list = (await storage.get<IssuedEntry[]>(STORAGE_KEY)) ?? [];
  if (request.method === "GET" && url.pathname === "/issued/list") return Response.json({ entries: list });
  if (request.method === "GET" && url.pathname === "/issued/owns") {
    return Response.json({ owns: ownsCode(list, url.searchParams.get("code") ?? "") });
  }
  if (request.method === "POST" && (url.pathname === "/issued/record" || url.pathname === "/issued/state")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (url.pathname === "/issued/record") {
      const entry = parseEntry(body, now);
      if (entry === null) return Response.json({ error: "bad_entry" }, { status: 400 });
      await storage.put(STORAGE_KEY, addIssued(list, entry));
      return Response.json({ ok: true });
    }
    const code = body?.codigoGeneracion;
    const estado = text(body?.estado, 30);
    if (!isGenerationCode(code) || estado === null) return Response.json({ error: "bad_state" }, { status: 400 });
    await storage.put(STORAGE_KEY, withState(list, code, estado));
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

// --- Worker side ------------------------------------------------------------------

function stubFor(env: { QUOTA?: DurableObjectNamespaceLike }, email: string) {
  if (!env.QUOTA) throw new Error("issued-codes needs the QUOTA Durable Object binding.");
  return env.QUOTA.get(env.QUOTA.idFromName(email.toLowerCase()));
}

type WithQuota = { QUOTA?: DurableObjectNamespaceLike };

export async function recordIssued(
  env: WithQuota,
  email: string,
  entry: Pick<IssuedEntry, "codigoGeneracion" | "tipoDte" | "numeroControl" | "estado">,
): Promise<void> {
  const response = await stubFor(env, email).fetch(new Request("https://quota/issued/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }));
  if (!response.ok) throw new Error("issued-codes: record failed");
}

/** Newest first. */
export async function listIssued(env: WithQuota, email: string): Promise<IssuedEntry[]> {
  const response = await stubFor(env, email).fetch(new Request("https://quota/issued/list"));
  if (!response.ok) throw new Error("issued-codes: list failed");
  return ((await response.json()) as { entries: IssuedEntry[] }).entries;
}

/** True only when this visitor issued `code` through the playground. Fails closed. */
export async function ownsDocument(env: WithQuota, email: string, code: string): Promise<boolean> {
  if (!isGenerationCode(code)) return false;
  try {
    const response = await stubFor(env, email).fetch(new Request(`https://quota/issued/owns?code=${encodeURIComponent(code)}`));
    return response.ok && ((await response.json()) as { owns: boolean }).owns === true;
  } catch {
    return false;
  }
}

export async function updateIssuedState(env: WithQuota, email: string, code: string, estado: string): Promise<void> {
  await stubFor(env, email).fetch(new Request("https://quota/issued/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codigoGeneracion: code, estado }),
  }));
}
