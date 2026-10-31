# Pending documents and retry

[Español](pending-documents.es.md)

An emission can end without you knowing whether Hacienda sealed the document:
Hacienda did not answer (`202 contingencia`), your connection dropped, Facta
answered `503 service_unavailable`, or the answer carried the warning
`indice_pendiente` or `reserva_sin_asentar`. In every one of those cases there is
**one rule**:

> **Never issue again with a new key.** A new emission is another sale: another
> code, another control number, another fiscal document. First list what is
> pending and finish it.

## What "pending" means

A document is **pending** when Facta already signed it and its control number is
spent, but Hacienda has not said yes or no. It exists, it is yours, and it is owed
to Hacienda. You fix it by **finishing** it, not by creating another.

## Step 1. List what is pending

```ts
const { pendientes, siguiente } = await facta.listPendingDocuments();
// { estado: "rechazado" } lists the ones Hacienda refused; { limit, cursor } paginate.

for (const doc of pendientes) {
  console.log(doc.codigoGeneracion, doc.numeroControl, doc.antiguedadSegundos, doc.reintentable);
}
```

`GET /v1/dte/pendientes` needs the `query` scope and returns only metadata (never
the document or the receiver), oldest first. Each row says whether it is
`reintentable`; if not, `motivoNoReintentable` says why: `documento_de_la_aplicacion`
(the app issued it; retry it from Documentos → Pendientes con Hacienda),
`sin_copia_firmada`, or `rechazado`. `plazo.requiereContingencia` becomes `true`
after 24 hours from signing: a plain retransmission is no longer the normal path,
so declare the contingency event from the app. Facta does not block the retry for
that: it asks Hacienda, which decides.

## Step 2. Retry, with the same signature

```ts
import { FactaError } from "@facta-dte/api";

try {
  const result = await facta.retryDocument(doc.codigoGeneracion);
  if (result.estado === "sellado") {
    // result.via: "consulta" (Hacienda already had it), "retransmision" (same bytes
    // resent) or "ya_asentado" (it was already finished). Nothing was issued.
    // With result.advertencias, keep result.documento and result.jws, then call again.
  } else {
    // "pendiente": Hacienda did not answer. Nothing changed. Try again later.
  }
} catch (error) {
  if (error instanceof FactaError && error.isRejection) {
    // Hacienda refused: error.mhObservations says why. The number is recorded as refused.
  } else throw error;
}
```

`POST /v1/dte/{codigoGeneracion}/reintentar` needs the `issue` scope and the signing
key (the Hacienda credentials live in that vault). **It never signs or numbers
anything**: it asks Hacienda about the code first, and resends the exact same bytes
only if Hacienda never received them.

| Hacienda says | Facta does | You get |
| --- | --- | --- |
| "Already sealed" | Resends nothing. Completes the record and closes the number. | `sellado`, `via: "consulta"` |
| "Never received" | Resends the same bytes. | `sellado`, `via: "retransmision"` |
| "Refused" | Records the refusal. | `FactaError` `mh_rejected` with Hacienda's words |
| (no answer) | Changes nothing. | `estado: "pendiente"` (HTTP 202) |

Calling it again on a sealed document does nothing (`ya_asentado`). Two retries at
once do not transmit twice: the second gets `409 retry_in_progress`, which the SDK
retries for you after `retryAfterSeconds`.

## Recover everything at start-up (opt-in)

`recoverServerPending()` is steps 1 and 2 in a loop, for the documents Facta signed
on the server. It is **opt-in**: nothing runs it for you. Call it when your process
starts and on a schedule (for example every 10 to 15 minutes), so an emission that
ended uncertain is finished even if nobody looked at the response.

```ts
const report = await facta.recoverServerPending({ limit: 50 });
// report: { examined, sealed, rejected, pending, notRetryable, errors, results[], truncated }

for (const r of report.results) {
  if (r.outcome === "rejected") alertSomeone(r.codigoGeneracion, r.message); // Hacienda refused it
  if (r.outcome === "error") log.warn(r.codigoGeneracion, r.errorCode);      // nothing was issued; next run tries again
}
```

- It needs `signKey` (each retry carries it) and a key with the `query` and `issue` scopes.
- It goes oldest first, one document at a time, and never throws for a document. Every
  document ends as `sealed` (`via` says how), `rejected` (Hacienda refused it),
  `pending` (no answer, or another retry is running: nothing changed), `not_retryable`
  (`motivo`; documents issued from the app are retried in the app) or `error`.
- `limit` defaults to 50 (at most 500); `truncated: true` means more were left for the next run.
- It throws only when the list itself cannot be read (a revoked key, no connection) or
  when your `signal` aborts. Catch that at start-up so a Facta outage never stops your service.
- It never signs, numbers or issues. It only does what `retryDocument()` does: ask
  Hacienda first, resend the same bytes only if it never received them. Running it twice,
  or from two instances, is safe.

## What to do in each situation

| You see | It means | Do |
| --- | --- | --- |
| `503 service_unavailable` (`retryAfterSeconds`) | Something of Facta's did not answer. If it says the signed document could not be recorded, **nothing was sent to Hacienda** and the number was handed back. | Wait, replay the **same** request with the **same** `idempotencyKey`. |
| `202`, `estado: "contingencia"` on issue | Signed; Hacienda did not answer. | Keep `jws` and `numeroControl`; later `listPendingDocuments()` and `retryDocument()`. |
| Your process died or the connection dropped | You do not know if it arrived. | Replay the same request with the same key, or `listPendingDocuments()`. |
| `advertencias: indice_pendiente` | Sealed, but Facta DTE's own record could not be written. The answer carries `documento` and `jws`: keep them. | `retryDocument()` finishes the record without resending. Do not issue again. |
| `advertencias: reserva_sin_asentar` | Sealed and indexed; closing the number is pending. | `retryDocument()`. Do not issue again. |
| `mh_rejected` from `retryDocument()` | Hacienda refused it. | Correct the data and send a new request that reuses that number (see [contingency and rejection](idempotency.md)); retrying the same document will not change the verdict. |

## Keys are stricter now

Since 30-Oct-2026 an `Idempotency-Key` that produced a document is bound to that
sale for ever. The stored answer lasts 7 days; after that the same key and body
return the existing document rebuilt from its copies, and a different body is
always `422 idempotency_key_reuse`. See [idempotency](idempotency.md). Use one key
per sale, for ever.

## In your system

Give every sale four states: *sealed*, *signed without a seal (pending)*,
*refused* and *not issued*. After any doubtful emission look at what is pending
**before** deciding anything, and never answer a `503` or a dropped connection by
inventing a new key.
