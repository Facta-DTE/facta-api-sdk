// Cloudflare Worker entry. Static assets (the Vite site) are served by the
// platform; only /api/* reaches this code (`assets.run_worker_first`).

import { handleApi } from "./server/router.ts";
import type { PlaygroundEnv } from "./server/env.ts";

export { QuotaCounter } from "./server/quota.ts";

export default {
  async fetch(request: Request, env: PlaygroundEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
