// Per-visitor ledger of the documents issued from the playground.
//
// It answers one question: «did THIS visitor issue that document here?». The
// invalidation endpoint and the related-document picker of the sale builder
// use it, and the Registro section can read the same list.
//
// Storage: one Durable Object instance per visitor, named `issued:<visitorTag>`
// (the tag is the hash prefix already carried by every idempotency key, so the
// ledger can be written from `onIssued`, which only knows the session, never
// the e-mail). The instance is the existing `QuotaCounter` class; it hands
// `/issued/*` requests to `handleIssuedRequest` below, so no new binding or
// migration is needed.
//
// Extension point: `recordIssued` / `listIssued` / `ownsDocument` are the whole
// surface; add fields to `IssuedEntry` (keep them small and non-personal).

import type { DurableObjectNamespaceLike } from "./env.ts";
import { visitorTag } from "./hash.ts";

export interface IssuedEntry {
  /** Generation code, upper-case. */
  codigoGeneracion: string;
  tipoDte: string;
  numeroControl?: string;
  /** Epoch ms when the playground recorded it. */
  at: number;
}

/** Entries older than this are forgotten (the staging data is test data anyway). */
export const ISSUED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ISSUED_MAX = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isGenerationCode = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Pure: add (or refresh) an entry, drop the old and the excess. Newest first. */
export function addIssued(entries: IssuedEntry[], entry: IssuedEntry, now: number): IssuedEntry[] {
  const code = entry.codigoGeneracion.toUpperCase();
  const kept = entries.filter((e) => e.codigoGeneracion !== code && now - e.at < ISSUED_RETENTION_MS);
  return [{ ...entry, codigoGeneracion: code }, ...kept].slice(0, ISSUED_MAX);
}

export function liveIssued(entries: IssuedEntry[], now: number): IssuedEntry[] {
  return entries.filter((e) => now - e.at < ISSUED_RETENTION_MS);
}

export const ownsCode = (entries: IssuedEntry[], code: string): boolean =>
  entries.some((e) => e.codigoGeneracion === code.toUpperCase());

// --- Durable Object side ----------------------------------------------------------

export interface IssuedStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** Handles `POST /issued/record` and `GET /issued/list`. Returns null for any other path. */
export async function handleIssuedRequest(storage: IssuedStorage, request: Request, now: number): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/issued/")) return null;
  const stored = (await storage.get<IssuedEntry[]>("issued")) ?? [];
  if (request.method === "GET" && url.pathname === "/issued/list") {
    return Response.json(liveIssued(stored, now));
  }
  if (request.method === "POST" && url.pathname === "/issued/record") {
    const body = (await request.json().catch(() => null)) as Partial<IssuedEntry> | null;
    if (!body || !isGenerationCode(body.codigoGeneracion) || typeof body.tipoDte !== "string" || body.tipoDte.length > 3) {
      return Response.json({ error: "bad_entry" }, { status: 400 });
    }
    const entry: IssuedEntry = {
      codigoGeneracion: body.codigoGeneracion,
      tipoDte: body.tipoDte,
      ...(typeof body.numeroControl === "string" && body.numeroControl.length <= 60 ? { numeroControl: body.numeroControl } : {}),
      at: now,
    };
    await storage.put("issued", addIssued(stored, entry, now));
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

// --- Worker side ------------------------------------------------------------------

const stubFor = (namespace: DurableObjectNamespaceLike, tag: string) => namespace.get(namespace.idFromName(`issued:${tag}`));

/** Record a document under the visitor tag taken from its idempotency key. Never throws. */
export async function recordIssued(namespace: DurableObjectNamespaceLike | undefined, tag: string, entry: Omit<IssuedEntry, "at">): Promise<void> {
  if (!namespace) return;
  try {
    await stubFor(namespace, tag).fetch(new Request("https://quota/issued/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    }));
  } catch {
    // A ledger failure must never hide a fiscal document from the visitor.
  }
}

/** The tag of an idempotency key shaped `<tag>.<rest>`, or null. */
export function tagOfKey(idempotencyKey: string): string | null {
  const dot = idempotencyKey.indexOf(".");
  return dot > 0 && /^[0-9a-f]{16}$/.test(idempotencyKey.slice(0, dot)) ? idempotencyKey.slice(0, dot) : null;
}

/** What this visitor issued here, newest first. Empty when the ledger is unavailable. */
export async function listIssued(namespace: DurableObjectNamespaceLike | undefined, email: string): Promise<IssuedEntry[]> {
  if (!namespace) return [];
  const response = await stubFor(namespace, await visitorTag(email)).fetch(new Request("https://quota/issued/list"));
  return response.ok ? ((await response.json()) as IssuedEntry[]) : [];
}

export async function ownsDocument(namespace: DurableObjectNamespaceLike | undefined, email: string, code: string): Promise<boolean> {
  return ownsCode(await listIssued(namespace, email), code);
}
