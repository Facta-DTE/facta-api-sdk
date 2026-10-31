# The temporary copy, the confirmation and the emergency store

[Spanish guide](temporary-copy.es.md) · [English README](../README.md)

Facta is not anyone's fiscal archive. The signed document has to land in storage
the company controls. Between the moment a document is sealed and the moment you
have it somewhere safe, Facta keeps encrypted copies of its own. This guide
explains exactly how long, what you must do so they can go, what the company
owner is told if you do nothing, and what the emergency store does and does not
do. Read it once; the checklist at the end is what to automate.

## The whole flow

1. **Issue.** `issue()` (or `issueAndArchive()`) returns the sealed document.
   Facta now holds a **one-hour holding copy** and a **temporary encrypted
   copy**. Neither is your archive.
2. **Store.** You write the JSON (and the PDF) somewhere you own: a destination
   synced from the Facta app (S3 and compatible, Supabase Storage), the local
   `FileInvoiceArchive`, your own disk or database. If that fails, the
   [emergency store](emergency.md) keeps the files while you fix it.
3. **Report.** Storing is not enough, because Facta cannot see your disk. Tell
   Facta with `confirmDocumentStorage()` (`POST
   /v1/dte/{codigoGeneracion}/storage-confirmation`). When `issueAndArchive()`
   replicated to a synced destination, the SDK already reported that copy and
   there is nothing more to do. When Facta itself stored a verified copy (Facta
   Storage), the document is marked on its own.
4. **If nobody reports,** the company owner is mailed from day one with the full
   table of what will be deleted and when, and `listUnconfirmedDocuments()` (`GET
   /v1/storage/unconfirmed`) lists the same documents with their deletion dates.
5. **Delete.** Facta deletes the temporary copy **2 days after the document is
   marked as stored**, or **30 days after sealing** if it never was. That is the
   date the list and the mails announce. Afterwards `GET
   /v1/dte/{codigoGeneracion}/file` answers `410 temporary_copy_expired` unless
   Facta Storage has the file.

A `200` from `issue()` therefore does **not** mean the document is stored. The
fiscal result is final; the files are yours to keep.

## The three layers

| Layer | How long | What it is for | Who creates it | How it stops mattering |
| --- | --- | --- | --- | --- |
| **Holding copy** | **1 hour** | Covers the gap between sealing and the write to durable storage. `listHolding()` shows it. | Facta, at sealing | It expires by itself. |
| **Temporary encrypted copy** | **30 days** unreported, **2 days** after the report | The safety net behind `downloadDocument()` and `retryDocumentStorage()`. | Facta, at sealing | The document is marked as stored; it is deleted on the announced date. |
| **Emergency store** (`runtime.emergencyStore`) | Until you empty it | Your function saves the files when durable storage failed. | The SDK calls your function | **It confirms nothing by itself.** You report afterwards. |

The holding copy and the temporary copy are easy to confuse. The first is a
short window; the second is the real 30-day deadline.

## Report that you stored it

Give the SHA-256 of the JSON bytes you stored (the file `downloadDocument(code,
"json")` returned), or the bytes themselves and the SDK hashes them:

```ts
const file = await facta.downloadDocument(code, "json");
await myStorage.put(`${code}.json`, file.bytes); // your disk, bucket or database

const receipt = await facta.confirmDocumentStorage(code, {
  where: "accounting-bucket", // a short name; never a path with secrets
  bytes: file.bytes,
});
// receipt.por          first source that marked it: api_report, sdk_report, facta_managed...
// receipt.verificado   true only if Facta could rebuild the file and the hash matched
// receipt.informado    true when Facta could not check your claim
// receipt.borradoEl    when the temporary copy is deleted
```

What Facta can check depends on who issued the document. For a document issued
by the API, Facta rebuilds the JSON and compares: a wrong hash is
`storage_hash_mismatch` (HTTP 422) and nothing is recorded. For a document issued
from the app, the copy is encrypted with a key no server holds, so Facta accepts
your report as a claim (`informado: true`), never as verified. Reporting twice is
safe (`yaConfirmado: true`; the first source is kept). Check
`capabilities.storageConfirmation` on `getStorageStatus()` first on a server you
do not control: without it the SDK throws `storage_unsupported` and nothing is
deleted by Facta.

The same call over plain HTTP:

```sh
curl -X POST "$FACTA_API_BASE_URL/v1/dte/$CODE/storage-confirmation" \
  -H "X-Facta-Key: $FACTA_API_KEY" -H "Content-Type: application/json" \
  -d "{\"donde\": \"accounting-bucket\", \"sha256\": \"$SHA256\"}"
```

## Drain the list every day

`storeAndConfirmUnconfirmed()` does the whole round for you: list, download JSON
and PDF, hand them to your function, confirm with the hash of exactly what you
were given. It is bounded, never throws for a single bad document, and is safe to
run daily.

```ts
const report = await facta.storeAndConfirmUnconfirmed({
  where: "accounting-bucket",
  store: async ({ codigoGeneracion, json, pdf }) => {
    await myStorage.put(`${codigoGeneracion}.json`, json);
    if (pdf) await myStorage.put(`${codigoGeneracion}.pdf`, pdf);
    // Resolve only when the files are durably there. Throw to leave it unconfirmed.
  },
});
if (report.failed > 0 || report.stopped !== "complete") {
  alertYourTeam(report); // report.results[].step / code say what failed; report.firstDeletionAt is the deadline
}
```

A failed document stays on the list and in the owner's mail; the run goes on with
the next one. It stops early on `maxFailures`, your `signal`, an error that
affects every document (a revoked key, a server without the capability), or its
`limit`. Run it from a daily job, and also look at `getStorageStatus().sinConfirmar`
(`{ total, primeroSeBorraEl }`) for a one-call summary.

## What the company owner receives

From the first day a document is unconfirmed (24 hours after sealing) the owner
gets a mail from Facta DTE with the **complete table**: type, control number,
emission date and deletion date of every pending document, plus the total. After
that: weekly, 7 days before the first deletion and 1 day before. Never more than
one mail a day per company, nothing in it but the table (no document content, no
receiver data), and only in production (`01`); test-environment companies see the
same information in the app. A document leaves the mails when it is marked as
stored. If the owner's address bounced, Facta does not delete those documents and
flags the problem in the app, because nobody was warned.

## The emergency store saves, it does not confirm

`runtime.emergencyStore` protects against the **one-hour holding copy**: when the
server could not store the document durably, or every replication failed, your
function receives the files so they are not lost. Facta does not learn that you
saved them. After it, report:

```ts
const facta: Facta = new Facta({
  apiKey, signKey,
  runtime: {
    version: 1,
    emergencyStore: async (files, info) => {
      await emergencyDisk.write(info.codigoGeneracion, files); // throw if you could not
      // Saved is not reported: tell Facta, and never let a failure here undo the save.
      await facta.confirmDocumentStorage(info.codigoGeneracion, {
        where: "emergency-disk",
        bytes: files.archivoDte ?? files.jsonRaw, // exactly what you wrote
      }).catch(() => {});
    },
  },
});
// Once storage works again: facta.emergency.replicate(files, info). A copy that reaches a synced
// destination is reported by the SDK; if `stored` is empty, call confirmDocumentStorage yourself.
```

Until one of those reports arrives the document stays on the unconfirmed list and
in the owner's mail, and Facta deletes its temporary copy on day 30.

## Let `issueAndArchive` report for you

`issueAndArchive()` already reports every copy it writes to a synced destination.
It can also report the local archive, but only when you say so, because only you
know whether that archive is durable (a backed-up disk, not a temporary folder):

```ts
const facta = new Facta({
  apiKey, signKey, unlockKey,
  runtime: { version: 1, archive, confirmArchive: true }, // or per call: { confirmArchive: true }
});
const out = await facta.issueAndArchive(request, { operationId, idempotencyKey });
out.confirmation; // { state: "confirmed", by } | { state: "pending", detail } | { state: "failed" } | { state: "unsupported" }
```

`pending` is not a warning: it is the default when nothing reported the document.
`failed` adds the warning `confirmation_failed`; the sealed document is never
affected.

## Errors and old servers

- `temporary_copy_expired` (410): the copy is gone. Look in your own storage.
- `nothing_to_repair_from` (409): `retryDocumentStorage()` has nothing left to
  rewrite from.
- `storage_hash_mismatch` (422): the hash is not the document's. Download again
  and hash the bytes you stored.
- `storage_unsupported`: the server predates the rule (it deletes nothing) or
  does not expose the route.

Checklist: store every document; report it (or let the SDK); run
`storeAndConfirmUnconfirmed()` daily; never delete your own copy before the
report answers; give the emergency store a follow-up report.
