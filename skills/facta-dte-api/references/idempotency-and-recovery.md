# Idempotency, retries and recovery

Sources: `guides/idempotency.md`, `guides/errors.md`, `guides/prepare-sign.md`,
`README.md`, `playground/server/recipes/order-webhook.ts` and
`issue-idempotent.ts` (on the `feat/playground-foundation` branch), contract
(`Idempotency-Key`).

Issuing spends a control number, and a control number is never recycled. A
request that times out and is resent *as a new request* can produce two fiscal
documents for one sale. The `Idempotency-Key` header prevents that.

## The rules (from the contract)

- Required on `issue`, `prepare`, `sign`, `invalidate`, `registerReturn`. The SDK
  always sends one: yours if you pass `idempotencyKey`, otherwise a random UUID
  minted **once per call** (in memory only; a restart loses it — so supply your own).
- Scope: `(API key, Idempotency-Key)`.
- **Same key + same body** → the stored answer comes back, header
  `Idempotency-Replayed: true`. That includes a Hacienda rejection (the same 422,
  no new number).
- **Same key + different body** → `422 idempotency_key_reuse`. It is always a bug
  in your code (a changed price, a timestamp in `observaciones`, a different
  `deliver`). Never hide it with a new key.
- First request still running → `409 idempotency_in_flight` (not queued; the SDK
  retries it for you; `details.enVueloSegundos`, `details.codigoGeneracion`).
- **TTL 24 hours.** The same request a day later is a **new sale**.

## One key per business operation

Derive it from an id your system already stores:

```ts
const keyForSale = (orderId: string) => `sale:${orderId}`;
const keyForCreditNote = (orderId: string, n: number) => `credit-note:${orderId}:${n}`;
const keyForPrepare = (po: string) => `${po}:prepare`;   // prepare and sign: DIFFERENT keys
const keyForSign = (po: string) => `${po}:sign`;
```

- One order can produce several documents → one key per *fiscal operation*, not
  per order.
- Printable string, well under a few hundred characters (`createFactaSession`
  allows at most 200).
- **Persist the key with the order before the first attempt.** A restarted
  process must be able to replay it.
- Build the request deterministically from the stored order (same field order,
  same values) so a replay has the same body.

## What the SDK retries by itself

Same key, up to `maxRetries` (default 3), backoff 250 ms, 500 ms, 1 s… (max 4 s),
only for: `idempotency_in_flight`, `network_error` (including its own
`timeoutMs`), `service_unavailable`, `correlative_unavailable`, `mh_unreachable`,
`storage_unavailable`. Rejections and other 4xx are final.

## After an uncertain result

`issue` threw `network_error` (or another retryable code, retries exhausted): you
do not know whether it was issued and you do not have the `codigoGeneracion`.

1. **Replay the same request with the same key** within 24 h. You get the stored
   answer, including the code.
2. Then `getDocumentStatus(codigoGeneracion)` for anything that evolves
   afterwards (a contingency being sealed).
3. Never issue with a new key to "fix" it. Check `getDocumentStatus` /
   `listDocuments` before anything else if 24 h have passed.

```ts
async function issueSafely(facta: Facta, request: DteRequest, key: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await facta.issue(request, { idempotencyKey: key });
    } catch (error) {
      if (!(error instanceof FactaError)) throw error;
      if (error.code === "idempotency_key_reuse") throw error; // body changed: a bug
      const uncertain = ["network_error", "service_unavailable", "correlative_unavailable", "idempotency_in_flight"];
      if (!uncertain.includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
    }
  }
  throw new Error(`Outcome of ${key} unknown; replay later with the same key and the same request.`);
}
```

`rate_limited` (429): wait `details.retryAfterSeconds`, then replay the same key.
An `AbortSignal` only stops local waiting; it does not prove the server did not
accept the request.

## Surviving a crash between the request and your database write

`issueAndArchive` writes an encrypted journal (request snapshot, hash, key)
**before** the fiscal request; `recoverOperation(id)` replays it:

```ts
const facta = new Facta({ apiKey, signKey, runtime: { version: 1, archive } }); // archive: FileInvoiceArchive (node)
await facta.issueAndArchive(request, { operationId: `sale:${order.id}`, idempotencyKey: `sale:${order.id}`, includeTicket: false });
// at startup / in a job:
for (const op of await facta.listPendingOperations()) await facta.recoverOperation(op.id);
```

Recovery refuses (and needs a human) when the request no longer matches the
saved fingerprint, when the API identity (endpoint, key, issuer, environment)
changed, or when the operation is older than **23 hours** (an hour before the
server forgets the key). Invalidations have `invalidateAndArchive` /
`recoverInvalidation` / `listPendingInvalidations`; `operation_outcome_unknown`
means reconcile manually and **do not invalidate again**. See
[storage-and-emergency.md](storage-and-emergency.md) for the archive.

## Order-to-invoice (webhook) pattern

> This is an **integration example**. Facta DTE has no concept of orders: *your*
> shop (Shopify, WooCommerce, your own) notifies *your* server, and your server
> calls the SDK. The playground simulates the notice only to demonstrate it.

1. Your shop posts "order paid". Verify the webhook's authenticity with the
   shop's own mechanism *before* doing anything.
2. Translate the order with **your** price list and customer list into a
   `DteRequest` (never trust prices from the notice).
3. `facta.issue(request, { idempotencyKey: "order-" + order.id })`. Shops deliver the
   same webhook more than once; the same key returns the **same** invoice.
4. Store `codigoGeneracion`, `numeroControl` and the files with the order.
   Answer the shop 2xx once you have *accepted* the order (or after a sealed /
   contingency result); answer 5xx on retryable failures so the shop retries —
   with the same key that is safe.
5. A later credit note for the order is a different operation → different key.

A complete, type-checked starter is in
[`templates/webhook-to-invoice.ts`](../templates/webhook-to-invoice.ts).

## Rejections vs. retries

`mh_rejected` is not retryable: fix the data, then issue a corrected request with
a **new** key. Keep `error.spent` with the order.
