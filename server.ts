/**
 * `@facta-dte/api/server` — the server half of the React signing window.
 *
 * Mount `createFactaHandler` on a POST route of YOUR server, where the
 * `Facta` instance (and its apiKey/signKey) lives. Create one session token per
 * sale with `createFactaSession` and hand only that token to the browser.
 * See docs/react-signing-ui.md §3 and §5.
 */
export {
  createFactaSession,
  type CreateFactaSessionInput,
  DEFAULT_SESSION_TTL_SECONDS,
  type FactaRecipientPolicy,
  type FactaSession,
  type FactaSessionAllow,
  type FactaSessionDisplay,
  FactaSessionError,
  type FactaSessionMode,
  verifyFactaSession,
} from "./src/server/session.ts";
export {
  mergeRecipient,
  type NormalizedRecipient,
  type RecipientFieldError,
  type RecipientFieldErrorCode,
  resolveTipoDte,
  validateRecipient,
} from "./src/server/recipient.ts";
export {
  createFactaHandler,
  type FactaHandlerErrorBody,
  type FactaHandlerOptions,
  type FactaLike,
  type NodeRequestLike,
  type NodeResponseLike,
  toNodeHandler,
} from "./src/server/handler.ts";
