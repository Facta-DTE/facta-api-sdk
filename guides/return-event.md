# Returns (Evento de Retorno)

[Spanish guide](return-event.es.md) · [English README](../README.md) · [Method reference](reference.md)

When a customer gives back part of what they bought, Hacienda's Normativa 2.0
records it with a **return event** (Evento de Retorno, CAT-002 code 18). It does
not invalidate or erase the invoice: it is its own signed document, with its own
generation code and its own seal, applied to a sealed invoice. `registerReturn`
registers one through the API.

## When you can register a return

- The document is a **Factura (01)**, a **Factura de Exportación (11)** or a
  **Factura de Sujeto Excluido (14)**, sealed, and **issued by this API**.
  Other types are corrected with a credit note (`return_type_not_allowed`).
- The event date is within the **return window**: three months from when the
  document was generated or sealed (whichever ends first), or two years for
  invoices of certain economic activities. `fechaEvento` defaults to today in
  El Salvador and cannot be earlier than the document nor later than the window
  (`return_window_closed`).
- What you return fits in what is left. You can register **several returns**
  over the same document until they add up to what was sold; Facta keeps the
  per-line balance and refuses an excess before signing
  (`return_exceeds_available`).

A return **spends no control number**, but it still needs an idempotency key: a
retried request must not subtract the same units twice. The SDK sends
`signKey`; the event is signed with the issuer's certificate.

## The request

`registerReturn(generationCode, request, options?)` takes the generation code of
the **original document** and a `ReturnRequest`:

```ts
interface ReturnRequest {
  items: ReturnItem[];
  fechaEvento?: string; // "YYYY-MM-DD"
}
type ReturnItem =
  | { linea: number; cantidad: number }   // units that come back from that line
  | { linea: number; noGravado: number }; // a non-taxable charge (+) or credit (-)
```

- **Lines are counted from 1**, the way a person reads the invoice.
- Each item carries **exactly one** of `cantidad` (greater than zero; price,
  description and taxes are copied from the original, and its discount is
  prorated) or `noGravado` (non-zero; it moves only the total to pay, cannot
  exceed what the line carried nor have the opposite sign, and a Factura de
  Sujeto Excluido does not accept it).

The SDK checks these shapes before sending and throws `TypeError` /
`RangeError` (at least one item, integer `linea` from 1, exactly one of the two
amounts, `fechaEvento` as `YYYY-MM-DD`).

```ts
import { Facta, FactaError } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

const result = await facta.registerReturn(invoiceCode, {
  items: [{ linea: 1, cantidad: 2 }, { linea: 3, cantidad: 1 }],
}, { idempotencyKey: `return:${rmaId}` });

if (result.estado === "sellado") {
  console.log("Return sealed:", result.codigoGeneracion, result.selloRecibido);
} else {
  // estado "firmado": Hacienda did not answer. Repeat with the SAME key and request.
  console.log("Signed, pending Hacienda:", result.detalle);
}
for (const line of result.disponible) console.log(`line ${line.linea}: ${line.disponible} left of ${line.vendida}`);
```

## The result

`ReturnResult` is `ReturnSealed | ReturnPending`. Both carry:

| Field | Meaning |
| --- | --- |
| `codigoGeneracion` | The code of the **return event**, not of the invoice. |
| `documentoRelacionado` | `{ codigoGeneracion, numeroControl, tipoDte, fecEmi }` of the invoice. |
| `totales` (`ReturnTotals`) | `totalGravada`, `totalExenta`, `totalNoSuj`, `totalIva`, `totalPagar` of the event. |
| `documento`, `jws`, `archivoJson` | The event document, its signature and its exact JSON bytes. Store `archivoJson` as-is. |
| `disponible` (`ReturnAvailability[]`) | Per line, what is left **already counting this return**: `vendida`, `devuelta`, `disponible`, and `noGravado` balances. |
| `almacenamiento` | `"retencion"` or `"ninguno"`, when reported. |

- **`ReturnSealed`** (`estado: "sellado"`, HTTP 200) adds `selloRecibido`,
  `fhProcesamiento`, `observaciones`, `representacionGrafica` (letter-size PDF
  as base64, or `null` when it could not be drawn), `storage`,
  `storageErrorCode` and `anotadoEnElLibro` (`false` when Hacienda registered
  it but Facta's book has not noted the verdict yet).
- **`ReturnPending`** (`estado: "firmado"`, HTTP 202) adds `detalle`. The event is
  signed and recorded, and its units already count as returned. Repeat the call
  with the **same** `idempotencyKey` and request: the server resends exactly
  the same `jws`; it never builds a second event.

## Reading returns later

`getDocumentStatus(invoiceCode)` includes, for 01, 11 and 14:

- `retornos` (`ReturnSummary[]`, newest first): each event's code, `estado`
  (`firmado`, `sellado` or `rechazado`; a rejected one subtracts nothing),
  `fecha`, `selloRecibido`, `totales` and `lineas`.
- `disponible` (`ReturnAvailability[] | null`): what is still returnable per
  line; `null` when the API does not hold the document's signed JSON (it was
  issued from the Facta app) or the document is no longer in force.

```ts
const status = await facta.getDocumentStatus(invoiceCode);
for (const r of status.retornos ?? []) console.log(r.codigoGeneracion, r.estado, r.totales.totalPagar);
const pdf = await facta.downloadDocument(result.codigoGeneracion, "pdf"); // the event's own letter-size PDF
```

The event's files are downloaded with **its own** code through
`downloadDocument(eventCode, "json" | "pdf")`. There is no ticket for a return
event.

## Returns and invalidation

A document with **sealed** return events can no longer be invalidated:
`invalidate` answers `has_return_events` (HTTP 409) because Hacienda refuses it
(Anexo V 44.4). Correct it with more returns or a credit note instead. A return
that stayed `firmado` and never reached Hacienda does not block invalidation; the
server abandons it automatically after 72 hours without a verdict. The API also
has `DELETE /v1/dte/{codigoGeneracion}/return/{evento}` to abandon one sooner;
**the SDK has no method for it** in this version.

## What can go wrong

| Code | HTTP | Meaning and what to do |
| --- | --- | --- |
| `return_exceeds_available` | 422 | More than what is left of a line. `details.lineas` lists, per line (from 1), `linea`, `solicitado` and `disponible`. Ask for at most the available amount; nothing was signed. |
| `return_window_closed` | 422 | `fechaEvento` is before the document, in the future, or after the window. Past the window the document no longer admits a return. |
| `return_type_not_allowed` | 422 | The document is not 01, 11 or 14. Use a credit note. |
| `return_pdf_unavailable` | 404 | The event's PDF cannot be drawn any more (its signed JSON is gone), or a ticket was asked for. Use `representacionGrafica` from the original response or your stored copy. |
| `has_return_events` | 409 | `invalidate` on a document with sealed returns. |
| `validation_failed` | 422 | The document has no seal, is invalidated, or the event fails the official schema. |
| `mh_rejected` | 422 | Hacienda read the return event and refused it; its units go back to the balance. |
| `not_found` | 404 | No such document for this key's company. |

A `TypeError` or `RangeError` before any request means the local shape check
failed. Never retry a 202 with a new key: that would try to return the same
units again.

## Related

- [Idempotency patterns](idempotency.md) · [Error catalogue](errors.md#returns)
- [The Archivo DTE](archivo-dte.md) · [Method reference](reference.md)
