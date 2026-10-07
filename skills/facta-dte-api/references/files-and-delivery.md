# Files (Archivo DTE, PDF, ticket), listing and delivery

Sources: `guides/archivo-dte.md`, `guides/delivery.md`, `guides/node.md`,
`README.md`, `CHANGELOG.md`, `src/types.ts`, `src/client.ts`, contract
(`descargarDocumentoRetenido`, `listarDte`, `entrega`).

## Two JSON files, two purposes

| | Archivo DTE | Stored original ("raw") |
| --- | --- | --- |
| Shape | the document's keys, then `firmaElectronica` (the JWS byte for byte), then `selloRecibido`; two-space pretty print | `{ codigoGeneracion, ambiente, jws }` |
| In a sealed issue result | `result.archivoDte` | `result.archivoJson` |
| Download | `downloadDocument(code, "json")` (**the default since 0.5.0**) | `downloadDocument(code, "json", { raw: true })` |
| Give it to | the receiver, the accountant, another system's import | your own archive (this is what local archives and replication store) |
| In contingency | does not exist (no seal) | exists |

```ts
import { archivoDteOf } from "@facta-dte/api";
import { writeFile } from "node:fs/promises";

if (result.estado === "sellado") {
  const archivo = archivoDteOf(result);   // archivoDte, or built from documento + jws + selloRecibido; null without a seal
  if (archivo !== null) await writeFile(`${result.codigoGeneracion}.json`, archivo);
  if (result.archivoJson) await writeFile(`${result.codigoGeneracion}.raw.json`, result.archivoJson);
}
const file = await facta.downloadDocument(code, "json");               // Archivo DTE
const original = await facta.downloadDocument(code, "json", { raw: true });
console.log(file.jsonFormat, original.jsonFormat);                      // "archivo-dte" "raw" (undefined on servers that predate the header)
```

- **Behaviour change in 0.5.0:** the default JSON download used to be the stored
  original. Code that archived or verified the old shape from `downloadDocument`
  must pass `{ raw: true }`.
- `raw` is only valid for `"json"`; with `"pdf"` or `"ticket"` the SDK throws
  `TypeError` before sending.
- A document without a seal: default JSON download → `409 not_sealed`.
- Never re-serialize `documento` yourself: the signature covers the JWS bytes.
- A document issued from the Facta web app may not be re-armable by the API
  (`not_found`).
- Save `file.bytes` (`Uint8Array`) as is; `file.filename` is the suggested name.

## PDF and ticket

- The sealed result already carries the letter-size PDF in `representacionGrafica`
  (base64, `null` when it could not be drawn). Later:
  `downloadDocument(code, "pdf")`.
- **Ticket** (thermal roll): `downloadDocument(code, "ticket", { paperWidthMm })`.
  `paperWidthMm` is an integer **40–120**, default **80**; the SDK throws
  `TypeError` outside that range, and when `paperWidthMm` is passed for a non-ticket
  kind. The ticket is regenerated on each request from the already sealed
  API-issued document with the company's current ticket template; it never issues
  again and does not replace the JSON/JWS. Not available for documents issued from
  the web app, nor for return events (`return_pdf_unavailable`). Default width for
  the client: `config.ticketPaperWidthMm`; for archives: `issueAndArchive`'s
  `ticketPaperWidthMm` (and `includeTicket: false` to skip the ticket).
- `downloadDocument(code, "pdf", { source: "managed" })` demands the managed copy
  (no fallback); an old server answers `storage_unsupported`. `file.storageSource`
  reports `managed`, `holding` or `archive`.
- `facta.print(downloadedPdfOrTicket, transport)` submits to **your**
  `PrintTransport`; the result is `submitted` or `unknown`, never "printed", and an
  `unknown` job is not retried automatically.

## Listing documents

```ts
let cursor: string | undefined;
do {
  const page = await facta.listDocuments({ desde: "2026-10-01", hasta: "2026-10-31", tipoDte: "03", limit: 100, ...(cursor ? { cursor } : {}) });
  for (const row of page.documentos) { /* codigoGeneracion, numeroControl, estado, fecEmi, totales, receptor? */ }
  cursor = page.siguiente ?? undefined;
} while (cursor);
```

- Filters: `desde`, `hasta` (emission date, inclusive), `estado`
  (`contingencia | firmado | invalidado | sellado`), `tipoDte`, `limit` (default 50,
  max 100), `cursor`.
- Pagination is by **opaque cursor**: pass `siguiente` back untouched until it is
  `null`. Scope `query`.
- Rows are summaries (no signed JSON). `receptor` can carry name and document
  number or be `null` (documents encrypted in the app or imported); treat it as
  personal data and keep it out of general logs.
- **Rejected documents are not listed** (a rejection is not a fiscal document).
  If reconciliation shows a gap in your numbering, query that code with
  `getDocumentStatus`.
- `listDocuments({ include: ["dte"], limit })` returns each row with its `archivoDte` and a
  `resumen` (`{ receptor, lineas, primeraDescripcion, totalIva, totalPagar }`) in one call.
  The page is 20 rows by default and **25 at most** (`include_limit_exceeded`, 400, with
  `details.maximo`); it needs the `download` scope. A row the API cannot open
  (`needs_local_decrypt`: documents encrypted in the app or imported) is completed locally
  from your destinations when `unlockKey` is set, with bounded concurrency; otherwise (or on
  failure) the row carries a `dteError` and the listing never fails. The PDF and ticket are
  never in the list. `summarizeArchivoDte(archivoDte)` (exported, pure) reads the same summary
  from a legal document you already hold. Check the installed `types.ts` for `include`: it
  arrived with 0.5.0.

## E-mail and WhatsApp delivery: mark, then start

The SDK sends nothing itself; the API does. Issuing never waits for delivery and a
failed channel is a **state**, never a failed issuance.

1. **Mark** channels when issuing. The sealed result carries
   `entrega: { token, venceEn, canales }`.
2. Within **5 minutes of issuance**, start each channel with its own call.
3. Read final states with `getDelivery` / `waitForDelivery` (also after the token
   expired).

```ts
const result = await facta.issue(sale, {
  idempotencyKey: `order-${order.id}`,
  deliver: { email: true, whatsapp: { number: "+50370000000", consent: true } },
});
const token = result.estado === "sellado" ? result.entrega?.token : undefined;
if (token) {
  await facta.deliverEmail(result.codigoGeneracion, token);       // call 1
  await facta.deliverWhatsApp(result.codigoGeneracion, token);    // call 2 (only if marked)
  const status = await facta.waitForDelivery(result.codigoGeneracion, { timeoutMs: 30_000 });
  for (const [channel, state] of Object.entries(status.canales)) { /* state.estado, state.motivo, state.destino (masked) */ }
}
```

- `deliver.email`: `true` (uses `receptor.correo`) or an address (delivery only; the
  document keeps `receptor.correo`). `deliver.whatsapp`: `{ number: "+503…",
  consent: true }` — `consent: true` is **your attestation** that the receiver
  agreed; it is stored with the key id and masked number. The SDK throws
  `TypeError` if no channel is marked, the number does not look like a phone, or
  `consent` is not literally `true`.
- `deliver` is part of the idempotency fingerprint: changing it with the same key
  is `idempotency_key_reuse`; replaying the same request returns the same token
  while it is valid.
- **The token is a bearer secret**: keep it on your server, never send it to a
  browser. It is **absent** for contingency documents and when no marked channel is
  deliverable (check `canales` for `no_permitido` / `sin_consentimiento`). There is
  no way to obtain a new one after 5 minutes: deliver late documents from the Facta
  app or by your own means.
- States: `pendiente`, `en_proceso` (non-final); `enviado`, `fallido`,
  `sin_credito` (WhatsApp prepaid wallet empty), `sin_consentimiento`,
  `no_permitido` (key lacks the channel scope), `vencido` (token expired),
  `esperando_sello` (contingency). `motivo` is a stable code (`smtp_rejected`,
  `invalid_address`, `wallet_empty`, `provider_unavailable`, `quota_exceeded`,
  `consent_not_attested`, `scope_missing`, `token_expired`, …); treat unknown codes as
  a generic failure.
- `isDeliveryLimitReason(motivo)` (`quota_exceeded`, `provider_unavailable`): the
  message could not go out *right now*; the document is issued — show a warning and
  offer the PDF/JSON.
- A second `deliverEmail` for the same channel returns the current state, no second
  message. `waitForDelivery` returns `settled: false` on timeout instead of throwing;
  do not list a channel you did not mark (it would wait until `timeoutMs`).
- Errors: `entrega_vencida` (410), `entrega_token_invalido` (401), `canal_no_marcado`
  (409). Never re-issue because a channel failed.
- WhatsApp is billed to the company's prepaid wallet; the message is the approved
  template plus the document, nothing else. E-mail counts against the company's
  e-mail quota. A key with `issue` may mark and deliver both channels; a key with
  only `entrega:correo` / `entrega:whatsapp` keeps just that channel.
- Through the web window, put `deliver` in the session your server creates; the
  handler starts the channels and gives the browser a `deliveryHandle` instead of
  the token (see browser-and-react.md).
