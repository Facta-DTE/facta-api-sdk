// Builds the `Facta` client and the browser handler from the Worker's environment.

import { Facta } from "../../src/client.ts";
import { createFactaHandler, type FactaLike } from "../../src/server/handler.ts";
import type { FactaCapabilities } from "../../src/server/capabilities.ts";
import type { PlaygroundEnv } from "./env.ts";
import { visitorTag } from "./hash.ts";
import { recordIssued } from "./issued-codes.ts";
import { maskAddress, recipientKey } from "./delivery.ts";
import { stashToken } from "./gates.ts";
import { documentKey, withApiBudget } from "./api-budget.ts";
import { apiCacheOf, FINAL_TTL_MS } from "./api-cache.ts";

export interface FactaParts {
  facta: FactaLike;
  handler: (req: Request) => Promise<Response>;
}

/**
 * The visitor of a request, or null. Injected so the handler and the router
 * share one verification per request.
 */
export type VisitorOf = (req: Request) => Promise<{ id: string } | null>;

export { visitorTag };

export function createFactaParts(env: PlaygroundEnv, visitorOf: VisitorOf, factaOverride?: FactaLike): FactaParts {
  // Reads go through the API budget (api-budget.ts): the key's own rate limit is shared by all visitors.
  const cache = apiCacheOf(env.QUOTA);
  const facta: FactaLike = withApiBudget(factaOverride ?? new Facta({
    apiKey: env.FACTA_API_KEY!,
    signKey: env.FACTA_SIGN_KEY!,
    ...(env.FACTA_UNLOCK_KEY ? { unlockKey: env.FACTA_UNLOCK_KEY } : {}),
    baseUrl: env.FACTA_API_BASE_URL!,
  }), { cache });

  const capabilities: FactaCapabilities = {
    documents: "read",
    downloads: true, // pdf, json and ticket
    status: true,
    storage: "read",
    // Invalidation only with a session sealed by `POST /api/invalidation`, which checks ownership.
    invalidate: "session",
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
      const owner = issuing.get(session.idempotencyKey);
      issuing.delete(session.idempotencyKey);
      if (owner === undefined) return;
      // Keep the five-minute delivery token on the server, so «Reenviar» can use it while it lives.
      const address = session.deliver?.email;
      const offer = result.entrega;
      if (typeof address === "string" && offer?.token !== undefined) {
        const exp = offer.venceEn === undefined ? Date.now() + 5 * 60_000 : Date.parse(offer.venceEn);
        await stashToken(env, owner, {
          code: result.codigoGeneracion.toUpperCase(),
          token: offer.token,
          exp: Number.isFinite(exp) ? exp : Date.now() + 5 * 60_000,
          masked: maskAddress(address),
          rcpt: await recipientKey(env.FACTA_SESSION_SECRET ?? "", address),
        }).catch(() => undefined);
      }
      // The total is stored now, so no list ever has to ask the API for it. A contingency has no
      // sealed totals yet: the figure the visitor reviewed is the one shown.
      const sealedTotal = result.estado === "sellado" ? (result.totales?.totalPagar ?? result.totales?.montoTotalOperacion) : undefined;
      const total = typeof sealedTotal === "number" ? sealedTotal : session.display?.total;
      // A sealed document is already a complete answer to «what does the API say about it?»: keep it, so
      // Registro and Inicio never spend an API request to read what was just issued.
      if (result.estado === "sellado") {
        await cache.put(documentKey(result.codigoGeneracion), {
          estado: "sellado",
          codigoGeneracion: result.codigoGeneracion.toUpperCase(),
          numeroControl: result.numeroControl,
          tipoDte: result.tipoDte,
          ambiente: result.ambiente,
          fecEmi: result.fecEmi,
          horEmi: result.horEmi ?? null,
          selloRecibido: result.selloRecibido,
          observaciones: result.observaciones ?? [],
          totales: result.totales,
        }, FINAL_TTL_MS).catch(() => undefined);
      }
      await recordIssued(env, owner, {
        codigoGeneracion: result.codigoGeneracion,
        tipoDte: result.tipoDte,
        numeroControl: result.numeroControl,
        estado: result.estado,
        ...(typeof total === "number" && Number.isFinite(total) ? { total } : {}),
      });
    },
    authorize: async (req, ctx) => {
      // The service status is public so the page can show it before sign-in.
      if (ctx.action === "service.status") return true;
      const visitor = await visitorOf(req);
      if (visitor === null) return false;
      if (ctx.idempotencyKey !== undefined) {
        const mine = ctx.idempotencyKey.startsWith(`${await visitorTag(visitor.id)}.`);
        if (mine && ctx.action === "issue") {
          if (issuing.size > 500) issuing.clear();
          issuing.set(ctx.idempotencyKey, visitor.id);
        }
        return mine;
      }
      return true;
    },
  });
  return { facta, handler };
}
