# Common mistakes

Each one is documented in the SDK guides or contract; use this as a review list.

| Mistake | Consequence | Fix |
| --- | --- | --- |
| API/sign key in a browser bundle, `NEXT_PUBLIC_*`, repo or log | Anyone can issue fiscal documents as the company | Keys server-side only; browser gets a session token via `createFactaHandler` |
| No `idempotencyKey`, or a random one per attempt | Duplicate fiscal documents after a timeout | Key from a persisted business id |
| New key to "retry" after `network_error` | A second document for one sale | Replay the same key; then `getDocumentStatus` |
| Reusing the `prepare` key on `sign` | `422 idempotency_key_reuse`, nothing signed | `po:prepare` and `po:sign` |
| A changing field in the body (timestamp, price) with the same key | `idempotency_key_reuse` | Build the request deterministically from the stored order |
| Treating `contingencia` (202) as an error and re-issuing | Duplicate document | It is signed and owed to Hacienda; poll `getDocumentStatus` |
| Treating `mh_rejected` as retryable | Same rejection, or a duplicate if re-keyed blindly | Read `mhObservations`, fix data, new key; keep `error.spent` |
| Branching on `error.message` | Breaks on a wording change | Branch on `error.code` |
| Recomputing VAT/totals | Mismatch with the signed document | Display `totales` from the result |
| CCF price with VAT included (or FE price without) | Wrong totals, no error | FE `precioUni` includes VAT; 03/05/06 exclude it |
| `receptor` missing fields on 03 | `validation_failed` or `mh_rejected` (spends a number) | Complete taxpayer data or a valid `customerId` |
| Dashes in DUI/NIT | Hacienda's format check fails | Digits only (DUI 9, NIT 14) |
| `incoterms` with the description | Wrong value | Only the CAT-031 code (`"01"`–`"11"`) |
| Sending a type's own field on another type | `400` | `aplicarReteRenta` only 14, `documentosRelacionados` only 05/06, `exportacion` only 11 |
| Mixing `exenta`/`no_sujeta` lines with `aplicarReteRenta` | `422 retention_mixed_class_unsupported` | Separate documents |
| Re-serializing `documento` to archive or send | Bytes differ from what was signed | Use `jws`, `archivoJson`, `archivoDte` |
| Expecting the old JSON from `downloadDocument(code, "json")` (≥ 0.5.0) | Archivo DTE arrives instead | `{ raw: true }` for the stored original |
| `listDocuments({ include: ["dte"] })` with `limit` above 25, or on an SDK older than 0.5.0 | `include_limit_exceeded` / compile error | Ask for 25 or fewer and follow `siguiente`; check the installed `types.ts` |
| Delivery token sent to a browser, or used after 5 minutes | Leak / `entrega_vencida` | Server-only; deliver right after issuing |
| Re-issuing because e-mail/WhatsApp failed, or because storage failed | Duplicate document | Those are states/warnings; repair storage with `retryDocumentStorage` |
| `waitForDelivery` on a channel that was not marked | Waits until timeout | Wait only for marked channels |
| Calling `prepare` speculatively | Reserved numbers nobody signs | Use `issue` unless a review step exists |
| Catalog `productId` with an encrypted catalog and no `unlockKey` | Cannot resolve | Send full line data, enable a readable catalog, or provide `unlockKey` |
| Stale catalog for fiscal issuing (`allowStale`) | Not allowed for issuing | Publish the snapshot from the app |
| Turning on a plain catalog without telling the owner | Facta DTE can then read customers | Explain the privacy trade-off first |
| `diagnose().overall === "ready"` as a gate | Healthy integrations read `attention` | Gate on `canIssue` etc. |
| Leaving `debug.timings` on | Larger responses, internal names in logs | Only while investigating |
| Offering types 07/15 | Not exposed by the API | Only 01, 03, 05, 06, 11, 14 |
| Issuing with a `facta_live_` key while developing | Real fiscal documents | `expectedEnvironment: "00"` in dev; `facta_test_` keys |
| Invalidating without confirmation, or an unsealed/returned document | Irreversible / `has_return_events` | Confirm; for returned documents use more returns or a credit note |
