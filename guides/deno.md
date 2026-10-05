# Deno integration guide

For exact public method signatures, scopes, defaults, side effects, and
recovery behavior, see the [SDK method reference](reference.md). Read the
[Spanish guide](deno.es.md) for the Spanish version.

**Package and source:** [npm `@facta-dte/api`](https://www.npmjs.com/package/@facta-dte/api) · [public GitHub repository](https://github.com/Facta-DTE/facta-api-sdk).

**Version selection:** This documentation describes `0.2.1`. The [npm registry](https://www.npmjs.com/package/@facta-dte/api?activeTab=versions) is authoritative for published versions and distribution tags. `latest` selects the approved stable release. Confirm that your installed published version includes a method before using it; validate source-only capabilities with a packed checkout.

The official package supports TypeScript and JavaScript. SDKs for other languages are pending; direct HTTP examples do not represent published SDKs.

## Requirements and installation

Check `npm view @facta-dte/api version dist-tags` and choose a published version
that matches the required capabilities. Once `0.2.1` is available, pin it in
`deno.json`:

```json
{ "imports": { "@facta-dte/api": "npm:@facta-dte/api@0.2.1" } }
```

There is no JSR package. Commit the selected version and lockfile.


- Deno 2.6.6.
- A test key `facta_test_…` with `issue`, `query`, or `download` scopes,
  depending on the operation.
- `FACTA_SIGN_KEY` for signing. `FACTA_UNLOCK_KEY` is only for opening
  destination/catalog snapshots locally.

Use `.env.example` as a names-only checklist for an external secret manager;
the SDK and Deno do not load that file automatically.

During checkout development, import from `../mod.ts`. The compiled package
keeps the same API and is the artifact intended for installation after release.
The release verification commands are:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm pack:check
```

Pin the selected published version in `deno.json` and commit its lockfile.
Validate capabilities absent from that release with `pnpm pack:check`; do not
point an application at methods its installed package does not provide.

## Minimum permissions

A simple issuance needs network access and read access to selected environment
variables, but no filesystem permission:

```sh
deno run \
  --allow-net=hcnvknpsbadplnfcflxx.supabase.co \
  --allow-env=FACTA_API_KEY,FACTA_SIGN_KEY,ERP_ORDER_ID \
  main.ts
```

For controlled environments, set `FACTA_API_BASE_URL` to change the base URL.
If you do, restrict `--allow-net` to the selected hostname. Deno prompts for
permissions that were not granted; declare only the required permissions in
the production command or config. Do not use `-A` for a deployed integration.
Staging checks configure the staging API URL explicitly and use only a
`facta_test_` key. Examples do not issue during import; a test issue consumes
a test-environment fiscal sequence. The staging base URL is
`https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1`; add its host to
`--allow-net` when using Deno.

## Client and a test invoice

```ts
// Importing the module is inert. Call main() only when you intend a test issue.
import { main } from "../examples/hola-factura.ts";
await main();
```

Set the API base URL to the staging endpoint and use only `facta_test_` keys;
this explicit call consumes a test fiscal sequence and needs a stable
`ERP_ORDER_ID`.

```ts
import { Facta } from "npm:@facta-dte/api@0.2.1";

const facta = new Facta({
  apiKey: Deno.env.get("FACTA_API_KEY")!,
  signKey: Deno.env.get("FACTA_SIGN_KEY")!,
  timeoutMs: 60_000,
  maxRetries: 3,
});

const result = await facta.issue({
  tipoDte: "01",
  items: [{ descripcion: "Deno sample", cantidad: 1, precioUni: 1 }],
}, { idempotencyKey: Deno.env.get("ERP_ORDER_ID")! });

console.log(result.estado, result.codigoGeneracion, result.numeroControl);
if (result.estado === "sellado") {
  console.log(result.storage?.json.state, result.storage?.pdf.state);
}
```

The `01` example is a final-consumer invoice without a customer record. For a
CCF (`03`), provide the required recipient inline or use a `customerId` already
in that key’s snapshot. Inline data needs no catalog unlock key and does not
create or update customer records. Reuse the same idempotency key when retrying
the same sale.

If `result.estado` is `contingencia`, the document was signed, but the MH did
not return a seal in that exchange. Save `codigoGeneracion` and check the
result later; do not issue another invoice with a new key.

## Catalog and vaults

When syncing from the web app, the key owner publishes an encrypted snapshot.
To read it from Deno, grant access to `FACTA_UNLOCK_KEY` and set `unlockKey`:

```ts
const facta = new Facta({
  apiKey: Deno.env.get("FACTA_API_KEY")!,
  signKey: Deno.env.get("FACTA_SIGN_KEY")!,
  unlockKey: Deno.env.get("FACTA_UNLOCK_KEY")!,
});

await facta.syncCatalog();
const customers = await facta.listCustomers();
const products = await facta.listProducts();
```

The unlock key is never sent over HTTP. Later catalog reads compare the
snapshot revision with `/v1/status`; if it changed, the SDK downloads and opens
the new snapshot. The SDK keeps the snapshot in memory only. New customers
imported from CSV appear in a later snapshot according to the key’s selection;
the API/SDK does not write to the catalog.

Before reserving a control number, `diagnose()` also checks the associated
certificate’s public status. It uses only the fingerprint, validity, NIT, and
environment registered by the web app; it never downloads or opens the signing
vault. An expired certificate or NIT mismatch blocks `canIssue`. An environment
mismatch is advisory because the registry records the upload slot as context.
Older keys without certificate metadata remain usable and show this check as
unknown.

## Managed storage readiness and repair

After the server deploys capability version 1, check readiness and copy
receipts for the key's issuer and environment:

```ts
const storage = await facta.getStorageStatus();
if (!storage.managed.ready && !storage.byos.ready) {
  throw new Error("No durable server-side destination is ready");
}

const copies = await facta.getDocumentCopies({ generationCode });
if (copies.some((copy) => copy.state !== "stored")) {
  const receipt = await facta.retryDocumentStorage(generationCode);
  // Repairs the already sealed DTE. This call cannot issue another DTE.
  console.log(receipt.json.state, receipt.pdf.state);
}
```

Managed-only companies need no bucket credentials in the SDK. Facta's API
derives tenant and environment from the key and uses its authenticated internal
Worker contract. Managed storage, a local encrypted archive, and BYOS copies
have separate outcomes. An older server returns `storage_unsupported`;
diagnostics report it as unknown. Managed storage covers JSON/PDF, not tickets
or invalidation events.

## Download and archive artifacts

JSON and PDF are separate byte artifacts; the SDK does not reconstruct or
print the PDF:

```ts
const invoice = await facta.getDocumentStatus(result.codigoGeneracion);
const pdf = await facta.downloadDocument(invoice.codigoGeneracion, "pdf");
await Deno.mkdir("./invoices", { recursive: true });
await Deno.writeFile(
  `./invoices/${invoice.codigoGeneracion}.pdf`,
  pdf.bytes,
  { create: true },
);
```

For `Deno.writeFile`, grant write access only to the output directory:

```sh
deno run \
  --allow-net=hcnvknpsbadplnfcflxx.supabase.co \
  --allow-env=FACTA_API_KEY,FACTA_SIGN_KEY \
  --allow-write=./invoices \
  main.ts
```

For encrypted retention of JSON, PDF, JWS, and ticket artifacts, and recovery
between restarts, import `FileInvoiceArchive` from
`npm:@facta-dte/api/file-archive` from the published package; pin the selected package version. This adapter uses
`node:fs/promises` compatibility; grant `--allow-read` and `--allow-write` only
for the archive directory. Its passphrase should be random, stored in a
separate secret manager, and different from `FACTA_UNLOCK_KEY`. Writers are
serialized across processes on supported local filesystems; network filesystems
are unsupported. Locks are never stolen automatically. After stopping every
writer, recover an abandoned lock with
`FileInvoiceArchive.releaseStaleLock({ directory, confirmNoConcurrentWriters: true })`.

The archive directory has root `formatVersion: 1`. Invoice and invalidation
journals written by this SDK use additive `schemaVersion: 1`; existing v1
journals without that field remain readable and are rewritten in v1 on their
next mutation. An unknown journal version fails closed with
`archive_integrity_error`; preserve a backup of the full directory before
trying to open it with a newer SDK. Do not delete or hand-edit encrypted files
to recover from a version error.

Create the archive once per process and use it before a production issuance so
readiness and journal writes happen before a control number is reserved:

```ts
import { FileInvoiceArchive } from "npm:@facta-dte/api/file-archive";

const archive = await FileInvoiceArchive.open({
  directory: Deno.env.get("FACTA_ARCHIVE_DIRECTORY")!,
  passphrase: Deno.env.get("FACTA_ARCHIVE_PASSPHRASE")!,
});

const issued = await facta.issueAndArchive(request, {
  includeTicket: false,
  archive,
  operationId: erpOrderId,
  idempotencyKey: erpOrderId,
});
```

Invalidation is also journaled before it is sent. After a process restart,
reuse the journal and recover every pending operation with its original key:

```ts
const generationCode = result.codigoGeneracion;
const generationCode = result.codigoGeneracion;
const invalidation = await facta.invalidateAndArchive(generationCode, request, {
  archive,
  operationId: erpCancellationId,
  idempotencyKey: erpCancellationId,
});

for (const operation of await facta.listPendingInvalidations(archive)) {
  await facta.recoverInvalidation(operation.id, archive);
}
```

If recovery returns `operation_outcome_unknown`, reconcile fiscal status before
taking action. Do not create a new key for the same invalidation.

Remote copies use caller-provided `RemoteArtifactDestination` adapters. Resolve
the destination credentials from `syncDestinations()` only in the local Deno
process, then pass the adapters through `remoteDestinations` to
`issueAndArchive()` or call `replicateArchive()` on a completed local archive.
`write(artifact)` must preserve an existing object and safely reconcile the
same stable path by exact SHA-256; `check(artifact)` can settle an ambiguous
network result. The encrypted
archive journal tracks each destination/artifact result, and `archive.pending()`
includes unresolved remote copies for recovery without a second issuance.
S3, Supabase Storage, Google Drive, OneDrive, and the local Facta bridge have
built-in adapters. OAuth refresh for Google Drive and OneDrive belongs to the
runtime; both need live provider credentials for an external write test.
Google Drive should use one writer process per destination because its API
does not conditionally create files by path. FTP/SFTP use the bridge running
on the same device, with its port supplied from local pairing data rather than
the synchronized vault.

## Ticket and reprinting

The SDK carries DTE request and response types; Facta calculates, validates,
and signs. `05`, `06`, `11`, and `14` have dedicated blocks in `DteRequest`;
use the [DTE examples](../examples/dte-types.ts) and follow the [published
OpenAPI contract](https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1/v1/openapi.json).

The API can regenerate a ticket PDF from the sealed DTE without issuing another
invoice. It uses the company's current template and supports 40–120 mm rolls
(80 mm by default):

```ts
const ticket = await facta.downloadDocument(generationCode, "ticket", {
  paperWidthMm: 58,
});
await Deno.writeFile(ticket.filename ?? `${generationCode}-ticket.pdf`, ticket.bytes);
```

The download does not discover printers or confirm a print job. Facta does not
send WhatsApp messages; saving or sharing bytes does not prove delivery or
printing. Sending and spooling remain the integrator's responsibility until
those transports and their status contracts are defined.

Submit the downloaded bytes through a transport adapter:

```ts
const printResult = await facta.print(ticket, printerTransport);
if (printResult.state === "unknown") {
  // Reconcile with the adapter before submitting this job again.
}
```

`printerTransport` implements `PrintTransport`. The SDK does not bundle a
device driver or retry a job with an unknown submission result.
