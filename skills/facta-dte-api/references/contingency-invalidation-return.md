# Contingency, invalidation and the return event

Sources: `guides/return-event.md`, `guides/archivo-dte.md`, `guides/delivery.md`,
`guides/idempotency.md`, `guides/node.md`, `src/types.ts`, contract
(`anularDte`, `registrarRetorno`, 202 of `emitirDte`).

## Contingency is a success, not an error

When Hacienda does not answer, `issue` / `sign` return HTTP 202 and
`estado: "contingencia"` (`DteInContingency`): the document **is signed**, the
control number is reserved, the bytes exist and are owed to Hacienda. Facta keeps
the reservation in contingency and retransmits later (the 24 h / 72 h deadlines
are the law's, not Facta's). The SDK does not retry a 202.

What you must do:

- Treat it as issued. Store `codigoGeneracion`, `numeroControl`, `jws` and
  `archivoJson` from the result. **Never issue again with a new key.**
- Poll later (a job, not a tight loop): `facta.getDocumentStatus(code)` →
  `estado: "sellado"` once Hacienda confirms. `getDocumentStatus` can also report
  `firmado`, `rechazado`, `invalidado`, `reservado`, `liberado`, `descartado`.
- While in contingency there is **no seal**, so no Archivo DTE:
  `result.archivoDte` is absent, `archivoDteOf(result)` is `null`, and the default
  JSON download answers `not_sealed` (409). Use `downloadDocument(code, "json",
  { raw: true })` for the stored original, and fetch the Archivo DTE after the seal.
- Delivery: channels read `esperando_sello` and there is **no delivery token**;
  delivery after a contingency is not offered. Tell the customer the document will
  be available once Hacienda confirms, or deliver it yourself later.
- Managed storage is not committed until Hacienda returns a seal.
- UI: show «Emitido en contingencia» as a success with a note, not a failure.

## Invalidation (anulación) — irreversible

`facta.invalidate(codigoGeneracion, request, { idempotencyKey })` →
`InvalidationResult`. Needs scope `issue` and the `signKey`.

An invalidation is an **event**: its own signed document with its own code and
seal, sent to another Hacienda service. The invalidated document is not erased;
it changes state. **There is no way to undo it.** It spends no control number but
still needs an idempotency key (a timeout retry would send a second event).

```ts
import type { InvalidationRequest } from "@facta-dte/api";

const request: InvalidationRequest = {
  tipoAnulacion: 2, // 1 error in the document · 2 rescission of the operation · 3 other
  // motivo: required for 1 and 3
  // codigoGeneracionReemplazo: required for 1 and 3, FORBIDDEN for 2
  responsable: { nombre: "Ana Rivas", tipoDocumento: "36", numDocumento: "06142803901121" },
  solicita:    { nombre: "Ana Rivas", tipoDocumento: "36", numDocumento: "06142803901121" },
};
const result = await facta.invalidate(code, request, { idempotencyKey: `invalidate:${code}` });
```

- Types 1 and 3 cancel the document *together with the one that replaces it*:
  **issue the correct document first**, then invalidate with its code.
- Only a **sealed** document can be invalidated (a rejection never existed for
  Hacienda; its number is reused by the corrected document).
- Always send `tipoDocumento` for `responsable` and `solicita` (CAT-022: `36` NIT,
  `13` DUI, `03` passport, `02` residence card, `37` other) and **digits only**
  for `numDocumento` (DUI 9 digits, NIT 14, or 9 if homologated with the DUI).
  The server deduces the type if omitted, and a wrong deduction is caught by
  Hacienda in flight, after the event used its attempt.
- A document with **sealed return events** cannot be invalidated:
  `409 has_return_events` → correct with more returns or a credit note.
- Invalidating something already invalidated answers 200 with
  `yaEstabaInvalidado: true` (only identifiers; it cannot rebuild the event).
  Use `invalidateAndArchive` when you need the event retained locally.
- Time limits and who may ask are Hacienda's rules, applied by the server; the
  SDK does not encode them. Surface the server's message verbatim when it refuses.
- `operation_outcome_unknown` (from the archive variants): an invalidation may
  have completed but its event cannot be recovered. Reconcile manually; do not
  invalidate again.
- Ask for confirmation in your UI: this is the one action that cannot be reverted.

From a browser, the handler's `invalidate: "session"` capability plus
`createFactaInvalidationSession` keeps the decision on your server (see
[browser-and-react.md](browser-and-react.md)).

## Return event (Evento de Retorno)

When a customer returns part of what they bought, register a **return event**
(CAT-002 code 18) instead of invalidating. It is its own signed document with its
own code and seal, applied to a sealed invoice.

```ts
const result = await facta.registerReturn(invoiceCode, {
  items: [{ linea: 1, cantidad: 2 }, { linea: 3, cantidad: 1 }], // lines count from 1
  // fechaEvento: "2026-10-06", // YYYY-MM-DD; defaults to today in El Salvador
}, { idempotencyKey: `return:${rmaId}` });

if (result.estado === "sellado") { /* result.selloRecibido, result.representacionGrafica (PDF) */ }
else { /* estado "firmado" (202): repeat with the SAME key and request */ }
for (const line of result.disponible) console.log(line.linea, line.disponible, "left of", line.vendida);
```

- Applies to **01, 11 and 14** issued by this API (other types: use a credit note →
  `return_type_not_allowed`).
- Window: three months from generation or seal (whichever ends first), or two years
  for invoices of certain economic activities. Outside it: `return_window_closed`.
- Several returns over the same invoice are allowed until they add up to what was
  sold; the server keeps the per-line balance (`return_exceeds_available` with
  `details.lineas`).
- Each item has **exactly one** of `cantidad` (> 0) or `noGravado` (non-zero; not
  accepted on type 14). Wrong shapes throw `TypeError` / `RangeError` locally.
- It spends **no control number** but needs an idempotency key and the `signKey`.
  `result.codigoGeneracion` is the code of the *event*; download its files with
  `downloadDocument(eventCode, "json" | "pdf")` (no ticket for a return).
- `getDocumentStatus(invoiceCode)` shows `retornos` and what is still returnable
  (`disponible`).
- The API has a `DELETE …/return/{evento}` to abandon an unsent return; **the SDK
  has no method for it** in this version.
- The first request of a return is as irreversible as an issue: never retry a 202
  with a new key.
