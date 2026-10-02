# Node.js integration guide

For exact public method signatures, scopes, defaults, side effects, and
recovery behavior, see the [SDK method reference](reference.md). Read the
[Spanish guide](node.es.md) for the Spanish version.

**Status:** implementation is in the development branch. `@facta/api` has not
been published to npm. Do not point a production integration at a package or
contract that has not been published after staging verification.

## Requirements and installation

- Node.js 22 or 24, ESM, and TypeScript 5.9+ to compile the consumer.
- A Facta account and a `facta_test_…` key enabled for the `issue`, `query`,
  and `download` scopes required by the integration.
- `FACTA_UNLOCK_KEY` is also needed to open local snapshots. `FACTA_SIGN_KEY`
  is required to issue.

While the package remains unpublished, validate a repository checkout with:

```sh
pnpm install --frozen-lockfile
pnpm pack:check
```

This tests the tarball with clean consumers. Once a beta version is published,
install that exact version and pin it in the application lockfile. npm install
is not yet an executable instruction for external consumers.

## Configure the client

Inject secrets from the process secret manager. Do not put them in source code
or print `FactaOptions` to logs.

```ts
import { Facta } from "@facta/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  baseUrl: process.env.FACTA_API_BASE_URL,
  timeoutMs: 60_000,
  maxRetries: 3,
});

const health = await facta.status();
if (!health.ok || health.ambiente !== "00") {
  throw new Error("The key is not ready in the test environment");
}
```

If omitted, `baseUrl` uses Facta’s public URL. The key prefix selects the test
environment (`facta_test_`, environment `00`) or production (`facta_live_`,
environment `01`); there is no separate staging URL. `status()` checks the key,
company, revisions, and quotas. It counts as a status request but needs no
`issue`, `query`, or `download` scope.

For non-secret values, Node can load an explicit JSON file with
`createFactaFromConfigFile()` from `@facta/api/node`. The file object uses
`FactaConfigV1` (`version: 1`); unknown keys are rejected, and values passed in
`config` take precedence. Keep keys, local files, and adapters out of this file:

```ts
import { createFactaFromConfigFile } from "@facta/api/node";

const facta = await createFactaFromConfigFile({
  configFile: "/etc/facta/client.json",
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,
});
```

## Issue with or without a saved customer

Inline data applies only to this invoice and never creates or edits a customer
record. You can omit `receptor` for an anonymous FE (`01`). For a named FE or
CCF, provide the recipient required for that DTE:

```ts
const result = await facta.issue({
  tipoDte: "03",
  receptor: {
    nombre: "Comercial de Prueba, S.A. de C.V.",
    tipoDocumento: "36",
    numDocumento: "06140000000001",
    nrc: "1234567",
    codActividad: "46510",
    descActividad: "Venta al por mayor de equipo",
    direccion: {
      departamento: "06",
      municipio: "20",
      complemento: "Colonia Centro, San Miguel",
    },
    correo: "compras@example.com",
  },
  items: [{ descripcion: "Servicio de instalación", cantidad: 1, precioUni: 25 }],
}, { idempotencyKey: "erp-order-1042" });

if (result.estado === "sellado") {
  console.log(result.codigoGeneracion, result.numeroControl, result.selloRecibido);
} else {
  // 202: signed and awaiting the MH final response; check its status later.
  console.log(result.estado, result.codigoGeneracion, result.detalle);
}
```

Reuse the same `idempotencyKey` when retrying the same sale after a timeout.
Do not reuse it with a different request body. The SDK generates a key for a
POST if none is supplied, but a stable order key allows recovery after Node
restarts.

`FactaError` distinguishes fiscal rejections from technical errors. A rejection
from Hacienda has already consumed the control number; `error.spent` returns its
generation code and control number so you can correct the operation under the
API contract:

```ts
import { FactaError } from "@facta/api";

try {
  await facta.issue(request, { idempotencyKey: "erp-order-1042" });
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    console.error("Hacienda rejected the DTE", error.spent?.numeroControl, error.message);
  } else {
    throw error;
  }
}
```

## List and save JSON/PDF

The list returns summaries and a stable cursor. Download the legal bytes
separately and save them without parsing or reserializing the JSON:

```ts
import { writeFile } from "node:fs/promises";

const page = await facta.listDocuments({ tipoDte: "03", limit: 50 });
for (const invoice of page.documentos) {
  const json = await facta.downloadDocument(invoice.codigoGeneracion, "json");
  await writeFile(json.filename ?? `${invoice.codigoGeneracion}.json`, json.bytes);
}
```

This example saves only the first page. A reconciliation worker should follow
`page.siguiente` until it is `null`. The `"pdf"` kind downloads the graphical
representation when available. Neither step prints the document or sends it
through WhatsApp.

## Durable archive and recovery

Import the Node adapter from its subpath and store its passphrase as a separate
secret from `FACTA_UNLOCK_KEY`:

```ts
import { Facta } from "@facta/api";
import { FileInvoiceArchive } from "@facta/api/node";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
});

const archive = await FileInvoiceArchive.open({
  directory: process.env.FACTA_ARCHIVE_DIRECTORY!,
  passphrase: process.env.FACTA_ARCHIVE_PASSPHRASE!,
});
const diagnostic = await facta.diagnose({ dteType: "03", archive });
if (!diagnostic.canIssueAndArchive) {
  throw new Error(diagnostic.checks.map((item) => item.message).join("; "));
}
```

Certificate diagnostics use only the public fingerprint, validity dates, NIT,
and environment already registered by the web app. An expired certificate or
an NIT mismatch blocks `canIssue`; an environment mismatch is advisory because
the registry records the slot in which the public key was uploaded. Older keys without a public
metadata row remain usable and are reported as unknown until the app publishes
the metadata. The status route never returns encrypted vault entries or a
private key.

`issueAndArchive()` records the idempotency key first, then encrypts exact JSON,
PDF, JWS, and ticket bytes. It defaults to an 80 mm ticket; set
`ticketPaperWidthMm` (40–120 mm) to choose another supported width. The choice
is stored in the journal and reused during recovery. After a restart, list
`facta.listPendingOperations(archive)` and call
`facta.recoverOperation(operation.id, { archive })`; the encrypted journal
supplies the original resolved request, so the integrator need not reconstruct
it. The archive serializes writers across processes on supported local
filesystems; network filesystems are unsupported. Locks are never stolen
automatically. If a process stops while holding one, stop every writer and
call `FileInvoiceArchive.releaseStaleLock({ directory, confirmNoConcurrentWriters: true })`
before resuming work. `lockTimeoutMs` defaults to 30 seconds and bounds waits.

The archive directory has root `formatVersion: 1`. Invoice and invalidation
journals written by this SDK use additive `schemaVersion: 1`; existing v1
journals without that field remain readable and are rewritten in v1 on their
next mutation. An unknown journal version fails closed with
`archive_integrity_error`; preserve a backup of the full directory before
trying to open it with a newer SDK. Do not delete or hand-edit encrypted files
to recover from a version error.

Invalidation is also irreversible, so archive the event response separately
from the original DTE. Reuse the same operation and idempotency IDs after a
restart:

```ts
const generationCode = result.codigoGeneracion;
const invalidation = await facta.invalidateAndArchive(
  generationCode,
  {
    tipoAnulacion: 2,
    motivo: "Correction",
    responsable: { nombre: "Issuer", tipoDocumento: "36", numDocumento: "06140000000001" },
    solicita: { nombre: "Operator", tipoDocumento: "36", numDocumento: "06140000000001" },
  },
  { archive, operationId: stableOperationId, idempotencyKey: stableIdempotencyKey },
);

// On restart, reconcile each saved event using its existing idempotency key.
for (const operation of await facta.listPendingInvalidations(archive)) {
  await facta.recoverInvalidation(operation.id, archive);
}
```

If recovery reports `operation_outcome_unknown`, inspect the fiscal status
before taking action. Do not create a new operation key for the same event.

Remote replication uses a `RemoteArtifactDestination` adapter created by your
runtime from the locally opened destination snapshot. Pass adapters as
`remoteDestinations` to `issueAndArchive()`, or call
`replicateArchive(operationId, archive, destinations)` after issuance. Writes
must use deterministic paths and be safe to repeat for identical SHA-256 bytes.
Implement `check(artifact)` to reconcile ambiguous timeouts. The encrypted
journal records state per destination and artifact; pending remote copies
remain visible, and `recoverOperation()` can retry them without
issuing another DTE. Provider authentication and platform requirements remain
the adapter's responsibility.

`print()` submits a previously downloaded PDF once through a caller-owned
`PrintTransport`. The adapter's `submitted` result means accepted for spooling,
not physically printed. Reconcile an `unknown` job with the adapter before
retrying it.

## Stored data and migration

The API/SDK does not store customers or products. The owner maintains or CSV
imports them in Facta and publishes encrypted snapshots from the web app. The
SDK only reads the snapshot and resolves IDs in memory. Inline names, invoice
lists, and fiscal content follow the key’s access limits. When migrating from
another HTTP client, keep the same `Idempotency-Key`, map its response to
`IssueResult`, and do not recalculate totals or the canonical document.

## Ticket and reprinting

The letter-size representation and ticket are separate PDF artifacts. Request
a ticket from Facta after sealing; this does not issue the DTE again:

```ts
const ticket = await facta.downloadDocument(dte.codigoGeneracion, "ticket", {
  paperWidthMm: 80, // 40–120 mm; omit this option to use 80 mm
});
await writeFile(ticket.filename ?? `${dte.codigoGeneracion}-ticket.pdf`, ticket.bytes);
```

Facta generates the ticket with the company’s current template. The API does not
discover printers, confirm a print job, or send WhatsApp messages. Saving or
sharing bytes does not prove delivery or printing. Sending and spooling remain
the integrator’s responsibility until those transports and their status
contracts are defined.

To submit the downloaded PDF to a printer, pass it to a transport adapter:

```ts
const printResult = await facta.print(ticket, printerTransport);
if (printResult.state === "unknown") {
  // Reconcile with the adapter before submitting this job again.
}
```

`printerTransport` implements the exported `PrintTransport` contract. The SDK
does not bundle a device driver or retry a job whose submission state is unknown.
