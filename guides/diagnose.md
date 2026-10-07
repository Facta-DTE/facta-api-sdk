# Diagnostics

[Spanish guide](diagnose.es.md) · [English README](../README.md) · [Method reference](reference.md)

Before an integration issues its first document (and in a health check after
that) you want to know: is the key valid, in the right environment, with the
right scopes, able to sign, with somewhere to store documents? `diagnose()`
answers those questions from public status data, without opening a vault and
without reserving a control number. Two smaller tools complement it:
`catalogState()` for the catalog and `diagnoseDestinations()` for remote copies.

## `diagnose(options?)`

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  config: { version: 1, expectedEnvironment: "00", requiredScopes: ["issue", "query", "download"] },
});

const report = await facta.diagnose({ dteType: "03" });
if (!report.canIssue) {
  for (const check of report.checks) {
    if (check.state === "blocked") console.error(check.id, check.message);
  }
}
```

`DiagnoseOptions` (all optional):

| Option | Effect |
| --- | --- |
| `archive` | An `InvoiceArchive` to test for read/write and count pending operations. Defaults to `runtime.archive`. |
| `dteType` | Confirm the key may issue this `tipoDte`. |
| `expectedEnvironment` | `"00"` or `"01"`; a mismatch blocks issuance. Defaults to `config.expectedEnvironment`. |
| `requiredScopes` | Scopes your integration needs; each missing one blocks issuance. Defaults to `config.requiredScopes`. |

It makes `GET /v1/status` and `GET /v1/storage/status` (plus the one-time
region discovery). If status cannot be read it does **not** throw: it returns a
`blocked` report with a single `api` check naming the error code.

## The report

`DiagnosticsReport`:

| Field | Meaning |
| --- | --- |
| `overall` | `"blocked"` when issuance is not possible; `"attention"` when any check is `warning` or `unknown`; otherwise `"ready"`. |
| `canIssue`, `canQuery`, `canDownload` | What this key can do now. |
| `canIssueAndArchive` | `canIssue` and the archive check passed. |
| `storageReady` | Managed storage or a verified BYOS destination is ready; `null` when the server does not say. |
| `pendingArchiveOperations` | Count from the archive, or `null` without one. |
| `catalogMode` | `encrypted`, `readable`, `plain` or `null`. |
| `region`, `servedRegion` | See [region.md](region.md). |
| `revisions` (`DiagnosticRevisions`) | Public `sign`, `destinations` and `catalog` revisions (`SyncRevision`), or `null`. |
| `checks` (`DiagnosticCheck[]`) | `{ id, state, message }`; `state` is a `DiagnosticState`: `ok`, `warning`, `blocked` or `unknown`. |

`overall` is strict: a production key always adds an `environment` warning, and
a missing archive adds `unknown` checks, so many healthy integrations read
`"attention"`. **Decide with `canIssue` / `canQuery` / `canDownload`**, and use
`overall` and the messages for humans. A query-only key reads `overall:
"blocked"` because it cannot issue, while `canQuery` is `true`.

## The checks

| `id` | What it checks |
| --- | --- |
| `api` | `/v1/status` answered `ok`. |
| `issuer`, `issuer-environment` | The key has an issuing company, in the key's environment. |
| `scope-issue`, `scope-query`, `scope-download` | The key's scopes. |
| `configured-scope-<scope>` | Each scope from `requiredScopes`. |
| `configured-environment` | `expectedEnvironment`, when set. |
| `environment` | `ok` for `00`; `warning` for production, as a reminder. |
| `issue-quota` | Hourly/daily windows: blocked at zero, warning under 10 %. |
| `key-expiry` | Blocked when expired, warning within 72 hours. |
| `dte-type` | Only with `dteType`. |
| `certificate-metadata`, `certificate-identity`, `certificate-environment`, `certificate-validity` | Public certificate facts: fingerprint, NIT matches the issuer, registered environment, validity (warning within 30 days). |
| `signing`, `sign-sync` | A signing vault is provisioned and synchronized. |
| `destinations-sync` | BYOS destination snapshot synchronized (optional when managed storage is ready). |
| `catalog-sync` | Catalog snapshot synchronized; only ever `ok` or `warning`. |
| `managed-storage` | Managed storage or a verified BYOS destination is ready; `unknown` when the server or key does not expose it. |
| `archive`, `archive-pending` | With an archive: it can read and write, and how many operations are pending. |
| `emergency-store` | Informational: whether `runtime.emergencyStore` is configured. Always `ok` and never changes `overall`. |

Messages are English prose for logs and may change; switch on `id` and `state`.

## `catalogState()`

`catalogState()` compares the local catalog snapshot with what the server
publishes, without returning any catalog content:

```ts
const catalog = await facta.catalogState();
// { catalogMode, freshness: "fresh" | "stale" | "missing", localRevision, fetchedAt,
//   desiredRevision, publishedRevision, syncStatus, statusError }
if (catalog.catalogMode === "encrypted" && catalog.freshness !== "fresh") await facta.syncCatalog();
```

A `plain` catalog is read live from the API and always reports `fresh`. When
status cannot be read, `statusError` carries a safe error code and the call does
not throw. See [catalog.md](catalog.md).

## `diagnoseDestinations(operationId, archive, destinations, options?)`

A read-only check of the remote copies of one **completed** archived operation.
For each destination and artifact (`json`, `pdf`, `jws`, plus `ticket` when one
was archived, or the kinds in `options.artifacts`) it reports `stored` (matching
bytes, readable), `missing`, `unknown` (the check failed) or `unsupported` (the
adapter has no `check`). It writes nothing, so it does not prove write
permission.

```ts
const probe = await facta.diagnoseDestinations("sale:1042", archive, destinations);
for (const r of probe.results) console.log(r.label, r.artifact, r.state);
```

## What can go wrong

- **`overall: "attention"` on a healthy production integration**: expected (the
  `environment` warning). Use the `can*` booleans.
- **`managed-storage` blocked**: neither managed storage nor a verified BYOS
  destination is ready; issuance is likely to fail with `no_storage_destination`.
- **`signing` blocked**: the key has no signing vault; re-mint it from the Facta
  app (`sign_vault_missing` at issue time).
- **`configured-environment` blocked**: a `facta_live_` key where you expected
  `00`, or the reverse.
- **`diagnoseDestinations` throws**: the operation is not complete locally, a
  local artifact is missing or fails its SHA-256 check, or destination ids are
  not unique.

## Related

- [Emergency safeguard](emergency.md) · [Regional pinning](region.md)
- [Storage adapters](storage-adapters.md) · [Error catalogue](errors.md)
- [Method reference](reference.md)
