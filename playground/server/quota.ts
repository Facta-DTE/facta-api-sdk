import { handleIssuedRequest } from "./issued-codes.ts";
import { handleCacheRequest } from "./api-cache.ts";
import { consumeMail, emptyMail, peekMail, type MailRequest, type MailState, type StashedToken } from "./mail-quota.ts";

// Per-visitor issue quota (D-5): 20 per hour and 100 per day, sliding windows.
// The decision logic is pure; `QuotaCounter` (a Durable Object) only persists it.


export const HOUR_LIMIT = 20;
export const DAY_LIMIT = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface QuotaState {
  /** Epoch ms of every counted issue in the last 24 h. */
  stamps: number[];
  /** Idempotency keys already counted, with their time: a replay is free. */
  keys: Record<string, number>;
}

export interface QuotaLimits {
  hour: number;
  day: number;
}

export interface QuotaDecision {
  allowed: boolean;
  /** Which window refused, when `allowed` is false. */
  window?: "hour" | "day";
  remainingHour: number;
  remainingDay: number;
  /** Seconds until the refusing window frees a slot. */
  retryAfterSeconds?: number;
}

export const emptyQuota = (): QuotaState => ({ stamps: [], keys: {} });

/** Count one issue under `key`. Returns the new state and the verdict. */
export function consumeQuota(
  state: QuotaState,
  key: string,
  now: number,
  limits: QuotaLimits = { hour: HOUR_LIMIT, day: DAY_LIMIT },
  /** False: answer what a count WOULD do and change nothing (the check before the call). */
  commit = true,
): { state: QuotaState; decision: QuotaDecision } {
  const stamps = state.stamps.filter((t) => now - t < DAY_MS);
  const keys: Record<string, number> = {};
  for (const [k, t] of Object.entries(state.keys)) if (now - t < DAY_MS) keys[k] = t;
  const hourStamps = stamps.filter((t) => now - t < HOUR_MS);

  const view = (extra = 0) => ({
    remainingHour: Math.max(0, limits.hour - hourStamps.length - extra),
    remainingDay: Math.max(0, limits.day - stamps.length - extra),
  });

  if (key in keys) return { state: { stamps, keys }, decision: { allowed: true, ...view() } };

  if (hourStamps.length >= limits.hour) {
    const oldest = Math.min(...hourStamps);
    return {
      state: { stamps, keys },
      decision: { allowed: false, window: "hour", ...view(), retryAfterSeconds: Math.ceil((oldest + HOUR_MS - now) / 1000) },
    };
  }
  if (stamps.length >= limits.day) {
    const oldest = Math.min(...stamps);
    return {
      state: { stamps, keys },
      decision: { allowed: false, window: "day", ...view(), retryAfterSeconds: Math.ceil((oldest + DAY_MS - now) / 1000) },
    };
  }
  if (!commit) return { state: { stamps, keys }, decision: { allowed: true, ...view() } };
  stamps.push(now);
  keys[key] = now;
  return { state: { stamps, keys }, decision: { allowed: true, ...view(1) } };
}

/** Read-only view for the page: remaining slots without counting anything. */
export function peekQuota(state: QuotaState, now: number, limits: QuotaLimits = { hour: HOUR_LIMIT, day: DAY_LIMIT }): QuotaDecision {
  const stamps = state.stamps.filter((t) => now - t < DAY_MS);
  const hours = stamps.filter((t) => now - t < HOUR_MS).length;
  return {
    allowed: hours < limits.hour && stamps.length < limits.day,
    remainingHour: Math.max(0, limits.hour - hours),
    remainingDay: Math.max(0, limits.day - stamps.length),
  };
}

/** Spanish copy for a refusal. */
export function quotaMessage(decision: QuotaDecision): string {
  const wait = decision.retryAfterSeconds ?? 0;
  const when = wait >= 3600 ? `en ${Math.ceil(wait / 3600)} h` : `en ${Math.max(1, Math.ceil(wait / 60))} min`;
  return decision.window === "day"
    ? `Límite alcanzado: 100 facturas de prueba por día. Podrá emitir de nuevo ${when}.`
    : `Límite alcanzado: 20 facturas de prueba por hora. Podrá emitir de nuevo ${when}.`;
}

// --- Durable Object ------------------------------------------------------------

/** The slice of Durable Object storage the counter uses. */
export interface QuotaStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/**
 * One instance per visitor (`idFromName(email)`).
 * `POST /consume {key}` counts; `GET /peek` only reads.
 */
export class QuotaCounter {
  readonly #storage: QuotaStorage;
  readonly #now: () => number;
  constructor(state: { storage: QuotaStorage; blockConcurrencyWhile?: <T>(fn: () => Promise<T>) => Promise<T> }, _env?: unknown, now: () => number = Date.now) {
    this.#storage = state.storage;
    this.#now = now;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The visitor's issued-document record lives in this same object (issued-codes.ts).
    if (url.pathname.startsWith("/issued/")) return handleIssuedRequest(this.#storage, request, this.#now());
    if (url.pathname.startsWith("/mail/")) return this.#mail(request, url);
    // Shared API-answer cache (api-cache.ts), held by the same Durable Object class.
    if (url.pathname.startsWith("/cache/")) return handleCacheRequest(this.#storage, request, this.#now());
    const stored = (await this.#storage.get<QuotaState>("quota")) ?? emptyQuota();
    if (request.method === "GET" && url.pathname === "/peek") {
      return Response.json(peekQuota(stored, this.#now()));
    }
    if (request.method === "POST" && url.pathname === "/consume") {
      const body = (await request.json().catch(() => null)) as { key?: unknown; commit?: unknown } | null;
      if (!body || typeof body.key !== "string" || body.key === "" || body.key.length > 200) {
        return Response.json({ error: "bad_key" }, { status: 400 });
      }
      const commit = body.commit !== false;
      const { state, decision } = consumeQuota(stored, body.key, this.#now(), undefined, commit);
      if (commit) await this.#storage.put("quota", state);
      return Response.json(decision);
    }
    return new Response("Not found", { status: 404 });
  }

  /** E-mail limits and the short-lived delivery token stash (mail-quota.ts). */
  async #mail(request: Request, url: URL): Promise<Response> {
    const now = this.#now();
    const state = (await this.#storage.get<MailState>("mail")) ?? emptyMail();
    if (request.method === "GET" && url.pathname === "/mail/peek") return Response.json(peekMail(state, now));
    if (request.method === "POST" && url.pathname === "/mail/consume") {
      const body = (await request.json().catch(() => null)) as (Partial<MailRequest> & { commit?: unknown }) | null;
      const scopes = ["visitor", "ip", "recipient"];
      if (!body || typeof body.key !== "string" || body.key === "" || body.key.length > 200 || typeof body.scope !== "string" || !scopes.includes(body.scope) ||
        (body.doc !== undefined && (typeof body.doc !== "string" || body.doc.length > 40))) {
        return Response.json({ error: "bad_key" }, { status: 400 });
      }
      const commit = body.commit !== false;
      const { state: next, decision } = consumeMail(state, { key: body.key, scope: body.scope as MailRequest["scope"], ...(body.doc === undefined ? {} : { doc: body.doc }) }, now, commit);
      if (commit) await this.#storage.put("mail", next);
      return Response.json(decision);
    }
    const stash = ((await this.#storage.get<StashedToken[]>("mailtok")) ?? []).filter((t) => t.exp > now);
    if (request.method === "POST" && url.pathname === "/mail/token") {
      const body = (await request.json().catch(() => null)) as StashedToken | null;
      if (!body || typeof body.code !== "string" || typeof body.token !== "string" || typeof body.exp !== "number" || typeof body.masked !== "string" || typeof body.rcpt !== "string") {
        return Response.json({ error: "bad_token" }, { status: 400 });
      }
      await this.#storage.put("mailtok", [body, ...stash.filter((t) => t.code !== body.code)].slice(0, 20));
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/mail/token") {
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      return Response.json({ token: stash.find((t) => t.code === code) ?? null });
    }
    return new Response("Not found", { status: 404 });
  }
}
