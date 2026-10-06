# Changelog

## 0.5.0 (unreleased)

### Behaviour change: the default JSON download is the Archivo DTE

- `downloadDocument(code, "json")` now returns the **Archivo DTE** by default (the signed document plus `firmaElectronica` and `selloRecibido`), not the stored holding JSON `{codigoGeneracion, ambiente, jws}`. Code that archived or verified the old shape from this call must pass `{ raw: true }` to keep receiving it. The result reports which one it got in `jsonFormat` (`"archivo-dte"` or `"raw"`, from `X-Facta-Json-Format`; absent on API servers that predate it).
- `FactaDownloadButton`, `FactaReceipt` and the sealed window: «Descargar JSON» gives the Archivo DTE.

### Added

- `archivoDte?: string` on sealed results: the exact UTF-8 Archivo DTE. Absent in contingency.
- `archivoDteOf(result)`: returns `archivoDte`, or builds the same bytes from `documento` + `jws` + `selloRecibido` for an API that has not deployed the field yet; `null` without a seal.
- `downloadDocument(code, "json", { raw: true })`; `raw` is rejected locally for `pdf` and `ticket`.
- Error code `not_sealed` (HTTP 409): JSON download of a document with no Hacienda seal. Use `raw: true`.
- React: optional `rawJson` prop on `FactaReceipt` and `FactaDownloadButton` adds «JSON original (raw)». Server handler: `capabilities.rawJson` (default `false`) gates `raw` in `documents.download`; the issue response includes `archivoDte` whenever downloads are allowed.

### Unchanged

- `archivoJson`, `jws`, `documento`, local archives, remote replication and copy reports store and report exactly what they did before.
