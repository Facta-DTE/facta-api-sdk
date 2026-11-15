# Storage, copies and the emergency safeguard

Sources: `guides/storage-adapters.md`, `guides/emergency.md`, `guides/node.md`,
`guides/diagnose.md`, `CHANGELOG.md`, contract (`storage` routes, `emitirDte`).

**A storage problem is never a reason to re-issue and never turns a sealed document
into an error.** But storing is not the end: Facta must be told (section «Confirm that
you stored it», mandatory) or it deletes its own copy on day 30.

## Which copy is which

| Layer | Lasts | Purpose | Ends when |
| --- | --- | --- | --- |
| **Holding copy** | **1 hour** | Covers sealing → durable write. `listHolding()` | It expires. |
| **Temporary encrypted copy** | **30 days** unreported; **2 days** after the report | The safety net behind `downloadDocument` and `retryDocumentStorage` | The document is marked stored; deleted on the announced date `borradoEl`. |
| **Emergency store** (`runtime.emergencyStore`) | Until you empty it | Your function saves the files when durable storage failed | **Never by itself.** It confirms nothing; you report. |

Do not mix up the one-hour holding with the 30-day temporary copy.

Three storage layers, independent of each other:

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
   `syncDestinations` when a snapshot is not published.) The optional
   header `X-Facta-Copies: deferred` trades a faster answer for `pending` receipts.
2. **Local archive (your server).** `issueAndArchive` journals before the fiscal
   request and stores the exact JSON, PDF and JWS (optionally a ticket) in an
   encrypted archive; `recoverOperation` finishes interrupted work.
3. **BYOS replication.** With an `unlockKey` and a destination snapshot published
   from the Facta app, `issueAndArchive` also replicates to those destinations at
   Facta's canonical paths and reports each copy it wrote back (a report, not a
   verification; `replicate: false` opts out). Problems are typed non-throwing warnings
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

## Confirm that you stored it (mandatory)

Facta keeps an encrypted temporary copy of every sealed document and deletes it
**2 days after the document is marked stored, or 30 days after sealing** if nobody
marks it. **Every emission needs one of these:**

1. `issueAndArchive` with a synced destination: the SDK reports the copy it wrote
   (`sdk_report`) and the document is marked. Check `result.confirmation.state ===
   "confirmed"`.
2. Facta Storage stored a verified copy (`result.storage.json.state === "stored"`):
   marked by Facta (`facta_managed`).
3. You stored it yourself (disk, database, custom adapter, local archive): call
   `confirmDocumentStorage(code, { where, bytes })` (or `sha256`) after the write
   resolved. `runtime.confirmArchive: true` does it for the local archive when that
   archive is durable (off by default).

```ts
const file = await facta.downloadDocument(code, "json");
await myStorage.put(`${code}.json`, file.bytes);
const receipt = await facta.confirmDocumentStorage(code, { where: "accounting-bucket", bytes: file.bytes });
// receipt: { por, yaConfirmado, verificado, informado, borradoEl }
```

- `where` is a short name (≤ 200 chars), never a path with secrets. The hash must be of
  the JSON bytes you stored, as `downloadDocument(code, "json")` returned them (Archivo
  DTE, or `raw: true`). For an API-issued document Facta rebuilds the file and compares
  (`verificado: true`; a mismatch is `storage_hash_mismatch`, 422, nothing recorded). For
  an app-issued document it cannot check: `informado: true`. Repeating is safe
  (`yaConfirmado`).
- Needs scope `issue`; check `capabilities.storageConfirmation` (via `getStorageStatus()`);
  without it the SDK throws `storage_unsupported` and that server deletes nothing.
- **Daily job:** `storeAndConfirmUnconfirmed({ store })` lists
  (`listUnconfirmedDocuments`, `GET /v1/storage/unconfirmed`, scope `download`, deleted-first,
  each row with `borradoEl` and `diasRestantes`), downloads JSON + PDF, calls your `store`
  (resolve only when durable; throw to skip) and confirms with the hash of what you were
  given. It is bounded, never throws for one document, and returns
  `{ listed, confirmed, failed, results[], remaining, firstDeletionAt, stopped }`. Alert on
  `failed > 0` or `stopped !== "complete"`. `getStorageStatus().sinConfirmar` is the cheap
  one-call check.
- **The owner is mailed** (Facta DTE, production `01` only, owner only, never more than one a
  day per company): day 1 with the **full table** (type, control number, emission date,
  deletion date), weekly, 7 days before, 1 day before. No document content. A document leaves
  the mails when marked. If the owner's address bounced Facta does not delete and flags it in
  the app.
- After deletion: `GET …/file` → `410 temporary_copy_expired` (unless Facta Storage has it);
  `retryDocumentStorage` → `409 nothing_to_repair_from`. Recover from your own storage.
  **Never delete your own copy before the confirmation answered.**

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
- **It does not confirm.** It protects against the one-hour holding copy; Facta does not
  learn that your function saved the files. After it, call `confirmDocumentStorage(code,
  { where, bytes: files.archivoDte ?? files.jsonRaw })` (inside the function, with
  `.catch(() => {})`, or in the runbook). `facta.emergency.replicate` reports the copies that
  reach a synced destination; if `stored` is empty, report yourself. Until then the document is
  on the unconfirmed list and in the owner's mail, and its temporary copy is deleted on day 30.
- Runbook: alert fires → check the files exist → fix storage → `facta.emergency.replicate(files, info)`
  (returns `{ stored, failed }`) → report (`confirmDocumentStorage`) if needed → only then delete your emergency copy. If `saved`
  was `false`, use the result you still hold, or `downloadDocument(code, ...)` within the hour.
