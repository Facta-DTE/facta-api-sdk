/**
 * `@facta-dte/api/server` — the server half of the React signing window.
 *
 * Mount `createFactaHandler` on a POST route of YOUR server, where the
 * `Facta` instance (and its apiKey/signKey) lives. Create one session token per
 * sale with `createFactaSession` and hand only that token to the browser. The
 * request inside the token is final: the window never edits it.
 * See docs/react-signing-ui.md §3 and §5.
 */
export {
  createFactaSession,
  type CreateFactaSessionInput,
  DEFAULT_SESSION_TTL_SECONDS,
  type FactaSession,
  type FactaSessionDisplay,
  FactaSessionError,
  verifyFactaSession,
} from "./src/server/session.ts";
export {
  createFactaHandler,
  extractFieldIssues,
  type FactaFieldIssue,
  type FactaHandlerErrorBody,
  type FactaHandlerEvent,
  type FactaHandlerOptions,
  type FactaLike,
  type NodeRequestLike,
  type NodeResponseLike,
  normalizeFieldPath,
  toNodeHandler,
} from "./src/server/handler.ts";
