# Changelog

## 0.6.0-next.2 (2026-10-29)

**Pre-release** (`npm i @facta-dte/api@next`; `latest` stays on 0.5.3). Matches the staging API after its 29-Oct release.

- **`LineItem.montoDescu`**: discount of one line, in money (0 to `cantidad × precioUni`). No global discount on the wire yet.
- **`pagos` and the `Pago` type**: 1 to 10 payment rows (01, 03, 11, 14) that add up to the total to pay; the types refuse `pagos` on 05/06. `formaPago`, `exportacion.recintoFiscal`, `.tipoRegimen` and `.regimen` are checked against the Ministry's catalogues by the server (`422 validation_failed` with `details.field`, `details.catalog`, `details.supported`).
- **`campo_desconocido` warnings**: `ServerWarning` (with `campo`, `sugerencia`, `motivo`), `UnknownFieldWarning`, `result.unknownFields` and `unknownFieldWarnings()`; the `Facta-Warning` response header is read into `result.factaWarning` (`FactaWarningHeader`) and `parseFactaWarning()`. Both members exist on `issue()` results only when there is something to report. These warnings never trigger the emergency safeguard.
- **`FACTA_STAGING_BASE_URL`**: the staging API base. The client still defaults to the production host, so staging needs `baseUrl` explicitly; the README and guides no longer say there is no staging URL.
- Agent skill, staging variant `facta-dte-api-staging` (release `skill-staging`): ready to test with TypeScript on staging, with «Disponible ahora» and «En la próxima versión».

## 0.6.0-next.1 (2026-10-28)

**Pre-release.** Published to npm under the `next` dist-tag only; `latest` stays on 0.5.3 until the shared data key is in production. Install with `npm i @facta-dte/api@next`. The notes below are the planned 0.6.0 notes.

The shared data key: the server resolves catalogue ids, so the SDK no longer carries a copy of the catalogue.

### Breaking removals

- **`syncCatalog()` is removed**, with the per-key catalogue snapshot it opened (`CatalogSnapshot`, the in-memory cache and `src/catalog.ts`). `customerId` / `productId` are sent to the API untouched and the server resolves them in every catalogue mode (`encrypted` at rest, `readable`, `plain`). An unknown id answers `not_found` with `details.reason: "catalog_unknown_id"`.
- **`catalogState()` and the `CatalogState` type are removed**: there is no local revision to compare.
- **`allowStale` (per call) and `allowStaleCatalogReads` (config) no longer do anything.** Both are still accepted and ignored so existing calls and saved configs keep compiling; remove them at your convenience.
- **`listCustomers`, `getCustomer`, `searchCustomers` and the product reads always call the API** (`GET /v1/customers`, `GET /v1/products`). They no longer need `unlockKey` for an encrypted catalogue, and no longer fail with `unauthorized` when it is missing.
- **`diagnose()` no longer reports a `catalog-sync` check**, and `DiagnosticsReport.revisions` no longer has `catalog`. `Status.sincronizacion.catalog` is deprecated and optional.
- **No `X-Facta-Request-Fingerprint` header** on `issue`, `issueAndArchive`, `recoverOperation` and `prepare`: the SDK no longer rewrites the body, so the server's idempotency claim hashes the body again (AP-07). New journal records are `idempotencyHash: "body"` with no `requestFingerprint`. Journals written by 0.3 to 0.5 still recover: a `"fingerprint-v1"` record resends its stored fingerprint. `fingerprintV1` stays internal for that purpose and `conformance/fingerprint-v1.*` stays published for other clients. A 0.5 journal of an encrypted-catalogue company that held a locally resolved body must be recovered without passing a new `request` (the saved one is used).
- The sealed catalogue inbox (`/v1/catalog/changes`) and the per-key snapshot are retired on the server (`inbox_retired`, HTTP 410); `GET /v1/vault/destinations` may still carry a `vault.catalog` item with `syncStatus: "retired"` (and `Deprecation`/`Sunset` headers until 1-Jan-2027), which the SDK ignores. `GET /v1/catalog/changes?since=` is the change feed and works; drafts (`/v1/drafts`) are unaffected and now have client methods.

### Added

- Error codes the server now returns: `catalog_revision_conflict`, `catalog_record_inactive`, `catalog_search_too_broad`, `catalog_cursor_expired`, `data_grant_unavailable`, `data_grant_revoked`, `data_epoch_stale`, `inbox_retired` (typed, documented in `guides/errors*.md` and the skill).
- **`listCatalogChanges({ since, generation, limit })`** (`GET /v1/catalog/changes`): ids, revisions, operation and actor of what changed in the company catalogue. An expired cursor is `catalog_cursor_expired` with `reason`, `cabeza` and `generacion` kept in `error.details`.
- **Webhook management**: `createWebhook`, `listWebhooks`, `getWebhook`, `updateWebhook`, `deleteWebhook`, `rotateWebhookSecret`, `testWebhook` (`WebhookWithSecret.secret` is returned once). New codes `webhook_limit_reached` and `webhook_duplicate`.
- **Drafts** (scope `draft`): `createDraft`, `listDrafts`, `getDraft`, `getDraftByKey`, `updateDraft` (`version` sent as `If-Match`), `cancelDraft`, `issueDraft` (carries the signing key, returns the `issue` result plus `borradorId`). New codes: `drafts_not_ready`, `version_mismatch`, `draft_claimed`, `draft_issuing`, `draft_issued`, `draft_not_issuable`, `item_final`, `id_conflict`, `inbox_cap_reached`, `content_hash_mismatch`, `catalog_write_test_key`. Guide: `guides/drafts.md`.
- **Every code the server can answer is a typed `FactaErrorCode`**, including `mh_auth_failed` (424), `paid_plan_required` (402) and the Drive broker codes. `catalog_snapshot_retired` is removed: the server never sent it. Tests compare the code union with the contract snapshot in both directions, and the client's retry set with the one the errors guide marks as retried (it caught `data_grant_unavailable` / `data_epoch_stale` missing the **yes** marker).
- **Contract coverage test**: every operation of the contract snapshot (`test/fixtures/openapi.yaml`, refreshed from staging) is wrapped by a client method or listed as deliberately not wrapped (`GET /v1/representacion/plantillas` and `DELETE …/return/{evento}` have no method yet).
- Docs follow the staging contract: a production key (`facta_live_`) is refused with `environment_not_allowed` on emission and on the company-level routes (customers, products, webhooks, the change feed, drafts, destinations, templates) unless the company is in production; a read-only key hears `forbidden_scope` before `catalog_encrypted`, whose `details.hint` says whether the key lacks access or the catalogue is simply not shared.
- **Receiver-side verifier**, dependency-free (WebCrypto): `verifyWebhook`, `constructWebhookEvent` (throws `WebhookVerificationError`), `signWebhook`, `MemoryWebhookReplayStore`, `WEBHOOK_EVENTS`. Guide: `guides/webhooks.md`.
- **`revision` on single catalogue records and `ifMatch` on `updateCustomer` / `updateProduct`** (read from `Facta-Catalog-Revision` / `ETag`). Honoured by a company that shares its data key; a plain catalogue ignores `If-Match` (last write wins per field sent).
- **Fix: `invalidateAndArchive` / `recoverInvalidation` no longer fail with `internal_error` when the server echoes the document code in lower case** (it does once the document is indexed, while `issue` returned it in upper case). The target code is compared case-insensitively. Found by the staging live run.
- **`data_grant_unavailable` and `data_epoch_stale` are now retried** like the other 503s (the docs already said so); `data_grant_revoked` (403, the owner's decision) is never retried.
- Docs: `guides/catalog*.md` rewritten as "Catalog reads and id resolution"; the reference, README, Deno/Node guides and the skill no longer describe a local catalogue snapshot.

## 0.5.3 (2026-10-20)

- **Storage status and copies stay readable whatever kinds the server lists.** `getStorageStatus` and `getDocumentCopies` now accept any kind lists that include `json` and `pdf`, have no duplicate and put no kind in both lists, and copy entries may carry `invalidation`. On 20-Oct the API briefly listed `invalidation` as a supported kind, which 0.5.2 rejected with `storage_contract_invalid`; the API has since frozen its answer (`["json","pdf"]` / `["ticket","invalidation"]`, plus `capabilities.invalidationFile`), so 0.5.2 works again, and 0.5.3 no longer depends on the exact lists.
- **`X-Facta-Request-Fingerprint` on `POST /v1/dte` and `POST /v1/dte/prepare`.** `issue`, `issueAndArchive`, `recoverOperation` and `prepare` now send the SHA-256 (lowercase hex) of the RFC 8785 canonical form of the request as the caller wrote it: before `customerId` / `productId` are resolved from the catalog, delivery options included (fingerprint-v1, `conformance/fingerprint-v1.md`). The header is sent on those two routes only; request bodies are unchanged and retries resend identical bytes.
- **Behaviour change:** a catalog edit between an attempt and its retry now replays the original document instead of answering `422 idempotency_key_reuse`. Changing something the caller wrote still answers 422.
- **Server requirement (met):** the API lets a fingerprinted retry also match a claim hashed by body (mixed-retry tolerance, in production since 20-Oct-2026), so an operation started by 0.5.x and retried after upgrading within 24 h replays instead of answering `422 idempotency_key_reuse`.
- Archive journal: operation records gain `idempotencyHash` (`"body"` | `"fingerprint-v1"`) and `requestFingerprint`. `recoverOperation` sends the header for `"fingerprint-v1"`, none for `"body"`, and for a record without the field (older SDK, or dropped by a custom archive) tries without it first and, only if the server answers `422 idempotency_key_reuse`, resends the same body once with the fingerprint (never a third attempt). Journals remain readable.
- New shared conformance material for other SDKs: `conformance/fingerprint-v1.md`, generated vectors `conformance/fingerprint-v1.vectors.json` (regenerate with `node scripts/build-conformance-vectors.mjs`) and a dependency-free RFC 8785 module (`src/jcs.ts`, internal).

## 0.5.2 (2026-10-15)

- Docs and skill: deactivating **and reactivating** customers and products works from the API. `updateCustomer(id, { activo: true })` / `updateProduct(id, { activo: true })` reactivate (`PATCH` with `{"activo": true}`). The Spanish README said the public API does not create or update customers or products, and the catalog-write guides and the skill said reactivation is done in the Facta app; all were out of date since catalog writes shipped, and the web app does not list deactivated customers at all.
- Types: `CustomerInput` and `ProductInput` declare `activo?: boolean`, so the reactivation compiles without a cast.

## 0.5.1 (2026-10-07)

- The agent skill (`skills/facta-dte-api`) now always targets Facta's public API (the SDK default base URL) and documents both environments: `facta_test_` keys for pruebas (`00`) and `facta_live_` keys for producción (`01`), switched by key and never by URL, with a `status()` gate and a warning that a live key issues real fiscal documents.
- Every npm release now also creates a GitHub Release with the skill zip and the npm tarball attached, and a `skill-latest` release keeps the newest skill downloadable at a fixed URL.
- Fixed: `searchCustomers` / `searchProducts` with `limit` above 200 failed with `invalid_request` (400) on a readable or plain catalog, because the API pages at most 200 rows; the SDK now follows the cursor, so the call answers the same in every catalog mode.

## 0.5.0 (2026-10-07)

### Emergency safeguard

- New `runtime.emergencyStore(files, info)`: your function, called only when Facta could not store a sealed document durably (server warnings `sin_almacenamiento_duradero`, `sin_copia_en_servidor`, `copia_solo_temporal`, or any `sin_*` / `*temporal*` code), when every replication destination failed, or when `issueAndArchive` finds no destination at all. Once per `codigoGeneracion`; never on a normal issue and never on a timer. The SDK ships no storage of its own and sends bytes nowhere else.
- `files` is `{ archivoDte?, jsonRaw, pdf }` (from the response, or downloaded from the one-hour holding copy when the response lacks them); `info` is `{ codigoGeneracion, numeroControl, tipoDte, ambiente, fecEmi, reason, warnings, occurredAt }`.
- Results carry `emergency: { saved, reason, trigger, detail }` and an `sdkWarnings` entry `emergency_saved` / `emergency_failed` (`ArchiveEmissionResult.warnings` too). Not configured gives `reason: "not_configured"` (no `sdkWarnings`); a throwing function gives `"store_failed"`. Neither ever fails or hides the sealed result.
- `emergencyStore` is optional and a missing one raises no warning; `diagnose()` lists it as an informational `emergency-store` check that never changes `overall`. Without it the server still e-mails the company owner a backup copy when nothing could be stored.
- Optional `runtime.onEmergency(event)` for alerting; `facta.emergency.replicate(files, info)` re-tries normal replication from files your store kept.
- Server handler forwards `emergency: { saved, reason }` to the browser; React `FactaReceipt` and the sealed window show a banner and keep the downloads.
- Depends on the server adding `advertencias` with those codes; until then the safeguard fires only on the SDK's own triggers. Guide: `guides/emergency.md` / `emergency.es.md`.

### Behaviour change: the default JSON download is the Archivo DTE

- `downloadDocument(code, "json")` now returns the **Archivo DTE** by default (the signed document plus `firmaElectronica` and `selloRecibido`), not the stored holding JSON `{codigoGeneracion, ambiente, jws}`. Code that archived or verified the old shape from this call must pass `{ raw: true }` to keep receiving it. The result reports which one it got in `jsonFormat` (`"archivo-dte"` or `"raw"`, from `X-Facta-Json-Format`; absent on API servers that predate it).
- `FactaDownloadButton`, `FactaReceipt` and the sealed window: «Descargar JSON» gives the Archivo DTE.

### Added: list documents with their DTE

- `listDocuments({ include: ["dte"] })` (API `GET /v1/dte?include=dte`): each row carries `archivoDte` and `resumen` in one call; pages 20 by default, 25 max (`include_limit_exceeded`); needs the `download` scope. Rows the API cannot open (`needs_local_decrypt`) are completed locally from your destinations when `unlockKey` is set, with bounded concurrency; otherwise (or on failure) the row carries a clear `dteError` and the listing never fails. The PDF/ticket are never in the list.
- `summarizeArchivoDte(archivoDte)` (exported, pure): `{ receptor, lineas, primeraDescripcion, totalIva, totalPagar }` read from the legal document, independent of the catalog's privacy mode.
- Types `ListedDteError`, `DteResumen`; error code `include_limit_exceeded`; optional `read(path)` on `RemoteArtifactDestination`.
- React: `FactaDocumentList` takes `includeDte` and shows the receiver (legal document) and concept in the receiver cell; the server handler accepts `include: ["dte"]` and projects `resumen` under the same recipient exposure and masking.
### Added: agent skill for integrations

- `skills/facta-dte-api/`: an installable agent skill (`SKILL.md`, `references/*.md`, type-checked `templates/`) for integrating the SDK and the HTTP API, grounded in the guides, the source and the OpenAPI contract, with an index of the playground's recipes.  It ships in the npm package (`skills/`).
- `scripts/pack-skill.mjs` (`pnpm skill:pack`) zips it deterministically into `dist/facta-dte-api-skill.zip`; `pnpm skill:check` compiles the templates (`tsconfig.skill.json`) and checks links, the frontmatter and that `references/errors.md` lists exactly the `FactaErrorCode` union. CI runs both and attaches the zip. Install guide in English and Spanish: `skills/README.md`.

### Added

- `archivoDte?: string` on sealed results: the exact UTF-8 Archivo DTE. Absent in contingency.
- `archivoDteOf(result)`: returns `archivoDte`, or builds the same bytes from `documento` + `jws` + `selloRecibido` for an API that has not deployed the field yet; `null` without a seal.
- `downloadDocument(code, "json", { raw: true })`; `raw` is rejected locally for `pdf` and `ticket`.
- Error code `not_sealed` (HTTP 409): JSON download of a document with no Hacienda seal. Use `raw: true`.
- React: optional `rawJson` prop on `FactaReceipt` and `FactaDownloadButton` adds «JSON original (raw)». Server handler: `capabilities.rawJson` (default `false`) gates `raw` in `documents.download`; the issue response includes `archivoDte` whenever downloads are allowed.
- Guides, each in English and Spanish: `archivo-dte`, `region`, `timings`, `delivery`, `idempotency`, `prepare-sign`, `return-event`, `reference-clock`, `diagnose`, `errors` (every `FactaErrorCode` with HTTP status, retry behaviour and what to do) and `browser`. Both READMEs list every guide; `test/documentation.test.ts` checks Spanish/English parity for them and that every file in `guides/` is linked from `README.md`.

### Performance: regional pinning

- The client sends `x-region` on every request so Edge Functions run next to the database (`us-west-2`) instead of near the caller: `POST /v1/dte` measured 7.2 s to 4.3 s. The region is read once from `GET /v1/status` (`region`), lazily and shared by concurrent calls; an API that does not advertise one falls back to `us-west-2` for both environments.
- New `region` option (string, or `false` to disable) in the constructor, `config.region` and `FACTA_API_REGION`. A failed discovery never fails an operation.
- New `facta.region()`, `facta.servedRegion`, `diagnose().region` / `.servedRegion` (from `x-sb-edge-region`), and optional `Status.region` / `Status.servedRegion`.
- Client code that counts requests will see one extra `GET /v1/status` before the first call; pass `region: false` to avoid it.

### Customers and products managed from the API

Needs a company whose catalog is plain text, the switch «Permitir administrar clientes y productos desde el API» (Cuenta → API) and a key with scope `catalog:write`. Guide: `guides/catalog-write.md`.

- New `createCustomer`, `updateCustomer`, `deactivateCustomer`, `createProduct`, `updateProduct`, `deactivateProduct` (types `CustomerInput`, `ProductInput`, `CatalogWriteOptions`). Create accepts `idempotencyKey`. No hard delete: `DELETE` deactivates.
- Fields use the names of the rest of the public API: customers `nombre`, `tipoDocumento`, `numDocumento`, `nrc`, `codActividad`, `direccion` (with `distrito`), `telefono`, `correo`; products `descripcion`, `tipoItem`, `precioUni`, `uniMedida`, `codigo`, `codigoBarras`, `ivaIncluido` and `tipoVenta` (`gravada` | `exenta` | `no_sujeta`, the product's VAT treatment). The stored spellings (`name`, `doc_number`, `unit_price`...) are still accepted as input and every record returned carries both spellings, whichever catalog mode was read. Lists and searches send the API's own query names (`limite`, `buscar`, `incluirInactivos`); a company with an unencrypted catalog is detected through `catalogoSinCifrar`.
- The result is the same in every catalog mode: the same fields (both spellings, `tipoVenta` / `sale_class`, full `direccion`, numbers as numbers, `activo`), also on `customerId` / `productId` resolution at issue time; only latency differs. Without `unlockKey` an encrypted catalog fails with `unauthorized` and `details.missing: "unlockKey"`.
- Fields are checked locally before sending with the server's own rules and never stricter (DUI 9 digits, NIT 14, NRC 1–8, address codes, `tipoItem` required and never defaulted); dashes in numbers are removed. A refusal is `FactaError` `validation_failed` (422) with `details.issues`.
- New error codes `catalog_write_disabled` (403), `catalog_encrypted` (409) and `catalog_duplicate` (409), with Spanish messages that say where to enable the feature (Cuenta → API, the checkbox) and that the catalog becomes readable by Facta DTE.
- Reads work in every catalog mode. The mode (`encrypted`, `readable`, `plain`) is read from `/v1/status` together with the region discovery, so there is no extra request. `encrypted` keeps decrypting the key snapshot with `unlockKey`; `readable` and `plain` read through `GET /v1/customers` and `GET /v1/products` with no `unlockKey`. `listCustomers`, `getCustomer`, `searchCustomers` and the product reads keep their signatures; they gain `includeInactive`.
- `catalogState()` and `diagnose()` report `catalogMode`; `Status.llave.catalogMode` accepts `"plain"`.
- Server handler: `capabilities.catalog: "write"` (default off) adds the six `catalog.customers|products.create|update|deactivate` actions; it requires an `authorize` function and refuses `"session-only"`.
- Live integration: a «catalog write gate» check expects `catalog_write_disabled` from the encrypted CI company; it only warns until the routes are on staging.

### Fixed

- `issueAndArchive(request, { deliver })` never sent `entrega`, so no delivery token came back and nothing was delivered. It now sends it exactly like `issue()`, journals it with the request (a recovery replays it) and returns it as `result.entrega` (also in `result.emission.entrega`).
- `FactaErrorCode` lacked `retention_mixed_class_unsupported` (HTTP 422: `aplicarReteRenta` on a document with an `exenta` or `no_sujeta` line), which the API contract lists. `test/error-codes.test.ts` now compares the contract's error enum (snapshot in `test/fixtures/openapi.yaml`) with the type.
- README example reused one idempotency key for `prepare` and `sign`; the API refuses that with `idempotency_key_reuse`. Examples use one key per step and the prepare/sign guide states the rule.
- README said the reference clock «never blocks»; archive methods wait for its first calibration (about 6 s when the service is unreachable).

### Unchanged

- `archivoJson`, `jws`, `documento`, local archives, remote replication and copy reports store and report exactly what they did before.
