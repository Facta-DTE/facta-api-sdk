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
  createFactaInvalidationSession,
  type CreateFactaInvalidationSessionInput,
  createFactaSession,
  type FactaInvalidationSession,
  verifyFactaInvalidationSession,
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
  type FactaArchiveMode,
  type FactaAuthorizeContext,
  type FactaListScope,
  type FactaFieldIssue,
  type FactaHandlerErrorBody,
  type FactaHandlerEvent,
  type FactaHandlerOptions,
  type FactaIssuedContext,
  type FactaLike,
  type FactaStorageSummary,
  type NodeRequestLike,
  type NodeResponseLike,
  normalizeFieldPath,
  ON_ISSUED_FAILED,
  statusTokenFor,
  summarizeStorage,
  toNodeHandler,
} from "./src/server/handler.ts";
export {
  CATALOG_WRITE_ACTIONS,
  type FactaCapabilities,
  type FactaDownloadKind,
  type FactaServiceState,
  maskDocumentNumber,
} from "./src/server/capabilities.ts";
