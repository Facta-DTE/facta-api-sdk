# The Archivo DTE: the file your customer receives

[Spanish guide](archivo-dte.es.md) · [English README](../README.md) · [Method reference](reference.md)

When Hacienda seals a document, the receiver (your customer, their accountant)
expects one JSON file: the **Archivo DTE**. It is the signed document with two
members appended: `firmaElectronica` (the compact JWS, byte for byte) and
`selloRecibido` (Hacienda's seal). This guide explains where the SDK gives you
that file, how it differs from the stored original, and what happens when there
is no seal yet.

## Two JSON files, two purposes

| | Archivo DTE | Stored original ("raw") |
| --- | --- | --- |
| Shape | the document's own keys, then `firmaElectronica`, then `selloRecibido`, pretty-printed with two spaces | `{ codigoGeneracion, ambiente, jws }` |
| Where in a sealed result | `result.archivoDte` (string) | `result.archivoJson` (string) |
| Download | `downloadDocument(code, "json")` (default) | `downloadDocument(code, "json", { raw: true })` |
| Give it to | the receiver, an accountant, an import into another system | your own archive; it is what the SDK and the local archive store |
| Exists in contingency | no (there is no seal) | yes |

The local archive (`issueAndArchive`), BYOS replication and the emergency
safeguard keep storing the stored original exactly as before. Changing the
default download did not change what is archived.

## From an issue result

`SealedDte.archivoDte` is the exact UTF-8 text the API built. It is absent in
contingency and on API servers that predate the field. `archivoDteOf(result)`
returns `archivoDte` when present; otherwise it builds the same bytes from
`jws` + `selloRecibido` (taking the document from the JWS payload, falling back
to `documento`), or returns `null` when there is no seal.

```ts
import { Facta, archivoDteOf, type DteRequest } from "@facta-dte/api";
import { writeFile } from "node:fs/promises";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });
const sale: DteRequest = { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2.5 }] };

const result = await facta.issue(sale, { idempotencyKey: "order-1042" });
if (result.estado === "sellado") {
  const archivo = archivoDteOf(result); // string, never null for a sealed result with jws + seal
  if (archivo !== null) await writeFile(`${result.codigoGeneracion}.json`, archivo);
  // Keep the stored original too, for your archive:
  if (result.archivoJson) await writeFile(`${result.codigoGeneracion}.raw.json`, result.archivoJson);
}
```

`archivoDteOf` is exported from the root package and from
`@facta-dte/api/browser`. It is pure and has no dependencies.

## Downloading later

`downloadDocument(code, "json")` returns the Archivo DTE by default.
`{ raw: true }` returns the stored original and is accepted only for `"json"`
(the SDK throws `TypeError` for `"pdf"` or `"ticket"` before sending anything).
`jsonFormat` tells you which one the server sent, read from the
`X-Facta-Json-Format` header; it is `undefined` on servers that predate the
header.

```ts
const file = await facta.downloadDocument(code, "json");
const original = await facta.downloadDocument(code, "json", { raw: true });

console.log(file.jsonFormat);     // "archivo-dte"
console.log(original.jsonFormat); // "raw"
const text = new TextDecoder().decode(file.bytes);
```

`file.bytes` is a `Uint8Array` with the exact server bytes, `file.filename` the
suggested name (or `null`) and `file.storageSource` the place the server read it
from (`managed`, `holding` or `archive`) when the server reports it.

## Contingency and `not_sealed`

A document in contingency is signed but has no `selloRecibido`, so it has no
Archivo DTE: the issue result has no `archivoDte`, `archivoDteOf` returns `null`
and the default JSON download answers `FactaError` with code `not_sealed`
(HTTP 409, `details.estado` names the state). Ask for the stored original
instead, and fetch the Archivo DTE once `getDocumentStatus` says `sellado`.

```ts
import { FactaError } from "@facta-dte/api";

try {
  await facta.downloadDocument(code, "json");
} catch (error) {
  if (error instanceof FactaError && error.code === "not_sealed") {
    const original = await facta.downloadDocument(code, "json", { raw: true });
    // Store `original.bytes`; try the Archivo DTE again after the seal arrives.
  } else {
    throw error;
  }
}
```

## React components and the server handler

`FactaReceipt`, `FactaDownloadButton` and the sealed window give the Archivo DTE
as «Descargar JSON». Passing the `rawJson` prop adds a second entry, «JSON
original (raw)». The browser cannot get the stored original unless your server
handler also allows it with `capabilities.rawJson: true` (default `false`);
otherwise `documents.download` with `raw` answers `403 action_not_allowed`. The
issue response the handler sends to the browser includes `archivoDte` whenever
downloads are allowed for that session.

```ts
import { createFactaHandler } from "@facta-dte/api/server";

export const handler = createFactaHandler({
  facta,
  sessionSecret: process.env.FACTA_SESSION_SECRET!,
  authorize: (req) => isLoggedIn(req),
  capabilities: { downloads: ["pdf", "json"], rawJson: true },
});
// In React: <FactaDownloadButton codigoGeneracion={code} rawJson />
```

See [react.md](react.md) and [react-server.md](react-server.md#capabilities)
for the full component and capability lists.

## What can go wrong

- **`not_sealed` (409)** on a default JSON download: the document is in
  contingency. Use `{ raw: true }` or wait for the seal.
- **`TypeError: raw is only valid when downloading kind=json`**: `raw` was
  passed with `"pdf"` or `"ticket"`.
- **`jsonFormat` is `undefined`**: the API server predates the header. Do not
  assume either format; inspect the JSON (`firmaElectronica` present means an
  Archivo DTE).
- **Code that verified the old download shape breaks**: since 0.5.0 the default
  JSON download is the Archivo DTE. Pass `{ raw: true }` to keep receiving
  `{ codigoGeneracion, ambiente, jws }`.
- **Re-serializing `documento` yourself**: do not. The signature covers the
  bytes in the JWS; use `archivoDte`, `archivoDteOf` or the download.
- **A document issued from the Facta web app**: the API may not hold its signed
  JSON; downloads can answer `not_found`.

## Related

- [Delivery by e-mail and WhatsApp](delivery.md): the API sends the document to
  the receiver for you.
- [Emergency safeguard](emergency.md): `files.archivoDte` and `files.jsonRaw`.
- [Error catalogue](errors.md) · [Method reference](reference.md)
