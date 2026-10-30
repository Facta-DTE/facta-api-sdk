# Error catalogue

[Spanish guide](errors.es.md) · [English README](../README.md) · [Method reference](reference.md)

Every failure from the Facta API, and every failure the SDK detects itself
around an API call, is thrown as a `FactaError`. This guide lists **every**
`FactaErrorCode` the SDK declares, with its HTTP status, whether the SDK retries
it automatically, and what to do. Statuses come from the published API contract
(`x-facta-errores`) and from `src/errors.ts` / `src/client.ts`.

## `FactaError`

```ts
import { FactaError } from "@facta-dte/api";

try {
  await facta.issue(request, { idempotencyKey: "sale:1042" });
} catch (error) {
  if (!(error instanceof FactaError)) throw error;  // TypeError, RangeError, AbortError, ...
  switch (error.code) {
    case "mh_rejected":
      console.error("Hacienda refused:", error.mhObservations, "spent:", error.spent);
      break;
    case "rate_limited":
      console.warn("Retry after", (error.details as { retryAfterSeconds?: number })?.retryAfterSeconds, "s");
      break;
    default:
      console.error(error.code, error.status, error.message);
  }
}
```

| Member | Meaning |
| --- | --- |
| `name` | `"FactaError"`. |
| `code` | A `FactaErrorCode`. **The only thing to branch on.** |
| `status` | The HTTP status, or `0` when the error was produced locally without an HTTP answer. |
| `details` | Code-specific data (`unknown`): `validation_failed` → `issues`; `mh_rejected` → `descripcionMsg`, `observaciones`, `codigoGeneracion`, `numeroControl`; `rate_limited` → `window`, `remaining`, `retryAfterSeconds`; `forbidden_scope` → `required`, `granted`; `dte_type_not_allowed` → `allowed`; `sign_key_invalid` → `intentosRestantes`; `return_exceeds_available` → `lineas`. |
| `message` | Prose for a human reading a log (Spanish from the server, English or Spanish from the SDK). It may be rewritten at any time; never parse it. |
| `isRejection` | `true` only for `mh_rejected`: Hacienda read the document and refused it. |
| `spent` | `{ codigoGeneracion, numeroControl }` when the failure burned a control number (a rejection), else `null`. |
| `mhObservations` | Hacienda's observations, verbatim (`string[]`). |

The SDK redacts the configured API key, signing key, unlock key and delivery
tokens from `message` and `details`, and drops credential-named fields from
`details`.

## Retries

The SDK retries automatically, with the same `Idempotency-Key`, only these
codes: `idempotency_in_flight`, `network_error`, `service_unavailable`,
`correlative_unavailable`, `mh_unreachable`, `storage_unavailable`,
`data_grant_unavailable` and `data_epoch_stale`. It makes
up to `maxRetries` extra attempts (default 3), waiting 250 ms, 500 ms, 1 s…
(capped at 4 s). When they are exhausted you receive the last error; the outcome
of a POST is then **uncertain**: replay the same request with the same key (see
[idempotency.md](idempotency.md)). Every other code is final for that request.

In the tables, "Retried" means retried automatically by the SDK.

## Credentials and access

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `unauthorized` | 401 (0 locally) | no | No `X-Facta-Key` reached the API. Locally: `apiKey` missing, an unlock key (`factauk_`) passed as `signKey`, a malformed `unlockKey`, or `syncDestinations` without `unlockKey`. | Configure the credential named in the message. |
| `invalid_api_key` | 401 | no | The key does not exist, is mistyped, or its secret does not match. | Copy the whole key, including the dot. |
| `key_revoked` | 403 | no | Revoked from the app. | Mint a new key. |
| `key_expired` | 403 | no | Past its expiry date. | Mint a new key. |
| `key_inactive` | 403 | no | Deactivated. | Reactivate it in the app. |
| `forbidden_scope` | 403 | no | The key lacks the route's scope (`details.required`, `details.granted`). | Mint a key with that scope; scopes cannot be edited. |
| `dte_type_not_allowed` | 403 | no | The key may not issue that `tipoDte` (`details.allowed`). | Mint a key that includes the type. |
| `ip_not_allowed` | 403 | no | The key has an IP allow-list and the caller is not in it. | Add the address or CIDR range when minting. |
| `environment_not_allowed` | 403 | no | Key prefix and key row disagree, or a production key (`facta_live_`) reaches a company that is not in production yet: emission and the company-level routes (customers, products, webhooks, the catalogue feed, drafts, destinations, templates) refuse it, while a test key is always allowed and document reads are filtered to the key's environment. | Use a production key only for a company already in production; keep using the test key until the owner completes the step to production. |
| `sign_key_required` | 401 | no | A signing route without `X-Facta-Sign-Key`, or with the unlock key. | Pass `signKey` (`factask_…`). |
| `sign_key_invalid` | 401 | no | The signing key does not open the vault (`details.intentosRestantes`). | Fix the key before the vault locks. |
| `sign_vault_locked` | 403 | no | Five failed attempts in an hour; the key is suspended. | Reactivate it in the app; waiting does not help. |
| `sign_vault_missing` | 409 | no | The key is not provisioned to sign, or its certificate belongs to another NIT. | Re-mint the key from the app. |

## Request and validation

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `invalid_request` | 400 (422 locally) | no | Missing or non-JSON body, over 1 MB, a field with the wrong shape, or a non-UUID generation code (`details.field`). Locally (422): a catalog product with an invalid item type, unit of measure, or a VAT basis that does not match the DTE. | Fix the request. No number was spent. |
| `include_limit_exceeded` | 400 | no | `listDocuments` with `include: ["dte"]` asked for more than 25 rows (`details.maximo`). | Ask for 25 or fewer and follow `siguiente`. |
| `validation_failed` | 422 | no | The document fails Hacienda's official schema (`details.issues`). Also thrown locally (422, before any request) by catalog writes. | Fix the listed fields. No number was spent. |
| `retention_mixed_class_unsupported` | 422 | no | `aplicarReteRenta` was requested on a document with an `exenta` or `no_sujeta` line (`items[].tipoVenta`). | Nothing was signed and no number was spent. Issue the exempt or non-subject lines in another document, or do not apply the withholding. |
| `not_found` | 404 | no | No such document, customer, product or route for this key's company. Also returned when a `customerId`/`productId` does not exist for this key (`details.reason: "catalog_unknown_id"`). | Check the identifier and the key's company; sync the catalog. |
| `method_not_allowed` | 405 | no | The route exists, but not with that method. | Only seen when calling the API outside the SDK's methods. |
| `prepare_token_invalid` | 422 | no | The `prepareToken` expired (15 min), belongs to another key, or the document changed. | Call `prepare` again. See [prepare-sign.md](prepare-sign.md). |
| `not_sealed` | 409 | no | Default JSON download of a document with no seal yet (contingency). | Use `{ raw: true }` or wait for the seal. See [archivo-dte.md](archivo-dte.md). |
| `catalog_write_disabled` | 403 | no | The company did not enable «Permitir administrar clientes y productos desde el API». | Enable it in the app. See [catalog-write.md](catalog-write.md). |
| `catalog_encrypted` | 409 | no | The company catalog is still encrypted at rest and this key has no access to it: the company does not share its data key with the API (or this key was never granted it), so the API can neither read nor write it. The scope of the key is judged first: a read-only key hears `forbidden_scope` before this. `details.hint` says which of the two applies. | Ask the owner to give the key access to the shared data (Account → API), or to switch the catalog to plain text. |
| `catalog_duplicate` | 409 | no | A customer with that document, or a product with that code, already exists. | `details.id` names it; edit it, or reactivate it if it is deactivated. |
| `catalog_revision_conflict` | 409 | no | The record changed since the `If-Match` revision you sent. | `details.revisionActual` is the current revision; read it again and re-apply the change. |
| `catalog_record_inactive` | 409 | no | An edit of a deactivated record that did not send `activo: true`. | Reactivate it explicitly, or leave it. |
| `catalog_search_too_broad` | 422 | no | A text search over more rows than the server searches in memory. | Search by document (`documento`) instead. |
| `catalog_cursor_expired` | 410 | no | `listCatalogChanges` cannot continue from your `since`. `details.reason` is `generation_changed`, `history_pruned`, `cursor_ahead` or `too_many`; `details.cabeza` and `details.generacion` are the current head and generation. | Read the catalogue again in full, then continue from `details.cabeza` with `details.generacion`. |
| `data_grant_unavailable` | 503 | yes | The server could not open the key's access to the encrypted catalogue right now. | Retry shortly; it never counts against your key. |
| `data_grant_revoked` | 403 | no | The owner removed this key's access to the catalogue data. | Ask the owner to restore it, or mint a new key. |
| `data_epoch_stale` | 503 | yes | The company's data key is rotating. | Retry after a few seconds. |
| `webhook_limit_reached` | 409 | no | The key already has 5 webhooks. | Delete one with `deleteWebhook`, or reuse it with `updateWebhook`. |
| `webhook_duplicate` | 409 | no | This key already has a webhook with that URL. | Use `listWebhooks` and `updateWebhook` on the existing one. |
| `inbox_retired` | 410 | no | The sealed catalogue inbox (`POST /v1/catalog/changes` and `/v1/catalog/changes/{id}`, `by-key/{key}`) was retired; `GET /v1/catalog/changes?since=` is the change feed and still works. | Write the catalogue with `createCustomer`, `updateCustomer` and the product equivalents. |

## Drafts

Scope `draft` (issuing also needs `issue` and the signing key). See [drafts.md](drafts.md).

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `drafts_not_ready` | 409 | no | The company has no draft-box key for its current data key yet: its owner has not opened Facta with their vault since the company began sharing it. | Ask the owner to open Facta once, then repeat the same call. |
| `version_mismatch` | 409 | no | The `version` (or `If-Match`) is not the draft's current one. | Read the draft again with `getDraft` and re-apply. |
| `draft_claimed` | 409 | no | A person of the company has the draft open in the app. Nothing was spent. | Wait, or read it again later. |
| `draft_issuing` | 409 | no | The draft is being issued right now. Nothing was spent. | Read it with `getDraft`; do not issue it again. |
| `draft_issued` | 409 | no | The draft already became a document. | `getDraft` returns the document (`generationCode`). |
| `draft_not_issuable` | 409 | no | The draft is cancelled, expired or otherwise not in a state that can be issued. | Create a new draft. |
| `item_final` | 409 | no | The draft is already resolved and cannot be changed or cancelled. | Read it with `getDraft`. |
| `id_conflict` | 409 | no | That draft `id` is taken by another item. | Pick another UUID, or omit `id`. |
| `inbox_cap_reached` | 429 | no | The key or the company holds the maximum number of open drafts (500 per company). | Cancel or issue some; they also expire after 30 days. |
| `content_hash_mismatch` | 422 | no | Legacy sealed drafts only: the plaintext does not hash to `contentHash`. | Send the plain request instead (`createDraft`). |
| `catalog_write_test_key` | 403 | no | A test key tried to write after the company went live. | Use the production key. |

## Idempotency

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `idempotency_key_required` | 400 | no | A non-undoable route without `Idempotency-Key`. The SDK always sends one, so this only appears with direct HTTP calls. | Send a key per operation. |
| `idempotency_key_reuse` | 422 | no | The key was already used with a different body. | Find why the body changed; never hide it with a new key. |
| `idempotency_in_flight` | 409 | **yes** | The first request with that key is still running. `details.enVueloSegundos` says for how long, and `details.codigoGeneracion` names the document when something irreversible had started. | Wait and replay the same key; ask `getDocumentStatus` for the named document. |

## Returns

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `return_exceeds_available` | 422 | no | More than what is left of a line (`details.lineas`: `linea`, `solicitado`, `disponible`). | Ask for at most what is available. |
| `return_window_closed` | 422 | no | `fechaEvento` before the document, in the future, or past the return window. | Past the window the document no longer admits a return. |
| `return_type_not_allowed` | 422 | no | The document is not 01, 11 or 14. | Use a credit note. |
| `return_pdf_unavailable` | 404 | no | The return event's PDF cannot be drawn any more, or a ticket was requested. | Use the original `representacionGrafica` or your stored copy. |
| `has_return_events` | 409 | no | `invalidate` on a document with sealed returns. | Correct with more returns or a credit note. |

See [return-event.md](return-event.md).

## Limits

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `rate_limited` | 429 | no | The key reached its hourly or daily ceiling, or `/v1/status`'s own window (`details.window`, `details.remaining`, `details.retryAfterSeconds`). | Wait `retryAfterSeconds`, then replay the same key. |
| `amount_limit` | 429 | no | The document exceeds the key's maximum amount per document. Checked before reserving; no number spent. | Raise the key's ceiling or split the operation. |

## Hacienda and the service

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `mh_rejected` | 422 | no | Hacienda read the document and refused it. The control number **was spent** (`error.spent`). | Read `error.mhObservations`, fix the data. A replay of the same key returns the same rejection. |
| `mh_unreachable` | 502 | **yes** | Reserved: the current API never returns it on issuance, where a transport failure becomes a 202 contingency. On invalidation it means nothing was invalidated. | Replay the same key. |
| `correlative_unavailable` | 503 | **yes** | The control number could not be reserved. No number spent. | Replay the same key. |
| `service_unavailable` | 503 | **yes** | A Facta dependency did not answer. Also thrown locally (503) when a vault or catalog envelope fails its digest or format check. | Replay the same key; for a local envelope error, re-sync from the app. |
| `mh_auth_failed` | 424 | no | Hacienda answered the login and refused the company's own transmission credentials (not your Facta key). | The owner updates the credentials in the app; retrying cannot fix it. |
| `paid_plan_required` | 402 | no | An extra company of a multi-company owner on a free or trial plan, issuing in production. | The owner chooses a paid plan. |
| `internal_error` | 500 | no | An unexpected failure. Also thrown locally when a response is not valid JSON, an invalidation response names another document, or a catalog response lacks its record. | If it repeats, contact support with the time and your `keyId`. |

A contingency (`estado: "contingencia"`, HTTP 202) is **not** an error: the
document is signed and Facta will retransmit it.

## Storage

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `no_storage_destination` | 422 | no | The company has no storage destination connected and verified in the last 30 days. Checked before reserving. Also thrown locally (422) by `syncDestinations` when the destination snapshot is not published. | Connect or re-sync a destination in the app. |
| `storage_unsupported` | 501 | no | The server does not expose the managed-storage route (the SDK also maps 404 to it), or a `source: "managed"` download got no source proof. | Update the server before depending on it. |
| `temporary_copy_expired` | 410 | no | The temporary encrypted copy was deleted (2 days after the document was marked stored, or 30 days after sealing) and Facta Storage has no copy. | Look in your own storage. To prevent it, report every document with `confirmDocumentStorage` and drain `storeAndConfirmUnconfirmed` daily ([guide](temporary-copy.md)). |
| `nothing_to_repair_from` | 409 | no | `retryDocumentStorage` on a document whose temporary copy is gone: nothing is left to rewrite from. | Recover the JSON from your own storage. |
| `storage_hash_mismatch` | 422 | no | The `sha256` of `confirmDocumentStorage` is not the one of that document's JSON (truncated file, another document). Nothing was recorded. | Download again with `downloadDocument` and hash the bytes you stored. |
| `storage_unavailable` | 503 | **yes** | The managed copy could not be read or repaired right now. | Retry only the storage operation; never re-issue. |
| `storage_contract_invalid` | 502 (SDK) | no | A storage response or receipt is malformed. On a successful issue it appears as `result.storageErrorCode` instead, with the sealed result intact. | Repair the copy later (`recoverOperation` / `retryDocumentStorage`). |

## Google Drive token broker

Only for `GET`/`POST /v1/destinations/{id}/drive-token`, which the SDK does not wrap. Drive does not count as API storage.

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `drive_not_available_for_api` | 403 | no | Drive is switched off for the API. | Use Facta Storage or another destination. |
| `drive_not_configured` | 503 | no | This deployment has no Google OAuth client. | Nothing the caller can fix. |
| `drive_reauthorization_required` | 409 | no | Google retired the grant. | A person confirms Google again in the app. |
| `drive_token_failed` | 502 | no | Google failed or refused for another reason. | Try later. |

## Delivery

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `entrega_vencida` | 410 | no | More than five minutes since issuance; the channel becomes `vencido`. | Do not retry with that token; deliver by other means. |
| `entrega_token_invalido` | 401 | no | The delivery token does not match this document and channel, or the document has none. | Use `result.entrega.token` exactly; read states with `getDelivery`. |
| `canal_no_marcado` | 409 | no | The issue request did not mark that channel. | Channels are marked only at issuance. |

A channel that cannot deliver (`fallido`, `sin_credito`, …) is a **state**, not
an error. See [delivery.md](delivery.md).

## Local SDK codes

These never come from the server; `status` is `0`.

| Code | Retried | Meaning | What to do |
| --- | --- | --- | --- |
| `network_error` | **yes** | No usable answer: connection failure or the SDK's own `timeoutMs`. | After retries, replay the same request and key. |
| `operation_outcome_unknown` | no | An invalidation may have completed, but its signed event cannot be recovered (safe window expired, or the API only confirms it was already invalidated). | Reconcile manually; do not invalidate again. |
| `archive_integrity_error` | no | Local archive data failed an identity or digest check, or the API identity (endpoint, key, issuer, environment) differs from the one an operation was journaled with. | Keep the encrypted files; inspect before repairing. Use the original client and credentials. |

## Browser client codes


The browser client (`@facta-dte/api/browser`) throws `FactaClientError`, which
carries the same codes plus the handler's own `session_invalid`,
`session_expired`, `action_not_allowed`, `unauthorized` and `bad_request`, and
a `transport` flag. See [browser.md](browser.md).

## Not a `FactaError`

- `TypeError` / `RangeError`: local input checks before any request (bad
  `deliver`, `raw` with a PDF, a ticket width outside 40–120, a malformed
  `ReturnRequest`, an invalid `region`, missing archive).
- `DOMException` named `AbortError`: your `AbortSignal` fired. It does not prove
  the server did not act.
- `Error` from archive recovery: "Request does not match the saved fingerprint",
  "The safe idempotency window (23 h) expired", "Archive operation not found".
- `OperationError` / `SyntaxError` from Web Crypto or JSON when an unlock key is
  wrong or an envelope is corrupt.
- Adapter-specific errors from storage destinations (for example
  `BridgeArtifactStoreError`).

## Related

- [Idempotency patterns](idempotency.md) · [Delivery](delivery.md) ·
  [Returns](return-event.md)
- [Method reference](reference.md) · [Diagnostics](diagnose.md)
