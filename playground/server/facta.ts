// Builds the `Facta` client and the browser handler from the Worker's environment.

import { Facta } from "../../src/client.ts";
import { createFactaHandler, type FactaLike } from "../../src/server/handler.ts";
import type { FactaCapabilities } from "../../src/server/capabilities.ts";
import type { PlaygroundEnv } from "./env.ts";
import { sha256Hex } from "./hash.ts";
import { recordIssued } from "./issued-codes.ts";

export interface FactaParts {
  facta: FactaLike;
  handler: (req: Request) => Promise<Response>;
}

/**
 * The visitor of a request, or null. Injected so the handler and the router
 * share one verification per request.
 */
export type VisitorOf = (req: Request) => Promise<{ email: string } | null>;

/** Idempotency keys are `<visitorTag>.<uuid>`: a session can only be used by the visitor it was made for. */
export async function visitorTag(email: string): Promise<string> {
  return (await sha256Hex(email.toLowerCase())).slice(0, 16);
}

export function createFactaParts(env: PlaygroundEnv, visitorOf: VisitorOf, factaOverride?: FactaLike): FactaParts {
  const facta: FactaLike = factaOverride ?? new Facta({
    apiKey: env.FACTA_API_KEY!,
    signKey: env.FACTA_SIGN_KEY!,
    ...(env.FACTA_UNLOCK_KEY ? { unlockKey: env.FACTA_UNLOCK_KEY } : {}),
    baseUrl: env.FACTA_API_BASE_URL!,
  });

  const capabilities: FactaCapabilities = {
    documents: "read",
    downloads: ["pdf", "json"],
    status: true,
    storage: "read",
    ...(env.FACTA_UNLOCK_KEY ? { catalog: "read" as const } : {}),
  };

  // `onIssued` has no request, so `authorize` (which does) leaves the visitor here, keyed by
  // the session's idempotency key, for the hook to pick up in the same call.
  const issuing = new Map<string, string>();

  const handler = createFactaHandler({
    facta,
    sessionSecret: env.FACTA_SESSION_SECRET!,
    capabilities,
    // Receivers of playground documents are demo data; still, keep the SDK default.
    exposeRecipient: false,
    // Per-visitor record (issued-codes.ts): «Registro» and every per-document read use it.
    onIssued: async (result, { session }) => {
      const email = issuing.get(session.idempotencyKey);
      issuing.delete(session.idempotencyKey);
      if (email === undefined) return;
      await recordIssued(env, email, {
        codigoGeneracion: result.codigoGeneracion,
        tipoDte: result.tipoDte,
        numeroControl: result.numeroControl,
        estado: result.estado,
      });
    },
    authorize: async (req, ctx) => {
      // The service status is public so the page can show it before sign-in.
      if (ctx.action === "service.status") return true;
      const visitor = await visitorOf(req);
      if (visitor === null) return false;
      if (ctx.idempotencyKey !== undefined) {
        const mine = ctx.idempotencyKey.startsWith(`${await visitorTag(visitor.email)}.`);
        if (mine && ctx.action === "issue") {
          if (issuing.size > 500) issuing.clear();
          issuing.set(ctx.idempotencyKey, visitor.email);
        }
        return mine;
      }
      return true;
    },
  });
  return { facta, handler };
}
