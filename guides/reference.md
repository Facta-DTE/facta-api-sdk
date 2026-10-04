# TypeScript SDK method reference

This reference describes the public methods exported by `@facta-dte/api`. The
installed package declarations are authoritative for exact TypeScript types;
the [published OpenAPI contract](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json) is authoritative
for request and response schemas.

## Credentials and request behavior

Facta API calls from a `Facta` instance carry `apiKey`; the key determines the
Facta/MH environment. `baseUrl` selects the Facta API host and defaults to the
public API URL. The OpenAPI contract endpoint is public and needs no key even
though the SDK calls it through the configured client. `signKey` is sent only
on `issue`, `sign`, `invalidate`, and `invalidateAndArchive`. `unlockKey` is used in process memory
to decrypt destination and catalog envelopes and is never sent over HTTP.

`timeoutMs` defaults to 60,000 ms for the complete request, including reading
the response body. `maxRetries` defaults to 3. Both can be set through legacy
flat options or `config: { version: 1, ... }`; explicit flat options take
precedence. The versioned scalar config also supports expected environment/scopes,
non-fiscal stale-catalog defaults, and ticket width. A separate
`runtime: FactaRuntimeConfigV1` accepts an invoice archive, an invalidation
archive, remote destinations, and a print transport; per-call adapters override
these defaults. Credentials stay
outside both configuration objects. Only the SDK's explicitly
retryable network/service errors are retried; each POST uses one
`Idempotency-Key` for all attempts. Supply a stable `idempotencyKey` from the
business order when recovery must survive a process restart. Aborting a
request stops retries, but it does not prove that a request already accepted
by the server was cancelled.

The common authenticated failure type is `FactaError`, with `code`, `status`,
`details`, `isRejection`, and `spent`. Classify by `code`, not localized
message text. Local validation and adapter/archive failures can also throw
`TypeError`, `RangeError`, or an adapter-specific error before/after an HTTP
request. HTTP error messages and metadata have configured API/signing/unlock
secrets redacted; credential-named fields are omitted. Network errors use a
generic message and never include runtime exception text.

## Client lifecycle and status

| Method | Inputs and defaults | Scope / secrets | Behavior and important outcomes |
|---|---|---|---|
| `new Facta(options)` | `apiKey` required; `signKey`, `unlockKey`, `baseUrl`, `timeoutMs=60000`, `maxRetries=3`, `fetch`, `config: FactaConfigV1`, and `runtime: FactaRuntimeConfigV1` optional | No request | Creates a client. Requires `apiKey`; checks credential prefixes and rejects a `factauk_` value passed as `signKey`. `fetch` is intended for an owning runtime or tests. |
| `status(options?)` | Optional `{ signal? }` → `Status` | No additional scope | `GET /v1/status`; returns environment, issuer, remaining limits, synchronization revisions, and public signing-certificate facts where registered. Does not decrypt vault contents. Abort/network/API failures follow the common error rules below; safe to repeat. |
| `diagnose(options?)` | Optional `DiagnoseOptions` → `DiagnosticsReport` | `download` for managed capability; archive is local | Calls status and evaluates issue/query/download readiness, configured environment/scopes, revisions, certificate facts, and optionally archive readiness and pending operation count. Also checks managed-storage readiness; an older API or missing permission is reported as unknown and never mistaken for a durable copy. Does not decrypt vaults or reserve a number. API failure returns a blocked report rather than throwing the status failure. |
| `getContract()` | None | No additional scope | `GET /v1/openapi.json`; returns the published JSON contract as `unknown`. |

## Vault synchronization and local catalog

Both synchronization methods require the local `unlockKey`. They fetch the
encrypted destination bundle from `GET /v1/vault/destinations`, verify its
envelope, and decrypt only in the current process. Missing/pending revisions,
unsupported versions, and digest mismatches fail closed with `FactaError`.
Web Crypto may throw `OperationError` for a wrong unlock key, and invalid JSON
may throw `SyntaxError`; the unlock key is not transmitted in either case.

| Method | Inputs / return | Scope | Behavior and important outcomes |
|---|---|---|---|
| `syncDestinations()` | None → `Promise<DestinationSnapshot>` | No additional API scope; local `unlockKey` required | Opens the per-key storage destination snapshot in memory. Accepts `ready` and legacy synchronization state; pending/missing state fails with `no_storage_destination`. Does not write artifacts to those destinations. |
| `syncCatalog()` | None → `Promise<CatalogSnapshot>` | No additional API scope; local `unlockKey` required | Opens the latest authorized customer/product snapshot and replaces this instance's in-memory cache. Requires a ready published catalog and verifies the encrypted envelope digest. |
| `catalogState()` | None → `Promise<CatalogState>` | No additional API scope | Compares the local catalog revision with public status. Returns `missing`, `fresh`, or `stale` plus revisions, fetch time, and a safe status error code; never returns catalog contents. |
| `listCustomers(options?)` | `{ allowStale?: boolean }` → customer array | Local snapshot | Returns a copy of authorized customers. Stale cache is used only when explicitly opted in and current status is unavailable. |
| `getCustomer(id, options?)` | Stable Facta customer ID and optional `{ allowStale?: boolean }` → customer or `null` | Local snapshot | Returns the matching authorized customer, or `null` when absent. |
| `searchCustomers(query, options?)` | Query and optional `{ limit=50, allowStale?: boolean }` → customer array | Local snapshot | Case/diacritic-insensitive search over name, document number, NRC, and email. `limit` must be an integer from 1 through 500. |
| `listProducts(options?)` | `{ includeInactive?: false, allowStale?: boolean }` → product array | Local snapshot | Returns active products by default; `includeInactive: true` includes inactive records. |
| `getProduct(id, options?)` | Stable Facta product ID and optional `{ allowStale?: boolean }` → product or `null` | Local snapshot | Returns `null` for missing or inactive products. |
| `searchProducts(query, options?)` | Query and optional `{ limit=50, allowStale?: boolean }` → product array | Local snapshot | Case/diacritic-insensitive search over description, code, and barcode; inactive products are omitted. `limit` must be an integer from 1 through 500. |

Invalid limits and missing runtime configuration fail locally with `TypeError`
or `RangeError`. Snapshot/API failures use `FactaError`; the specific method
descriptions above identify the relevant state and fallback. Read methods do
not reserve fiscal numbers or mutate the remote catalog.

Every customer/product reference used for fiscal resolution requires a fresh
catalog. Explicit inline fields win over snapshot values. Missing customers,
missing products, or inactive products fail with `not_found` and identify the
record ID/revision in error details. Stale catalog opt-in applies only to
non-fiscal lookup; it never permits stale issuance resolution. Inline request
data does not create or update catalog records.

## DTE operations

Every HTTP operation can reject with `FactaError` for authentication, scope,
validation, or server failures. GET operations are safe to repeat. For
idempotent POST operations, pass a stable `idempotencyKey` and repeat the same
request. `AbortError` only stops client-side waiting and retries; it cannot
prove the server did not accept an in-flight request. Local input validation
throws `TypeError`/`RangeError` before sending. Server responses keep their
Spanish field names and enum values from the wire contract.

| Method | Inputs / return | Scope / secret | Side effects, retry, and recovery |
|---|---|---|---|
| `issue(request, options?)` | `DteRequest`, optional `{ idempotencyKey?, signal? }` → `IssueResult` | `issue`; `signKey` required | `POST /v1/dte`; server prepares, signs, and submits. A sealed response is final; `contingencia` is an accepted 202 result that still needs reconciliation. A rejection can mean the control number was spent (`error.spent`). Retry only with the same key and same request. |
| `prepare(request, options?)` | `DteRequest`, optional call options → `PreparedDte` | `issue`; no `signKey` | `POST /v1/dte/prepare`; reserves a control number and returns the canonical unsigned document and prepare token. The reservation is a fiscal side effect. |
| `sign(prepared, options?)` | Unmodified `PreparedDte`, optional call options → `IssueResult` | `issue`; `signKey` required | `POST /v1/dte/sign`; transmits the prepared token/document. Pass the result through unchanged. Reuse the same idempotency key after an uncertain response. |
| `getDocumentStatus(generationCode)` | Generation code → `DocumentStatus` | `query` | `GET /v1/dte/{codigoGeneracion}`; reads known sealed, rejected, or pending status. No idempotency key is sent. |
| `listDocuments(filters?)` | Optional date/state/type/limit/cursor filters → `DtePage` | `query` | `GET /v1/dte`; default page size is 50 and the API maximum is 100. Follow `siguiente` exactly; rows are summaries rather than full signed documents. They may include the recipient's name and document number; private-mode encryption at rest does not hide these fields from an authorized API key. Treat the response as personal data and keep it out of general logs. Rejected reservations are queried by generation code and cannot be listed. |
| `invalidate(generationCode, request, options?)` | Generation code, `InvalidationRequest`, optional call options → `InvalidationResult` | `issue`; `signKey` required | `POST /v1/dte/{codigoGeneracion}/invalidate`; irreversible fiscal action. POST retry uses the same idempotency key. |
| `invalidateAndArchive(generationCode, request, options)` | Generation code, request, `{ archive, operationId, idempotencyKey, signal? }` → `InvalidationArchiveResult` | `issue`; `signKey` required when sending | Writes an encrypted command journal before sending, reuses the same key after an interrupted response, and retains the returned event JWS. `archive.state` is separate from fiscal success. |
| `recoverInvalidation(operationId, archive?, signal?)` | Journal ID and optional archive → `InvalidationArchiveResult` | `issue`; `signKey` required only when retrying the same unresolved command | Replays with the saved idempotency key only within the 23-hour safety window. Expired operations or sparse “already invalidated” responses stop with `operation_outcome_unknown`; manual reconciliation is required. |
| `listPendingInvalidations(archive?)` | Optional archive → allow-listed pending event summaries | No Facta scope; requires the local archive | Lists incomplete invalidation journals without returning representative fields, full response, or JWS. |
| `listHolding(limit=50)` | Optional integer limit → `HoldingPage` | `download` | `GET /v1/dte/holding`; API caps the result at 100. Returns retention/sync evidence, not document bytes and not a paginated history. |

## Download, archive, recovery, replication, and printing

| Method | Inputs / return | Scope / secrets | Behavior and important outcomes |
|---|---|---|---|
| `getStorageStatus(options?)` | Optional `{ signal? }` → `ManagedStorageStatus` | `download` | Checks capability v1, managed coverage/quota/integration, and verified BYOS readiness for the key's issuer/environment. Old servers (404/501) become `storage_unsupported`; malformed present responses fail as `storage_contract_invalid`. |
| `getDocumentCopies(options?)` | Optional `{ generationCode?, signal? }` → `ManagedDocumentCopy[]` | `download` | Lists only managed JSON/PDF receipts for the authenticated issuer/environment. Includes pending/failed states; never returns object paths or signed URLs. |
| `retryDocumentStorage(generationCode, options?)` | UUID and optional `{ signal? }` → `ManagedStorageReceipt` | `download` + `issue` | Repairs stored bytes for an already sealed DTE. It never calls `issue`, reserves a fiscal number, or accepts replacement content; errors when the API cannot recover originals. |
| `downloadDocument(generationCode, kind="json", options?)` | `kind`: `json`, `pdf`, or `ticket`; optional `{ paperWidthMm?, signal? }` → `DownloadedDocument` | `download` | Returns exact server bytes, content type, and suggested filename. `storageSource` identifies managed, holding, or archive retrieval when the server reports it. Ticket is regenerated from an already sealed API-issued document without another DTE; documents issued in the web app are not available through this regeneration route. `paperWidthMm` applies only to ticket and must be an integer from 40 to 120; default is 80. |
| `issueAndArchive(request, options)` | Requires stable `operationId` and `idempotencyKey`; archive and remote destinations may come from `runtime`, with per-call overrides; optional signal and `ticketPaperWidthMm=80` → `ArchiveEmissionResult` | `issue` + `download` (ticket and recovery); `signKey` for issuance; `unlockKey` only when resolving catalog references | Verifies local archive readiness before reserving a number, records a restart-safe journal, and stores the exact server-returned signed JSON and PDF bytes without fetching them again. It derives the JWS from that JSON and downloads only the optional receipt ticket. Older API responses fall back to artifact downloads. Inspect `result.archive.state` separately from fiscal success; archive failure does not undo an issued DTE. Remote copy outcomes are separate. |
| `recoverOperation(operationId, options?)` | Journal ID and optional `{ request?, archive?, signal?, remoteDestinations? }` → `ArchiveEmissionResult` | `issue` and possibly `download`; signing key needed only if the saved operation was never confirmed | Uses the encrypted request snapshot when available and verifies its fingerprint; accepts `request` for legacy journals without a saved snapshot. Reuses the saved idempotency key. Verifies API endpoint, key identity, issuer, and environment before any fiscal request. Expired or mismatched operations stop for manual reconciliation. |
| `listPendingOperations(archive?)` | Optional archive override → `PendingArchiveOperation[]` | No Facta scope; requires a ready local archive | Lists local operations that still need archive completion or remote-copy reconciliation. Returns an allow-listed summary without the stored fiscal request. Journal contents are encrypted by the archive adapter. |
| `replicateArchive(operationId, archive, destinations, options?)` | Completed local operation, archive, runtime-owned destination adapters, optional signal → `RemoteReplicationReport` | No Facta scope; provider credentials belong to each adapter | Reads and hash-verifies local artifact bytes, then writes/checks copies sequentially and persists one result per destination/artifact. A previously stored matching copy is skipped; ambiguous copies are reconciled where supported. Cancellation or journal-write failure is reported as unknown and requires reconciliation. |
| `diagnoseDestinations(operationId, archive, destinations, options?)` | Completed local operation, archive, runtime-owned destination adapters, optional signal/artifact kinds → `RemoteDestinationProbeReport` | No Facta scope; provider credentials belong to each adapter | Read-only check of existing copies. `stored` confirms matching bytes and read access; `missing` does not trigger a write; `unknown` means the check could not establish state; `unsupported` means the adapter has no check method. It does not prove remote write permission. |
| `print(document, transport?, options?)` | Previously downloaded PDF/ticket; transport defaults to `runtime.printTransport` → `PrintResult` | No Facta scope; transport owns printer access | Submits one job. Reports `submitted` or `unknown`, never physical `printed`. Uncertain submissions are not automatically retried. |

`InvalidationResult` is a union. A new successful invalidation includes its event,
document and JWS. If the API reports that the target was already invalidated,
its idempotent response may contain only the target identifiers and
`yaEstabaInvalidado: true`; that response cannot reconstruct the prior event.
Use `invalidateAndArchive()` when local event recovery is required.

`issueAndArchive` and `recoverOperation` retain the immutable resolved request,
its hash, idempotency key, and remote-copy state in the
encrypted local journal. Remote writers must use stable paths and support
idempotent same-byte writes, or expose `check` so the SDK can resolve an
ambiguous outcome. The built-in destination adapters are documented in
[`storage-adapters.md`](storage-adapters.md). The SDK does not currently send
WhatsApp messages; no WhatsApp endpoint or delivery contract is published.

## Types and deeper references

- Public request/response types and DTE union: [`../src/types.ts`](../src/types.ts)
- Client configuration, signatures, and retry implementation: [`../src/client.ts`](../src/client.ts)
- Archive journal and remote-copy states: [`../src/archive.ts`](../src/archive.ts)
- Error codes and rejection flags: [`../src/errors.ts`](../src/errors.ts)
- Diagnostic checks: [`../src/diagnostics.ts`](../src/diagnostics.ts)
- Server request/response schemas: [published OpenAPI contract](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json)

A successful fiscal response can carry `storageErrorCode: "storage_contract_invalid"`
when its storage receipt is malformed or differs from exact inline bytes. The
invalid receipt is omitted; the sealed invoice remains successful. File archive
journals keep this condition pending until copy repair returns a valid receipt.
Managed-only readiness satisfies durable destination checks without a BYOS vault;
signing and catalog reference checks remain independent. Malformed present
capabilities block `diagnose()`; absent older routes are explicitly unknown.
