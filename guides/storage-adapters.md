# Runtime storage adapters

[Spanish guide](storage-adapters.es.md) · [English README](../README.md)

The SDK owns artifact integrity, replication state, and retry/recovery
coordination. It does not own cloud credentials or provider setup. A Node, Deno,
or application runtime creates the destination client from credentials obtained
through its approved channel, then supplies either a `RemoteArtifactDestination`
or the simpler `ArtifactStore` port.

## Bridge an existing `put/get` client

```ts
import { createStorageArtifactDestination } from "@facta-dte/api";

const destination = createStorageArtifactDestination({
  id: "private-invoices",
  kind: "s3",
  label: "Private invoice bucket",
  store: existingClient,
  pathForArtifact: (artifact) =>
    `DTE/API/${artifact.codigoGeneracion}/${artifact.kind}`,
  isNotFound: (error) => isDefinitiveObjectNotFound(error),
});
```

`store` implements:

```ts
interface ArtifactStore {
  put(path: string, bytes: Uint8Array, contentType: string,
      options?: { signal?: AbortSignal }): Promise<void>;
  get(path: string,
      options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  /** Optional atomic create-if-missing operation. */
  putIfAbsent?(path: string, bytes: Uint8Array, contentType: string,
      options?: { signal?: AbortSignal }): Promise<"created" | "exists">;
}
```

The function needs an object path that is deterministic for the same
generation code and artifact kind. Paths are relative object keys. The SDK
rejects empty paths, rooted paths, traversal segments, backslashes, and NUL.
Keep the bucket/container private: DTE JSON and PDFs contain personal and
transaction data.

## AWS S3 and S3-compatible buckets

The SDK includes a first-party `createS3ArtifactDestination()` adapter. It
uses WebCrypto SigV4 and conditional `If-None-Match: *` writes, then reads the
object back and compares SHA-256. This closes the race where two SDK processes
both see a missing path and then overwrite different bytes. The bucket service
must support conditional object creation. AWS uses HTTPS and a regional
endpoint by default; custom endpoints default to path style. Plain HTTP is
allowed only for an explicitly enabled localhost endpoint used by a local
storage lab.

```ts
import { createS3ArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const destinationConfig = JSON.parse(destinos.find((item) => item.id === "s3-id")!.secret);
const destination = createS3ArtifactDestination({
  id: "s3-id",
  label: "Accounting bucket",
  config: destinationConfig,
});
```

The configuration uses `bucket`, `region`, `accessKeyId`, and
`secretAccessKey`; S3-compatible stores may also provide `endpoint`,
`pathStyle`, and `prefix`. Treat the decrypted `secret` and parsed config as
credentials: keep them in memory, do not log them, and do not persist them in
the invoice archive. The adapter defaults each exact artifact to
`api-invoices/{codigoGeneracion}/{kind}` below the configured prefix. Set
`pathForArtifact` if the integration has an established key convention.

## Supabase Storage

The SDK also includes `createSupabaseArtifactDestination()`. It uses the
configured project URL, bucket, and service key with Supabase Storage's REST
API. Uploads send `x-upsert: false`; an existing object is read and compared,
and a conflicting create is followed by a read instead of an overwrite.

```ts
import { createSupabaseArtifactDestination } from "@facta-dte/api";

const { destinos } = await facta.syncDestinations();
const row = destinos.find((destination) => destination.id === "supabase-backup");
if (!row) throw new Error("Destination not present in this API key's snapshot");

const destination = createSupabaseArtifactDestination({
  id: row.id,
  label: row.label,
  config: JSON.parse(row.secret),
});
```

The decrypted config contains `url`, `serviceKey`, and `bucket`, plus an
optional `prefix`. A service key has elevated access within its project. Use a
private bucket dedicated to documents, keep the key in memory, and never write
it to the local archive or logs. The URL must be the project root over HTTPS;
plain HTTP is opt-in for localhost development only. Object upload and read
permissions are verified through actual operations, so a successful check is
not inferred from a status-only probe.

## Google Drive

`createGoogleDriveArtifactDestination()` writes into the Facta folder selected
under Google's `drive.file` scope. Access-token refresh or user reauthorization
is supplied by the host runtime:

```ts
import { createGoogleDriveArtifactDestination } from "@facta-dte/api";

const destination = createGoogleDriveArtifactDestination({
  id: "accounting-drive",
  label: "Accounting Drive",
  config: { accessToken, folderId },
  refreshAccessToken: async () => getFreshGoogleDriveToken(),
});
```

Drive allows duplicate names and does not expose an atomic create-if-missing
operation for this path model. The adapter tags files with a private
`appProperties` path digest, serializes same-path writes in one adapter
instance, and checks every indexed match during recovery. Divergent matches
produce `unknown` without replacing either file. Use one writer process per
Drive destination; independent processes can race and leave duplicate files.
This adapter has mock coverage, but still needs a live Drive write test.

### Run the authenticated local S3 integration check

The optional `pnpm test:local-s3-storage` command builds the SDK and starts a
temporary SeaweedFS S3 service in Docker with randomly generated credentials.
It verifies that unsigned requests are rejected, then exercises SigV4
write/read, identical-write retry, and preservation of existing bytes when a
different payload targets the same object. The service binds to loopback and
the command removes its container and temporary credential file when it exits.
Docker must be available. Set `FACTA_TEST_S3_IMAGE` to test a locally available
SeaweedFS image instead of the default image.

## FTP and SFTP through Facta Bridge

The SDK can write through `facta-bridge` on the same computer running Node or
Deno. The destination vault contains the bridge API key and session ID, but
the bridge port belongs to that device and is intentionally not synced. Load
the port from the local bridge pairing/configuration, then combine it with the
decrypted secret:

```ts
import { createBridgeArtifactDestination } from "@facta-dte/api";

const destination = createBridgeArtifactDestination({
  id: row.id,
  label: row.label,
  config: { ...JSON.parse(row.secret), port: localBridgePort },
});
```

The adapter contacts only `127.0.0.1`, authenticates with the bridge key, and
uses the bridge v1 `POST /v1/storage` contract. It never learns the FTP/SFTP
server password. The remote path includes the artifact SHA-256 before its
filename, so a replacement with different bytes goes to a different immutable
path even though FTP/SFTP have no conditional create primitive. Repeating the
same bytes resolves to the same path and is verified by reading it back.
Unlike the web app's bridge probe, the SDK does not run a status request in
the background; an actual read/write happens only when the integrator calls a
storage operation.

This adapter has mocked Node/Deno coverage. A live test still needs a local
bridge paired to a disposable FTP/SFTP server.

## Integrity and ambiguous outcomes

Before writing, the helper reads the object. If the bytes have the expected
SHA-256 it returns `stored` without another write. If the object is missing, it
writes the exact archive bytes and reads back the object before returning
`stored`. A different existing object is never overwritten; it returns
`unknown` for operator reconciliation. Network or permission failures are also
`unknown` unless `isNotFound` identifies a definitive missing-object result.
The helper never logs credentials, paths, artifact bytes, or error messages.

Only classify the provider's exact not-found response as missing:

```ts
const isDefinitiveObjectNotFound = (error: unknown) =>
  error instanceof ProviderError && error.status === 404;
```

Do not classify a generic `403`, timeout, DNS failure, or SDK error as missing.
The write port is expected to be idempotent for identical bytes and stable
paths. When a store supports `putIfAbsent`, the helper uses atomic creation and
rechecks an object after a conflict. Without that primitive, comparison before
writing and verification afterwards cannot prevent a race between independent
writers; use a provider's conditional operation for concurrent emitters.
`InvoiceArchive` stores the per-destination/per-artifact state encrypted for
recovery.

## Provider troubleshooting

Provider adapter errors are storage errors, not `FactaError`s. They expose a
provider status/code without copying the response body, path, or credential
into the SDK journal. Use the public error class for the adapter in use and
keep the operation ID, destination ID, artifact kind, and SHA-256 for support
or reconciliation.

| Adapter / symptom | Check | Safe next step |
|---|---|---|
| S3 `301`, `400`, `403`, or `SignatureDoesNotMatch` | Bucket region, endpoint, path-style setting, access/secret key pair, host clock, and `GetObject`/`PutObject` permission | Correct the destination configuration, then retry the same archive replication. A `409`/`412` means the key already exists or conditional creation lost a race; let the SDK read and compare the bytes. |
| Supabase `401` or `403` | Project-root HTTPS URL, project service key, bucket name, private-bucket policy | Correct credentials/policy in the app, sync the destination vault, then retry the same archive operation. `409` is resolved by reading the existing object and checking its hash. |
| Google Drive `401` after the refresh callback | Refresh callback can renew the token and retain updated OAuth state; token has `drive.file` authorization for the selected folder | Reauthorize in the integration's owning runtime if refresh fails. A repeated `401` is not a missing object. For `409` or divergent duplicate matches, inspect the destination's indexed files and keep one writer process per destination. |
| OneDrive `401` after refresh | Refresh callback persistence and `Files.ReadWrite.AppFolder` permission | Renew/re-authorize in the owning runtime, then reconcile. On `409`/`412`, the adapter checks the app-folder item and only treats identical bytes as complete. |
| Bridge `unreachable` or `timeout` | The Node/Deno process runs on the paired device, `facta-bridge` is running, and `port` is the device-local pairing port | Re-pair or restart the bridge, then invoke replication again with the same operation and destination. Do not send the loopback request from a remote server: `127.0.0.1` refers to that server. A `401`/`403` requires repairing the bridge key; `404` means the indexed object is absent. |

The state values have distinct meanings: `stored` means bytes matched by
SHA-256; `unknown` means the remote state could not be proven; `failed` means
the adapter reported a failure; `unavailable` means the configured
destination is no longer present. For `unknown`, keep the journal and
reconcile with `check()` or retry the same stable-path/same-hash write. Never
issue a replacement DTE to fix an artifact-copy problem. These checks do not
prove end-to-end provider health unless a real provider credentialed
write/read was performed. Mock tests validate adapter behavior; the
authenticated local S3 check validates SigV4 and storage semantics against
SeaweedFS, not against every S3-compatible provider.

## Replicate or recover

```ts
const result = await facta.issueAndArchive(request, {
  archive,
  operationId: order.id,
  idempotencyKey: order.id,
  remoteDestinations: [destination],
});

if (result.archive.remoteCopies?.some((copy) => copy.state !== "stored")) {
  // Keep the operation ID, archive, and destination ID for explicit recovery.
  await facta.replicateArchive(order.id, archive, [destination]);
}
```

`replicateArchive()` only accepts a locally complete archive and verifies every
local artifact digest before the first remote operation. It never emits a DTE.
If cancellation happens during a write, the current item is marked `unknown`
in the encrypted journal when that journal remains writable, and the SDK stops
the batch. Use `check()` or repeat the same replication later to reconcile; do
not issue another invoice. If journal persistence itself fails, the result is
reported as `unknown`, but `pending()` cannot reflect that item until the
journal becomes writable again. Repeating the same stable-path, same-hash write
is the recovery path.

To inspect existing copies without creating test objects, use
`diagnoseDestinations(operationId, archive, destinations)`. It reads each
available local artifact and invokes only the adapter's optional `check()`
method. `stored` confirms that the remote bytes match; `missing` and `unknown`
never trigger writes. This checks read/reconciliation behavior, not remote
write permission. Use an actual archived emission and call
`replicateArchive()` only when you intend to copy its fiscal artifacts.

`createStorageArtifactDestination()` adapts an existing `put/get` client.
`createS3ArtifactDestination()` and `createSupabaseArtifactDestination()` are
built-in providers. The package also includes `createOneDriveArtifactDestination()`
for the private application folder:

```ts
import { createOneDriveArtifactDestination } from "@facta-dte/api";

const destination = createOneDriveArtifactDestination({
  id: "accounting-onedrive",
  label: "Accounting OneDrive",
  accessToken: credentials.accessToken,
  // Keep the refresh token in the runtime that owns the OAuth credentials.
  refreshAccessToken: async () => {
    const renewed = await refreshOneDriveCredentials(credentials.refreshToken);
    await saveCredentials(renewed);
    return renewed.accessToken;
  },
  prefix: "Facta/Invoices",
});
```

The token must carry `Files.ReadWrite.AppFolder`. Refresh is delegated to the
runtime callback, so the SDK never writes rotated credentials back to an API
vault. Upload sessions use `conflictBehavior: "fail"`; a same-path retry reads
back and verifies the SHA-256 before it reports success. The upload URL is
preauthenticated and is never persisted or logged. The provider adapter has
mocked Node and Deno consumer coverage, but still needs a live OneDrive test.

S3, Supabase Storage, Google Drive, OneDrive, and the local bridge have
built-in adapters. Facta-managed storage remains app-only: its Worker requires
an authenticated Supabase user-session token, and a Facta API key does not
authenticate that service. Do not forward a user's app session into an
integrator process. Supporting managed storage in the SDK requires a separate
API-key-scoped capability contract. Credential renewal, private access
policies, and live provider validation remain responsibilities of the runtime
integrations.
