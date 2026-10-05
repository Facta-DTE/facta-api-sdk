# Signing window: the server side and storage

The browser never holds a Facta credential. Your server owns the `Facta`
instance, creates one session token per sale and mounts one handler:

```ts
import { Facta } from "@facta-dte/api";
import { createFactaHandler, createFactaSession } from "@facta-dte/api/server";

const facta = new Facta({ apiKey, signKey, runtime: { version: 1, archive, remoteDestinations } });

export const handler = createFactaHandler({
  facta,
  sessionSecret,               // at least 32 bytes
  authorize: (req) => isLoggedIn(req),
  archive: "auto",             // "auto" | "required" | "off"
  onIssued: (result, { session, archive, storage }) => saveInvoice(session.idempotencyKey, result),
  onEvent: (event) => logger.info(event),
});

const session = await createFactaSession({ request, idempotencyKey: order.id }, sessionSecret);
```

The request inside the token is final; the window only reviews and issues it.

## How storage works with the window

There are three layers, and only the last two run on your server.

1. **Managed storage at Facta.** Automatic. The API writes the JSON and the
   PDF to the storage Facta manages for the account and reports a receipt.
   You configure nothing, and the window shows nothing more than a status.
2. **Local archive.** When the `Facta` client has `runtime.archive`, the
   handler calls `facta.issueAndArchive(request, { operationId: idempotencyKey,
   idempotencyKey, includeTicket: false })` instead of `facta.issue`. The
   encrypted journal and the exact JSON/PDF/JWS bytes land in your archive.
3. **BYOS copies.** `issueAndArchive` replicates to the
   `runtime.remoteDestinations` you configured. The handler adds nothing to that.

`archive` option:

| Value | Behaviour |
| --- | --- |
| `"auto"` (default) | Archive when the client has `runtime.archive`; otherwise plain `issue`. |
| `"required"` | Same, but constructing the handler throws when no archive is configured. |
| `"off"` | Always plain `issue`. |

The `operationId` is the session's idempotency key, so reopening the window
for the same order resumes the same operation. If a restart recovers an
operation without its document, the handler replays `issue` with the same key
and gets the same document back.

## What the browser sees

`issue` answers `{ result, storage }`. `storage` carries counts and states only:
never a path, bucket name, destination id or credential.

```json
{ "managed": "stored", "archive": "partial", "copies": { "complete": 1, "pending": 1, "failed": 0 } }
```

* `managed`: the worst of Facta's JSON and PDF copies (`failed` > `pending` >
  `unsupported` > `not_configured` > `stored`), or `null` without a receipt.
* `archive`: `complete`, `partial` (local archive done but a copy is pending or
  failed, or only some artifacts were saved), `failed`, or `off`.
* `copies`: only when destinations are configured.

**A storage problem is never an error.** A sealed or contingency document is
always returned to the browser, even when `archive` is `failed`.

## Environment and status lookups

`session.describe` returns `environment` (`"00"` for a `facta_test_` key, `"01"`
for `facta_live_`, `null` otherwise), read from the key prefix; the key is never
exposed. `issue` answers a `statusToken` next to `result` (and a rejection with
a spent correlative carries `error.statusToken`). `status` requires
`{ codigoGeneracion, statusToken }`; a token from another session or document
is refused with 403 `action_not_allowed`.

## Persisting in your own database

`onIssued(result, { session, archive, storage })` is awaited after a fiscal
result (sealed or contingency) and receives the full server-side result
(`jws`, `documento`) and the archive outcome, which may name destinations.
If it throws, the handler emits an `error` event with code `on_issued_failed`
and still returns the fiscal result. Make the hook idempotent: the window can
be reopened and the same order issued again returns the same document.

## Recovering pending copies

Copies that are `pending` or `failed` are repaired by your server, never by the
browser:

```ts
// In a job (cron, queue worker)
for (const op of await facta.listPendingOperations()) {
  await facta.recoverOperation(op.id);
}
```

`op.id` is the order's idempotency key, because that is the `operationId` the
handler used. Remote destinations must be idempotent, as `issueAndArchive`
already requires.
