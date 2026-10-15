// Access tokens for Google Drive destinations that carry a long key.
//
// The OAuth client secret needed to redeem a refresh token lives only on the
// Facta server, so the SDK sends the long key (opened locally from the
// destinations vault) to `POST /v1/destinations/{id}/drive-token` and gets back
// a one-hour access token. This broker keeps those tokens in memory only, one
// entry per destination, and makes sure a burst of concurrent artifact writes
// triggers a single route call. Nothing here is ever persisted or logged.

/** What the route answers, with `expiresAt` already converted to epoch ms. */
export interface DriveTokenGrant {
  accessToken: string;
  expiresAt: number;
  /** Present only when Google rotated the long key; used for later renewals in this process. */
  refreshToken?: string;
}

export type DriveTokenFetcher = (destinationId: string, refreshToken: string) => Promise<DriveTokenGrant>;

/** A token is renewed this long before it dies. */
export const DRIVE_TOKEN_MARGIN_MS = 60_000;
/** A forced renewal (a 401) right after a fresh token cannot be fixed by yet another one. */
const FORCE_COOLDOWN_MS = 10_000;
/** Failures that retrying cannot fix until the person acts in the Facta app (or the server is configured). */
const PERMANENT = new Set(["drive_reauthorization_required", "drive_not_configured"]);

/** The renewal failed; `code` is a `FactaErrorCode` or `drive_token_failed`. Never carries a token. */
export class DriveTokenError extends Error {
  constructor(readonly code: string) {
    super(`Google Drive access token unavailable (${code}).`);
    this.name = "DriveTokenError";
  }
}

interface Entry {
  seedKey: string;
  refreshToken: string;
  token?: string;
  expiresAt?: number;
  obtainedAt?: number;
  inflight?: Promise<string>;
  failure?: string;
}

export class DriveTokenBroker {
  readonly #fetchGrant: DriveTokenFetcher;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(fetchGrant: DriveTokenFetcher, now: () => number = Date.now) {
    this.#fetchGrant = fetchGrant;
    this.#now = now;
  }

  /**
   * Register a destination from its decrypted vault secret. Idempotent: a
   * second call with the same long key keeps the cached token and any rotated
   * key; a different long key (the person reconfirmed in the app) starts over.
   */
  seed(destinationId: string, secret: { refreshToken: string; accessToken?: unknown; expiresAt?: unknown }): void {
    const existing = this.#entries.get(destinationId);
    if (existing && existing.seedKey === secret.refreshToken) return;
    const entry: Entry = { seedKey: secret.refreshToken, refreshToken: secret.refreshToken };
    if (typeof secret.accessToken === "string" && secret.accessToken !== "" && typeof secret.expiresAt === "number") {
      entry.token = secret.accessToken;
      entry.expiresAt = secret.expiresAt;
    }
    this.#entries.set(destinationId, entry);
  }

  /** The code of the last failed renewal for this destination, or `undefined` while it is healthy. */
  failure(destinationId: string): string | undefined {
    return this.#entries.get(destinationId)?.failure;
  }

  /** Make sure a valid token exists now. Never throws; read the outcome with `failure()`. */
  async prepare(destinationId: string): Promise<void> {
    try {
      await this.token(destinationId);
    } catch {
      // Recorded in the entry.
    }
  }

  /** A valid access token. Throws `DriveTokenError` when none can be had. */
  token(destinationId: string, options: { force?: boolean } = {}): Promise<string> {
    const entry = this.#entries.get(destinationId);
    if (!entry) return Promise.reject(new DriveTokenError("drive_token_failed"));
    const now = this.#now();
    const fresh = entry.token !== undefined && entry.expiresAt !== undefined && now < entry.expiresAt - DRIVE_TOKEN_MARGIN_MS;
    if (fresh && !options.force) return Promise.resolve(entry.token as string);
    if (fresh && options.force && entry.obtainedAt !== undefined && now - entry.obtainedAt < FORCE_COOLDOWN_MS) {
      return Promise.resolve(entry.token as string);
    }
    if (entry.inflight) return entry.inflight;
    if (entry.failure !== undefined && PERMANENT.has(entry.failure)) {
      return Promise.reject(new DriveTokenError(entry.failure));
    }
    const run = (async () => {
      try {
        const grant = await this.#fetchGrant(destinationId, entry.refreshToken);
        entry.token = grant.accessToken;
        entry.expiresAt = grant.expiresAt;
        entry.obtainedAt = this.#now();
        if (grant.refreshToken) entry.refreshToken = grant.refreshToken;
        delete entry.failure;
        return grant.accessToken;
      } catch (cause) {
        const code = typeof (cause as { code?: unknown })?.code === "string" &&
            (cause as { code: string }).code.startsWith("drive_")
          ? (cause as { code: string }).code
          : cause instanceof Error && (cause as { status?: unknown }).status === 429
          ? "rate_limited"
          : (cause as { code?: unknown })?.code === "not_found"
          ? "not_found"
          : "drive_token_failed";
        delete entry.token;
        delete entry.expiresAt;
        entry.failure = code;
        throw new DriveTokenError(code);
      } finally {
        delete entry.inflight;
      }
    })();
    entry.inflight = run;
    return run;
  }
}
