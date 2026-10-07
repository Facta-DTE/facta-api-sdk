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
`correlative_unavailable`, `mh_unreachable` and `storage_unavailable`. It makes
up to `maxRetries` extra attempts (default 3), waiting 250 ms, 500 ms, 1 s…
(capped at 4 s). When they are exhausted you receive the last error; the outcome
of a POST is then **uncertain**: replay the same request with the same key (see
[idempotency.md](idempotency.md)). Every other code is final for that request.

In the tables, "Retried" means retried automatically by the SDK.

## Credentials and access

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `unauthorized` | 401 (0 locally) | no | No `X-Facta-Key` reached the API. Locally: `apiKey` missing, an unlock key (`factauk_`) passed as `signKey`, a malformed `unlockKey`, or `syncCatalog`/`syncDestinations` without `unlockKey`. | Configure the credential named in the message. |
| `invalid_api_key` | 401 | no | The key does not exist, is mistyped, or its secret does not match. | Copy the whole key, including the dot. |
| `key_revoked` | 403 | no | Revoked from the app. | Mint a new key. |
| `key_expired` | 403 | no | Past its expiry date. | Mint a new key. |
| `key_inactive` | 403 | no | Deactivated. | Reactivate it in the app. |
| `forbidden_scope` | 403 | no | The key lacks the route's scope (`details.required`, `details.granted`). | Mint a key with that scope; scopes cannot be edited. |
| `dte_type_not_allowed` | 403 | no | The key may not issue that `tipoDte` (`details.allowed`). | Mint a key that includes the type. |
| `ip_not_allowed` | 403 | no | The key has an IP allow-list and the caller is not in it. | Add the address or CIDR range when minting. |
| `environment_not_allowed` | 403 | no | Key prefix and key row disagree, or the key's environment differs from its company's. | Use a production key for a company already in production. |
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
| `not_found` | 404 | no | No such document, customer, product or route for this key's company. Also thrown locally when a `customerId`/`productId` is not in the catalog snapshot. | Check the identifier and the key's company; sync the catalog. |
| `method_not_allowed` | 405 | no | The route exists, but not with that method. | Only seen when calling the API outside the SDK's methods. |
| `prepare_token_invalid` | 422 | no | The `prepareToken` expired (15 min), belongs to another key, or the document changed. | Call `prepare` again. See [prepare-sign.md](prepare-sign.md). |
| `not_sealed` | 409 | no | Default JSON download of a document with no seal yet (contingency). | Use `{ raw: true }` or wait for the seal. See [archivo-dte.md](archivo-dte.md). |
| `catalog_write_disabled` | 403 | no | The company did not enable «Permitir administrar clientes y productos desde el API». | Enable it in the app. See [catalog-write.md](catalog-write.md). |
| `catalog_encrypted` | 409 | no | The company catalog is still encrypted, so the API cannot write it. | Switch the catalog to plain text in the app. |

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
| `internal_error` | 500 | no | An unexpected failure. Also thrown locally when a response is not valid JSON, an invalidation response names another document, or a catalog response lacks its record. | If it repeats, contact support with the time and your `keyId`. |

A contingency (`estado: "contingencia"`, HTTP 202) is **not** an error: the
document is signed and Facta will retransmit it.

## Storage

| Code | HTTP | Retried | Meaning | What to do |
| --- | --- | --- | --- | --- |
| `no_storage_destination` | 422 | no | The company has no storage destination connected and verified in the last 30 days. Checked before reserving. Also thrown locally (422) by `syncDestinations` when the destination snapshot is not published, and by `syncCatalog` when the catalog is out of sync (`details.reason: "catalog_out_of_sync"`). | Connect or re-sync a destination (or the catalog) in the app. |
| `storage_unsupported` | 501 | no | The server does not expose the managed-storage route (the SDK also maps 404 to it), or a `source: "managed"` download got no source proof. | Update the server before depending on it. |
| `storage_unavailable` | 503 | **yes** | The managed copy could not be read or repaired right now. | Retry only the storage operation; never re-issue. |
| `storage_contract_invalid` | 502 (SDK) | no | A storage response or receipt is malformed. On a successful issue it appears as `result.storageErrorCode` instead, with the sealed result intact. | Repair the copy later (`recoverOperation` / `retryDocumentStorage`). |

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

## Codes outside the TypeScript union

The API contract also lists `retention_mixed_class_unsupported` (HTTP 422):
`aplicarReteRenta` on a document with an `exenta` or `no_sujeta` line. Nothing
was signed and no number was spent. The SDK passes the server's code through
unchanged, so `error.code` can hold it even though `FactaErrorCode` does not
declare it in this version; compare it as a string.

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
