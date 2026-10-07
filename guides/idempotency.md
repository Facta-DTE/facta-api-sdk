# Idempotency patterns

[Spanish guide](idempotency.es.md) · [English README](../README.md) · [Method reference](reference.md)

Issuing a DTE spends a control number, and a control number can never be
recycled. If a request times out and you send it again as a new request, you may
end up with two fiscal documents for one sale. The `Idempotency-Key` header
prevents that: the server remembers the first answer for a key and returns it
again instead of doing the work twice. This guide shows how to choose keys, what
the SDK retries for you, and how to recover when you do not know whether a
request went through.

## The rules

These come from the published API contract:

- **Routes that need a key**: `POST /v1/dte` (`issue`), `POST /v1/dte/prepare`,
  `POST /v1/dte/sign`, `POST /v1/dte/{codigoGeneracion}/invalidate` and
  `POST /v1/dte/{codigoGeneracion}/return`. Without one the API answers
  `400 idempotency_key_required`.
- **Scope** is `(API key, Idempotency-Key)`: two integrators can use the same
  string without colliding.
- **Same key, same body**: the stored answer comes back (with
  `Idempotency-Replayed: true`). That includes a Hacienda rejection: the replay
  returns the same `422 mh_rejected` without spending another number.
- **Same key, different body**: `422 idempotency_key_reuse`.
- **While the first request is still running**: `409 idempotency_in_flight`; it
  is not queued.
- **TTL 24 hours.** After that the key is free again: the same request a day
  later is a **new sale**, not a retry.

## What the SDK does for you

- Every POST carries an `Idempotency-Key`. If you pass `idempotencyKey`, that is
  the key; otherwise the SDK mints a random UUID **once per call**. You will not
  see `idempotency_key_required` from the SDK.
- The same key is reused on every automatic retry of that call. The SDK retries
  only `idempotency_in_flight`, `network_error` (including its own timeout),
  `service_unavailable`, `correlative_unavailable`, `mh_unreachable` and
  `storage_unavailable`, up to `maxRetries` (default 3) with a backoff of 250 ms,
  500 ms, 1 s… capped at 4 s. Rejections and other 4xx answers are never retried.
- A minted key lives only in memory. If your process restarts, the next attempt
  gets a different key. **That is why you should supply your own.**

## Pattern: one key per business operation

Use an identifier your system already has and that survives restarts: an order
number, a POS ticket, a payment id. Derive one key per fiscal operation, not one
per order, when an order can produce several documents.

```ts
import { Facta, FactaError, type DteRequest } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

// A payment webhook can arrive more than once for the same order.
export async function onPaymentConfirmed(event: { orderId: string; lines: DteRequest["items"] }) {
  const request: DteRequest = { tipoDte: "01", items: event.lines };
  // Same order -> same key -> same document, however many times the webhook fires.
  return await facta.issue(request, { idempotencyKey: `sale:${event.orderId}` });
}

// A later credit note for that order is a different operation, so a different key.
const creditNoteKey = (orderId: string, n: number) => `credit-note:${orderId}:${n}`;
```

Build the request deterministically from your stored order (same field order,
same values) so a replay produces the same body. Keys should be stable,
printable strings; keep them well under a few hundred characters.

## Recovering an uncertain result

When `issue` finally throws `network_error` (or another retryable code after the
SDK's retries), you do not know whether the server issued the document, and you
do not have its `codigoGeneracion` either. Replay **the same request with the
same key** within 24 hours: you get the stored answer, including the code. Then
use `getDocumentStatus` for anything that happens afterwards (a contingency
being sealed, for example).

```ts
import { FactaError, type DteRequest } from "@facta-dte/api";

const request: DteRequest = { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2.5 }] };

async function issueSafely(request: DteRequest, key: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await facta.issue(request, { idempotencyKey: key });
    } catch (error) {
      if (!(error instanceof FactaError)) throw error;
      if (error.code === "idempotency_key_reuse") throw error; // the body changed: a bug, never mask it
      const uncertain = ["network_error", "service_unavailable", "correlative_unavailable", "idempotency_in_flight"];
      if (!uncertain.includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
    }
  }
  throw new Error(`Outcome of ${key} unknown; replay later with the same key and the same request.`);
}

const result = await issueSafely(request, "sale:1042");
if (result.estado === "contingencia") {
  const later = await facta.getDocumentStatus(result.codigoGeneracion);
  console.log(later.estado); // "sellado" once Hacienda confirms
}
```

Never "fix" an uncertain result by issuing with a new key. Store the key with the
order before the first attempt, so a restarted process can replay it.

## Durable recovery across restarts

When the replay must survive a crash between the request and your database
write, use `issueAndArchive` with a durable archive. It writes an encrypted
journal (request snapshot, its hash and the key) **before** the fiscal request,
and `recoverOperation(operationId)` replays the same key and request later:

```ts
// `facta` was created with `runtime: { version: 1, archive }` (for example a FileInvoiceArchive).
const archived = await facta.issueAndArchive(request, {
  operationId: "sale:1042",
  idempotencyKey: "sale:1042",
  includeTicket: false,
});
// After a restart, for each pending journal:
for (const op of await facta.listPendingOperations()) {
  await facta.recoverOperation(op.id);
}
```

Recovery refuses to replay when the request no longer matches the saved
fingerprint, when the API identity (endpoint, key, issuer, environment) changed,
or when the operation is older than **23 hours** (the SDK stops one hour before
the server forgets the key). Those cases need a person: check the document with
`getDocumentStatus` or `listDocuments` before doing anything else.

Invalidations have the same pair: `invalidateAndArchive` and
`recoverInvalidation`. When the safe window expired, or the API confirms the
document was already invalidated without returning the event, they throw
`FactaError` with `operation_outcome_unknown`: reconcile manually; do not
invalidate again.

## Rejections and spent numbers

`mh_rejected` means Hacienda read the document and refused it; the control
number **was** spent. `error.spent` gives `{ codigoGeneracion, numeroControl }`
and `error.mhObservations` Hacienda's words. Replaying the same key returns the
same rejection. A corrected document has a different body, so it needs a new
key. The SDK has no option to send the spent number with the corrected request;
how a correction relates to the spent number is handled by Facta's server and
records, so keep `error.spent` with your order for reconciliation.

## What can go wrong

- **`idempotency_key_reuse` (422)**: your code built a different body for the
  same key (a changed price, a new timestamp in `observaciones`, a different
  `deliver`). Find the bug; do not switch to a new key to hide it.
- **`idempotency_in_flight` (409)** after all retries: the first request is still
  working (Hacienda can take ~40 s). Wait and replay the same key.
- **Replaying after 24 hours**: issues a second document. Reconcile with
  `getDocumentStatus` / `listDocuments` first.
- **`AbortSignal`**: aborting stops waiting and retries locally; it does not
  prove the server did not accept the request. Replay the key to find out.
- **Random keys in a stateless worker**: a crash loses the key. Derive keys from
  stored business ids.

## Related

- [Prepare and sign](prepare-sign.md) · [Error catalogue](errors.md#idempotency)
- [Storage adapters](storage-adapters.md) for archives · [Method reference](reference.md)
