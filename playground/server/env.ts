/** Bindings and variables of the playground Worker. Secrets are set with `wrangler secret put`. */
export interface PlaygroundEnv {
  // Secrets
  FACTA_API_KEY?: string;
  FACTA_SIGN_KEY?: string;
  FACTA_UNLOCK_KEY?: string;
  FACTA_SESSION_SECRET?: string;
  FACTA_DTE_FIXTURES_JSON?: string;
  // Variables
  FACTA_API_BASE_URL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** `1` skips Cloudflare Access on localhost only. The guard refuses it anywhere else. */
  PLAYGROUND_DEV_BYPASS?: string;
  /** E-mail used as the visitor while the bypass is on. */
  PLAYGROUND_DEV_EMAIL?: string;
  // Bindings
  ASSETS?: { fetch(request: Request): Promise<Response> };
  QUOTA?: DurableObjectNamespaceLike;
}

/** The slice of a Durable Object namespace the playground uses; tests pass a fake. */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
