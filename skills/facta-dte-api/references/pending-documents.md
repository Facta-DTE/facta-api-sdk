# Pending documents: list and retry (mandatory after any uncertain emission)

Sources: `guides/pending-documents.md`, `src/client.ts`, the contract.

An emission can end without a verdict: `202 contingencia`, `503 service_unavailable`,
a dropped connection, a process that died, or a `200` with the warning
`indice_pendiente` / `reserva_sin_asentar`. The document may exist, signed, with its
control number spent. **Issuing again creates a second document.**

## The mandatory "after emission" step

1. If the call returned a result or a rejection, store it (`jws`, `numeroControl`,
   `estado`) and stop.
2. If it ended uncertain, **replay the same request with the same `idempotencyKey`**
   (the SDK does this for retryable codes; `503` carries `retryAfterSeconds`).
3. If you still do not know, or the answer was `202`/`indice_pendiente`/
   `reserva_sin_asentar`, call `listPendingDocuments()` and finish what is there
   with `retryDocument(codigoGeneracion)`. Manually, per document; there is no
   automatic retry.
4. **Never** make a new request with a new key for the same sale. Never
   "re-issue" to fix a pending document.

```ts
const { pendientes } = await facta.listPendingDocuments(); // GET /v1/dte/pendientes, scope query
for (const doc of pendientes) {
  if (!doc.reintentable) continue; // app-issued documents are retried in the app
  const result = await facta.retryDocument(doc.codigoGeneracion); // POST …/reintentar, scope issue + signKey
  // result.estado === "sellado": result.via is "consulta" | "retransmision" | "ya_asentado"
  // result.estado === "pendiente" (HTTP 202): Hacienda did not answer; try again later
}
```

## What the retry does (and never does)

It never signs or numbers. It asks Hacienda about the code first: already sealed →
nothing is resent and the record is completed; never received → the SAME signed
bytes are resent; refused → `mh_rejected` (a `FactaError`, `isRejection`) and the
number is recorded as refused; no answer → `pending`, nothing changes. Calling it
again is safe; two at once → one transmits, the other gets `retry_in_progress`
(retried by the SDK). `document_not_retryable` (`details.motivo`) means the API
cannot finish it (`documento_de_la_aplicacion`: retry from Documentos in the app).

`plazo.requiereContingencia: true` (24 h after signing): tell the owner to declare
the contingency event in the app; the retry is still allowed and Hacienda decides.

## Idempotency is stricter now

A key that produced a document is bound to that sale for ever. The stored answer
lasts 7 days; later the same key and body return the existing document rebuilt
(`Idempotency-Replay-Source: rebuilt`), and a different body is always
`422 idempotency_key_reuse`. One key per sale, for ever; a lost response means replay
the same key or look the document up, never a new key.
