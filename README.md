# `@facta-dte/api` — TypeScript SDK

The official TypeScript and JavaScript client for Facta's electronic tax document API. It uses the server as the fiscal authority: the SDK sends DTE data, handles credentials and retries, resolves encrypted local catalog snapshots, and can archive exact issued bytes for restart-safe recovery.

Read the [Spanish README](README.es.md). The full [method reference](guides/reference.md) documents each public method's arguments, return value, required scope, side effects, errors, retries, and recovery behavior. The [published API contract](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json) remains authoritative for HTTP fields and responses.

> **Publication status:** `@facta-dte/api` has not been published to npm. This repository contains the standalone SDK source; do not infer a registry release from the GitHub repository or README.

> **License:** MIT. See [LICENSE](LICENSE).

## Runtime support

The SDK root entry works in Node.js 22+, Deno, and Bun and does not eagerly import filesystem modules. The `@facta-dte/api/node` entry adds Node-only encrypted file archives and config-file loading. The dedicated `@facta-dte/api/file-archive` entry is also Node-only.

The portable client relies on standard `fetch`, Web Crypto, `AbortSignal`, and `crypto.randomUUID`. Every request uses the configured API endpoint; a `facta_test_` key selects Hacienda's test environment at that same endpoint. There is no separate staging API URL.

## Quick start

```ts
import { Facta, type DteRequest } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
});

const sale: DteRequest = {
  tipoDte: "01",
  items: [{ descripcion: "Sample item", cantidad: 1, precioUni: 10 }],
};
const result = await facta.issue(sale, { idempotencyKey: "order-1042" });
```

`tipoDte`, `codigoGeneracion`, and all other fiscal wire fields keep the names and values defined by the Facta API. Public TypeScript identifiers are English; fiscal payload properties are not translated.

An `IssueResult` is a discriminated union. Check `result.estado`: `"sellado"` means Hacienda returned a seal; `"contingencia"` means Facta accepted and signed the DTE but needs reconciliation. Do not submit the sale with a new idempotency key after an uncertain response.

## Credentials and configuration

| Option | Purpose |
| --- | --- |
| `apiKey` | Required `facta_test_…` or `facta_live_…` key. The key selects the Hacienda environment. |
| `signKey` | Required for `issue`, `prepare` + `sign`, and `invalidate`. Sent only on signing operations. |
| `unlockKey` | Optional `factauk_…` key used locally to decrypt synchronized catalog and destination bundles. Never sent to the API. |
| `baseUrl` | Optional API host. Defaults to Facta's public API URL. |
| `timeoutMs` | Request timeout, default 60,000 ms, including response-body reading. |
| `maxRetries` | Retry limit for explicitly retryable transport/service failures; defaults to 3. |
| `fetch` | Optional fetch implementation for an owning runtime or tests. |
| `config` | Optional versioned scalar configuration (`FactaConfigV1`). |
| `runtime` | Optional default archive, invalidation archive, remote destinations, and print transport (`FactaRuntimeConfigV1`). |

Configuration values do not include credentials. Flat legacy options override matching versioned config values. See the [Node guide](guides/node.md) or [Deno guide](guides/deno.md) for runtime setup and environment permissions.

## Public client surface

The `Facta` client exposes the following English methods:

- **Status and diagnostics:** `status`, `diagnose`, `getContract`.
- **Synchronization and catalog:** `syncDestinations`, `syncCatalog`, `catalogState`, `listCustomers`, `getCustomer`, `searchCustomers`, `listProducts`, `getProduct`, `searchProducts`.
- **DTE lifecycle:** `issue`, `prepare`, `sign`, `getDocumentStatus`, `listDocuments`, `invalidate`, `listHolding`, `downloadDocument`.
- **Durable archival:** `issueAndArchive`, `recoverOperation`, `listPendingOperations`, `invalidateAndArchive`, `recoverInvalidation`, `listPendingInvalidations`, `replicateArchive`, `diagnoseDestinations`.
- **Local printing:** `print`.

The full [method reference](guides/reference.md) describes every method's inputs, return type, credential scope, network/local effects, errors, and retry or recovery behavior.

## Safe issuance and recovery

Every operation that can reserve a fiscal control number needs a stable `idempotencyKey`. Reuse the same key with the same request after a timeout; a changed request with that key is rejected. `AbortSignal` stops local waiting/retries but cannot prove that a request already accepted by the server was cancelled.

For applications that must survive a process restart, use `issueAndArchive` with a durable archive, `operationId`, and `idempotencyKey`:

```ts
import { Facta, type DteRequest } from "@facta-dte/api";
import { FileInvoiceArchive } from "@facta-dte/api/node";

const archive = await FileInvoiceArchive.open({
  directory: "./private-invoices",
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!,
});
const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  runtime: { archive },
});

const sale: DteRequest = {
  tipoDte: "01",
  items: [{ descripcion: "Sample item", cantidad: 1, precioUni: 10 }],
};
const result = await facta.issueAndArchive(sale, {
  includeTicket: false,
  operationId: "order-1042",
  idempotencyKey: "order-1042",
});
if (result.archive.state !== "complete") {
  // Fiscal success and archival status are separate. Keep the operation ID.
  await facta.recoverOperation("order-1042");
}
```

`issueAndArchive` stores the immutable resolved request and operation identity before the fiscal request. It archives the exact signed JSON and PDF returned by the server, derives the JWS from that JSON, and optionally requests a receipt ticket PDF only from APIs that support it. The current public API requires `includeTicket: false`; its ticket download route currently returns JSON. Recovery verifies endpoint, API key identity, issuer, and environment before any fiscal request. Legacy journals without that identity remain inspectable but cannot be replayed automatically.

An archive is sensitive data. `FileInvoiceArchive` uses authenticated encryption and restrictive local file permissions; its passphrase must be independent from API, signing, and vault credentials. Keep backups and retention under the application's control. Read [storage adapters](guides/storage-adapters.md) for remote-copy adapters and reconciliation.

## Separate preparation and signing

Use `prepare` and `sign` only when a human or approval system must review the canonical document before signing:

```ts
const prepared = await facta.prepare(sale, { idempotencyKey: "order-1042" });
// Review prepared.documento and prepared.totales without changing them.
const result = await facta.sign(prepared, { idempotencyKey: "order-1042" });
```

Preparation reserves a control number. The prepared document and token must be passed unchanged to `sign`; an edited document is rejected. `prepare` does not use `signKey`, while `sign` does. See the [prepare/sign guide](guides/node.md).

## DTE types and fiscal payloads

The exported TypeScript types include `DteRequest`, `IssueResult`, `PreparedDte`, `DocumentStatus`, `InvalidationRequest`, `InvalidationResult`, `DteType`, `Recipient`, `Address`, `LineItem`, `Totals`, and `DtePage`. DTE request types form a union keyed by the unchanged `tipoDte` field, covering `"01"`, `"03"`, `"05"`, `"06"`, `"11"`, and `"14"`.

The type system helps construct payloads but does not replace server-side tax validation. The SDK has no local VAT engine and does not infer fiscal totals. For a catalog-backed price, the item's VAT basis must match the DTE type; provide an explicit `precioUni` in the document's expected basis to override the catalog price.

## Catalog and destination snapshots

`syncCatalog()` and `syncDestinations()` decrypt their respective published snapshots in memory using `unlockKey`. They do not create or update server records and do not write artifacts to storage destinations. Catalog-backed customer/product lookup uses only a fresh snapshot for fiscal issuance; stale opt-in is limited to non-fiscal reads.

- [Catalog snapshots and offline reads](guides/catalog.md)
- [Storage adapters](guides/storage-adapters.md)
- [Node integration](guides/node.md)
- [Deno integration](guides/deno.md)

The SDK does not send WhatsApp messages. It does not sign locally, choose a signing certificate, or replace the API's fiscal contract.

## Errors

Authenticated API failures use `FactaError`, with a stable `code`, HTTP `status`, safe `details`, `isRejection`, and optional `spent` control-number information. Branch on `code`, not localized message text. Local validation may throw `TypeError` or `RangeError`; archive and storage adapters can throw their own typed errors. Credential-like values are redacted from API error details.

Retry only the same request with the same idempotency key. `operation_outcome_unknown` and archive integrity failures require inspection or reconciliation; they do not authorize issuing a replacement DTE. The [method reference](guides/reference.md) includes outcomes and recovery guidance for each public operation.

## Examples and checks

Typed examples live in [`examples/`](examples/dte-types.ts). The package's test suite uses Deno. `pack:check` builds the Node ESM bundles and declarations, packs the package in a temporary directory, then checks fresh Node and Deno consumers against the packed output.

```sh
pnpm test
pnpm pack:check
```

## Documentation language

The repository keeps the Spanish documentation at [`README.es.md`](README.es.md), alongside the English guides in the [method reference](guides/reference.md) and guides. Each guide links to its Spanish counterpart.
