# Errors: every `FactaErrorCode`, grouped, with what to do

Sources: `guides/errors.md`, `src/errors.ts`, `src/client.ts`, contract
(`x-facta-errores`). Statuses are HTTP; `0` = produced locally by the SDK.

```ts
import { FactaError } from "@facta-dte/api";
try { await facta.issue(request, { idempotencyKey }); }
catch (error) {
  if (!(error instanceof FactaError)) throw error; // TypeError, RangeError, AbortError…
  switch (error.code) { /* branch on error.code ONLY */ }
}
```

`FactaError` members: `code`, `status`, `details` (code-specific), `message` (prose,
may change, never parse it), `isRejection` (`true` only for `mh_rejected`), `spent`
(`{ codigoGeneracion, numeroControl }` when a number was burned, else `null`),
`mhObservations` (Hacienda's text, verbatim). Keys and delivery tokens are redacted
from `message` and `details`.

**Automatic retries** (same `Idempotency-Key`, up to `maxRetries`): only
`idempotency_in_flight`, `network_error`, `service_unavailable`,
`correlative_unavailable`, `mh_unreachable`, `storage_unavailable`. After they are
exhausted the outcome of a POST is **uncertain** → replay the same request and key.
Everything else is final for that request.

## Credentials and access — fix configuration, never retry

| Code | HTTP | Meaning → action |
| --- | --- | --- |
| `unauthorized` | 401 / 0 | No `X-Facta-Key`; locally: missing `apiKey`, an unlock key passed as `signKey`, malformed `unlockKey`, sync without `unlockKey` → configure what the message names. |
| `invalid_api_key` | 401 | Unknown key or wrong secret → copy the whole key, including the dot. |
| `key_revoked` | 403 | Revoked → mint a new key. |
| `key_expired` | 403 | Past expiry → mint a new key. |
| `key_inactive` | 403 | Deactivated → reactivate in the app. |
| `forbidden_scope` | 403 | Missing scope (`details.required`, `details.granted`) → mint a key with it; scopes are not editable. |
| `dte_type_not_allowed` | 403 | Key may not issue that `tipoDte` (`details.allowed`) → mint a key including it. |
| `ip_not_allowed` | 403 | Caller not in the key's allow-list → add the address or CIDR when minting. |
| `environment_not_allowed` | 403 | Key prefix/row or company environment disagree → use a production key only for a company already in production. |
| `sign_key_required` | 401 | Signing route without `signKey` (or with the unlock key) → pass `factask_…`. |
| `sign_key_invalid` | 401 | Wrong signing key (`details.intentosRestantes`) → fix before the vault locks. |
| `sign_vault_locked` | 403 | Five failures in an hour; key suspended → reactivate in the app (waiting does not help). |
| `sign_vault_missing` | 409 | Key not provisioned to sign, or certificate of another NIT → re-mint from the app. |

## Request and validation — fix the data; no number was spent

| Code | HTTP | Meaning → action |
| --- | --- | --- |
| `invalid_request` | 400 / 422 | Missing/non-JSON/over-1 MB body, wrong field shape, non-UUID code (`details.field`); locally: invalid catalog product type/unit or VAT-basis mismatch → fix the request. |
| `validation_failed` | 422 | Fails Hacienda's official schema (`details.issues`); also thrown locally by catalog writes → fix the listed fields. |
| `retention_mixed_class_unsupported` | 422 | `aplicarReteRenta` with an `exenta`/`no_sujeta` line → issue those lines separately or drop the withholding. |
| `not_found` | 404 | No such document/customer/product/route for this key's company; also locally for an id not in the catalog snapshot → check id and company; sync the catalog. |
| `method_not_allowed` | 405 | Route exists, wrong method (only outside the SDK). |
| `prepare_token_invalid` | 422 | Token expired (15 min), other key, or document changed → `prepare` again. |
| `include_limit_exceeded` | 400 | `listDocuments` with `include: ["dte"]` asked for more than 25 rows (`details.maximo`) → ask for 25 or fewer and follow `siguiente`. |
| `not_sealed` | 409 | Default JSON download of a document with no seal (contingency) → `{ raw: true }` or wait for the seal. |
| `catalog_write_disabled` | 403 | Company did not enable catalog administration from the API → enable it in the app. |
| `catalog_encrypted` | 409 | Catalog still encrypted, API cannot write → switch to plain text in the app. |
| `catalog_duplicate` | 409 | A customer with that document, or a product with that code, already exists (`details.id` names it) → edit it, or reactivate it if deactivated. Only in SDK versions that include the catalog field-names change (PR #38). |

## Idempotency

| Code | HTTP | Retried | Meaning → action |
| --- | --- | --- | --- |
| `idempotency_key_required` | 400 | no | Only with direct HTTP; send a key per operation. |
| `idempotency_key_reuse` | 422 | no | Same key, different body → find why the body changed; never mask it with a new key; never reuse a `prepare` key on `sign`. |
| `idempotency_in_flight` | 409 | yes | First request still running (`details.enVueloSegundos`, `details.codigoGeneracion`) → wait, replay the same key, or ask `getDocumentStatus`. |

## Returns (see contingency-invalidation-return.md)

| Code | HTTP | Meaning → action |
| --- | --- | --- |
| `return_exceeds_available` | 422 | More than what is left of a line (`details.lineas`: `linea`, `solicitado`, `disponible`) → ask for at most the available amount. |
| `return_window_closed` | 422 | `fechaEvento` before the document, in the future or past the window → the document no longer admits a return. |
| `return_type_not_allowed` | 422 | Not a 01, 11 or 14 → use a credit note. |
| `return_pdf_unavailable` | 404 | The event's PDF cannot be redrawn, or a ticket was asked → use the original `representacionGrafica` or your copy. |
| `has_return_events` | 409 | `invalidate` on a document with sealed returns → more returns or a credit note. |

## Limits

| Code | HTTP | Meaning → action |
| --- | --- | --- |
| `rate_limited` | 429 | Hourly/daily ceiling or `/v1/status`'s window (`details.window`, `remaining`, `retryAfterSeconds`) → wait, then replay the same key. |
| `amount_limit` | 429 | Document exceeds the key's maximum amount; nothing reserved → raise the ceiling or split. |

## Hacienda and the service

| Code | HTTP | Retried | Meaning → action |
| --- | --- | --- | --- |
| `mh_rejected` | 422 | no | Hacienda refused it; the number **was spent** (`error.spent`) → read `error.mhObservations`, fix the data, issue a corrected request with a new key. A replay of the same key returns the same rejection. |
| `mh_unreachable` | 502 | yes | Reserved; issuance never returns it (transport failures become a 202 contingency). On invalidation: nothing was invalidated → replay the same key. |
| `correlative_unavailable` | 503 | yes | Control number could not be reserved; none spent → replay the same key. |
| `service_unavailable` | 503 | yes | A Facta dependency did not answer; locally, a vault/catalog envelope failed its digest → replay the same key; re-sync from the app for envelope errors. |
| `internal_error` | 500 | no | Unexpected; also locally for a non-JSON response or a mismatched invalidation → if it repeats, contact support with the time and your `keyId`. |

## Storage

| Code | HTTP | Retried | Meaning → action |
| --- | --- | --- | --- |
| `no_storage_destination` | 422 | no | No verified destination (older issuance behaviour); locally from `syncDestinations` (snapshot not published) and `syncCatalog` (`details.reason: "catalog_out_of_sync"`) → connect/re-sync in the app. Per the current contract issuance proceeds with the warning `sin_almacenamiento_duradero` instead. |
| `storage_unsupported` | 501 | no | Server lacks the managed-storage route, or `source: "managed"` got no proof → update the server before depending on it. |
| `storage_unavailable` | 503 | yes | Managed copy cannot be read/repaired right now → retry only the storage operation; never re-issue. |
| `storage_contract_invalid` | 502 (SDK) | no | Malformed storage response/receipt; on a successful issue it appears as `result.storageErrorCode` with the sealed result intact → repair later (`recoverOperation` / `retryDocumentStorage`). |

## Delivery

| Code | HTTP | Meaning → action |
| --- | --- | --- |
| `entrega_vencida` | 410 | More than 5 minutes since issuance; channel becomes `vencido` → deliver by other means. |
| `entrega_token_invalido` | 401 | Token not for this document/channel, or none exists → use `result.entrega.token` exactly. |
| `canal_no_marcado` | 409 | The issue request did not mark that channel → channels are marked only at issuance. |

A channel that cannot deliver (`fallido`, `sin_credito`…) is a **state**, not an error.

## Local SDK codes (`status` 0)

| Code | Retried | Meaning → action |
| --- | --- | --- |
| `network_error` | yes | No usable answer (connection or the SDK's own `timeoutMs`) → after retries, replay the same request and key. |
| `operation_outcome_unknown` | no | An invalidation may have completed but its event cannot be recovered → reconcile manually; do not invalidate again. |
| `archive_integrity_error` | no | Local archive failed an identity/digest check, or the API identity differs from the one journaled → keep the encrypted files; use the original client and credentials. |

## Not a `FactaError`

`TypeError` / `RangeError` (local input checks before any request: bad `deliver`,
`raw` with a PDF, ticket width outside 40–120, malformed `ReturnRequest`, bad
`region`, missing archive); `DOMException` `AbortError` (your signal fired; the
server may still have acted); `Error` from archive recovery ("Request does not match
the saved fingerprint", "The safe idempotency window (23 h) expired"); `OperationError`
/ `SyntaxError` for a wrong unlock key or a corrupt envelope; adapter-specific errors.
The browser client throws `FactaClientError` (same codes plus `session_invalid`,
`session_expired`, `action_not_allowed`, `bad_request`, and a `transport` flag).

## Contingency is not an error

`estado: "contingencia"` (HTTP 202) means signed and owed to Hacienda; Facta
retransmits. Never answer it by issuing again.
