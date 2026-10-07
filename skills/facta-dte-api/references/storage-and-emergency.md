# Storage, copies and the emergency safeguard

Sources: `guides/storage-adapters.md`, `guides/emergency.md`, `guides/node.md`,
`guides/diagnose.md`, `CHANGELOG.md`, contract (`storage` routes, `emitirDte`).

Three layers, independent of each other. **A storage problem is never a reason to
re-issue and never turns a sealed document into an error.**

1. **Managed storage at Facta.** Automatic. After sealing, the server writes the
   JSON and PDF and reports a receipt in `result.storage` (`json` / `pdf` with
   `state`: `stored | pending | failed | not_configured | unsupported`). Tickets and
   invalidation events are not covered. Check readiness with
   `facta.getStorageStatus()` (scope `download`; older servers → `storage_unsupported`),
   list receipts with `getDocumentCopies({ generationCode })`, and repair with
   `retryDocumentStorage(code)` (scopes `download` + `issue`; repairs stored bytes of
   an already sealed document, never issues).
   Per the current contract, issuance **no longer fails** when no durable storage is
   available: the document is issued and the response carries the warning
   `sin_almacenamiento_duradero`. (`no_storage_destination` is still thrown locally by
   `syncDestinations` / `syncCatalog` when a snapshot is not published.) The optional
   header `X-Facta-Copies: deferred` trades a faster answer for `pending` receipts.
2. **Local archive (your server).** `issueAndArchive` journals before the fiscal
   request and stores the exact JSON, PDF and JWS (optionally a ticket) in an
   encrypted archive; `recoverOperation` finishes interrupted work.
3. **BYOS replication.** With an `unlockKey` and a destination snapshot published
   from the Facta app, `issueAndArchive` also replicates to those destinations at
   Facta's canonical paths and reports each verified copy back
   (`replicate: false` opts out). Problems are typed non-throwing warnings
   (`byos_not_replicated`, `copy_report_failed`).

```ts
import { Facta } from "@facta-dte/api";
import { FileInvoiceArchive } from "@facta-dte/api/node";

const archive = await FileInvoiceArchive.open({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!, // independent from every Facta key
});
const facta = new Facta({ apiKey, signKey, runtime: { version: 1, archive } });
const out = await facta.issueAndArchive(request, { operationId: `sale:${id}`, idempotencyKey: `sale:${id}`, includeTicket: false });
if (out.archive.state !== "complete") await facta.recoverOperation(`sale:${id}`); // fiscal success and archive state are separate
```

- The archive is sensitive data (authenticated encryption, restrictive file
  permissions). Network filesystems are unsupported; never hand-edit its files; keep
  a full backup before opening it with a newer SDK (`archive_integrity_error`).
- A stale lock is released only with `FileInvoiceArchive.releaseStaleLock({ directory,
  confirmNoConcurrentWriters: true })`, after stopping every writer.
- `listPendingOperations()` / `recoverOperation(op.id)` in a startup job.

## BYOS adapters (your own bucket or drive)

Shipped adapters: `createS3ArtifactDestination` (AWS S3 and compatible: R2, B2,
Wasabi, Spaces, MinIO; needs conditional create), `createSupabaseArtifactDestination`,
`createGoogleDriveArtifactDestination` (one writer process per destination),
`createOneDriveArtifactDestination`, `createBridgeArtifactDestination` (FTP/SFTP via a
local `facta-bridge`), and `createStorageArtifactDestination` to wrap any `put/get`
client. Rules: deterministic paths; identical bytes safe to repeat; never overwrite
different bytes (the result is `unknown` for an operator); classify only the exact
provider "not found" as missing; keep the bucket private; credentials from
`syncDestinations()` stay in memory and out of logs and the archive.
`diagnoseDestinations(operationId, archive, destinations)` is a read-only check.

## Emergency safeguard (`runtime.emergencyStore`)

Facta keeps every sealed document in a one-hour holding copy while it is written to
durable storage. If the server could not store it durably, or every replication
failed, that copy is the only one. `emergencyStore` is **your optional function**,
called once per `codigoGeneracion` only then (warnings `sin_almacenamiento_duradero`,
`sin_copia_en_servidor`, `copia_solo_temporal`, any `sin_*` / `*temporal*` code, all
destinations failed, or `issueAndArchive` found no destination). The SDK ships no
storage for it and sends the bytes nowhere else.

```ts
const facta = new Facta({
  apiKey, signKey,
  runtime: {
    version: 1,
    emergencyStore: async (files, info) => {
      // files: { archivoDte?: string, jsonRaw: string, pdf: Uint8Array | null }
      // info:  { codigoGeneracion, numeroControl, tipoDte, ambiente, fecEmi, reason, warnings, occurredAt }
      await saveSomewhereYouOwn(files, info); // throw if you could not
    },
    onEmergency: ({ info, report }) => alertYourTeam(info, report), // optional
  },
});
```

- Results carry `emergency: { saved, reason, trigger, detail }` and, when it ran,
  an `sdkWarnings` entry `emergency_saved` / `emergency_failed`. Not configured:
  `reason: "not_configured"` (no warning; `diagnose()` lists it as information);
  your function threw: `"store_failed"`. Neither hides the sealed result.
- Without it the server e-mails the company owner a backup copy when nothing could
  be stored.
- Runbook: alert fires → check the files exist → fix storage → `facta.emergency.replicate(files, info)`
  (returns `{ stored, failed }`) → only then delete your emergency copy. If `saved`
  was `false`, use the result you still hold, or `downloadDocument(code, ...)` within the hour.
