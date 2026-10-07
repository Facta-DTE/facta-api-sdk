# Prepare, review, then sign

[Spanish guide](prepare-sign.es.md) · [English README](../README.md) · [Method reference](reference.md)

`issue` does everything in one call: it reserves the control number, builds the
document, signs it and sends it to Hacienda. Some integrations need a person or
an approval system to see the exact document, with Facta's computed totals,
before it is signed. For that the API splits the work in two: `prepare` and
`sign`. Use them only when such a review step exists; otherwise `issue` is
simpler and spends no number on documents nobody signs.

## What each step does

| | `prepare(request, options?)` | `sign(prepared, options?)` |
| --- | --- | --- |
| Route | `POST /v1/dte/prepare` | `POST /v1/dte/sign` |
| Scope | `issue` | `issue` |
| Signing key | **not sent**: the signing vault is not opened | `X-Facta-Sign-Key` (your `signKey`) |
| Effect | reserves a control number, builds the canonical unsigned document and its totals | signs that document and transmits it to Hacienda |
| Returns | `PreparedDte` | `IssueResult` (`sellado` or `contingencia`) |

`PreparedDte` has `estado: "preparado"`, `codigoGeneracion`, `numeroControl`,
`tipoDte`, `ambiente`, `totales`, `documento` and `prepareToken`.

The `prepareToken` is not a credential: on its own it signs nothing. It is a MAC
over the canonical hash of the document (computed with sorted keys), and its
only job is to guarantee that what gets signed is exactly what received that
number. It **expires 15 minutes** after `prepare`.

## The flow

```ts
import { Facta, FactaError, type DteRequest, type PreparedDte } from "@facta-dte/api";

// The reviewer's process does not need the signing key.
const preparer = new Facta({ apiKey: process.env.FACTA_API_KEY! });
// The process that signs does.
const signer = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

const request: DteRequest = {
  tipoDte: "03",
  receptor: { customerId: "c_123" },
  items: [{ productId: "p_456", cantidad: 10 }],
};

const prepared: PreparedDte = await preparer.prepare(request, { idempotencyKey: "po-77:prepare" });
console.log(prepared.numeroControl, prepared.totales.totalPagar, prepared.totales.totalLetras);

// ... a person approves, within 15 minutes ...

try {
  const result = await signer.sign(prepared, { idempotencyKey: "po-77:sign" });
  if (result.estado === "contingencia") console.log("Signed; Hacienda will confirm later:", result.detalle);
} catch (error) {
  if (error instanceof FactaError && error.code === "prepare_token_invalid") {
    // Expired, from another API key, or the document changed. Prepare again.
  } else {
    throw error;
  }
}
```

Pass the `PreparedDte` to `sign` **unchanged**. The SDK sends only
`prepareToken` and `documento`; the server checks the MAC, so a single altered
cent is refused instead of signed. If the prepared object travels between
processes (a queue, a database), store and restore it as JSON without
transforming `documento`. Reordering keys is tolerated because the hash is
computed over sorted keys, but changing any value is not.

Catalog references (`customerId`, `productId`) are resolved before `prepare`,
exactly as in `issue`; see the [catalog guide](catalog.md).

## The review step

Show the reviewer what the server computed, never totals you recompute:

- `prepared.totales`: `totalGravada`, `totalIva`, `totalPagar`,
  `totalLetras`, …
- `prepared.documento`: the full canonical document (receiver, lines, codes).
- `prepared.numeroControl` and `prepared.codigoGeneracion`: the number is
  already reserved.

If the reviewer wants a change, do **not** edit `documento`. Fix your request
and call `prepare` again; that reserves another number. Every `prepare` without
its `sign` leaves a reserved, unused number that has to be accounted for in the
fiscal records, so keep the review short and avoid preparing speculatively.

## Idempotency for the two steps

Both routes need an `Idempotency-Key`, and the API scopes keys by API key, not
by route. Give each step its own stable key derived from the same business id
(`po-77:prepare`, `po-77:sign`), so a replay of either step returns its stored
answer:

- replaying `prepare` with its key and the same request returns the same
  `PreparedDte` (no second number);
- replaying `sign` with its key and the same prepared document returns the same
  `IssueResult`; this is how you recover a `sign` whose answer was lost.

See [idempotency.md](idempotency.md) for the general rules.

## What can go wrong

- **`prepare_token_invalid` (422)**: the token expired (15 minutes), belongs to
  another API key, or `documento` changed. Nothing was signed. Prepare again.
- **`validation_failed` / `no_storage_destination` (422) on `prepare`**: the data
  or the storage setup is wrong; no number was spent.
- **`sign_key_required` / `sign_key_invalid` (401) on `sign`**: the signer has no
  or a wrong `signKey`. Repeated wrong keys lock the vault (`sign_vault_locked`).
- **`mh_rejected` (422) on `sign`**: Hacienda refused the document and the number
  is spent; see `error.spent` and `error.mhObservations`.
- **A 202 contingency from `sign`**: signed and owed to Hacienda; check later
  with `getDocumentStatus(prepared.codigoGeneracion)`.
- **Prepared but never signed**: `getDocumentStatus` can report states such as
  `reservado`, `liberado` or `descartado` for reservations. The exact lifecycle
  of an abandoned reservation is decided by the server; reconcile it from your
  records and Facta's.

## Related

- [Idempotency patterns](idempotency.md) · [Error catalogue](errors.md)
- [Signing window for React](react.md), which uses `issue` in one step
- [Method reference](reference.md)
