# Changelog

## 0.5.0 (unreleased)

### Emergency safeguard

- New `runtime.emergencyStore(files, info)`: your function, called only when Facta could not store a sealed document durably (server warnings `sin_almacenamiento_duradero`, `sin_copia_en_servidor`, `copia_solo_temporal`, or any `sin_*` / `*temporal*` code), when every replication destination failed, or when `issueAndArchive` finds no destination at all. Once per `codigoGeneracion`; never on a normal issue and never on a timer. The SDK ships no storage of its own and sends bytes nowhere else.
- `files` is `{ archivoDte?, jsonRaw, pdf }` (from the response, or downloaded from the one-hour holding copy when the response lacks them); `info` is `{ codigoGeneracion, numeroControl, tipoDte, ambiente, fecEmi, reason, warnings, occurredAt }`.
- Results carry `emergency: { saved, reason, trigger, detail }` and an `sdkWarnings` entry `emergency_saved` / `emergency_failed` (`ArchiveEmissionResult.warnings` too). Not configured gives `reason: "not_configured"` (no `sdkWarnings`); a throwing function gives `"store_failed"`. Neither ever fails or hides the sealed result.
- `emergencyStore` is optional and a missing one raises no warning; `diagnose()` lists it as an informational `emergency-store` check that never changes `overall`. Without it the server still e-mails the company owner a backup copy when nothing could be stored.
- Optional `runtime.onEmergency(event)` for alerting; `facta.emergency.replicate(files, info)` re-tries normal replication from files your store kept.
- Server handler forwards `emergency: { saved, reason }` to the browser; React `FactaReceipt` and the sealed window show a banner and keep the downloads.
- Depends on the server adding `advertencias` with those codes; until then the safeguard fires only on the SDK's own triggers. Guide: `guides/emergency.md` / `emergency.es.md`.

### Behaviour change: the default JSON download is the Archivo DTE

- `downloadDocument(code, "json")` now returns the **Archivo DTE** by default (the signed document plus `firmaElectronica` and `selloRecibido`), not the stored holding JSON `{codigoGeneracion, ambiente, jws}`. Code that archived or verified the old shape from this call must pass `{ raw: true }` to keep receiving it. The result reports which one it got in `jsonFormat` (`"archivo-dte"` or `"raw"`, from `X-Facta-Json-Format`; absent on API servers that predate it).
- `FactaDownloadButton`, `FactaReceipt` and the sealed window: «Descargar JSON» gives the Archivo DTE.

### Added

- `archivoDte?: string` on sealed results: the exact UTF-8 Archivo DTE. Absent in contingency.
- `archivoDteOf(result)`: returns `archivoDte`, or builds the same bytes from `documento` + `jws` + `selloRecibido` for an API that has not deployed the field yet; `null` without a seal.
- `downloadDocument(code, "json", { raw: true })`; `raw` is rejected locally for `pdf` and `ticket`.
- Error code `not_sealed` (HTTP 409): JSON download of a document with no Hacienda seal. Use `raw: true`.
- React: optional `rawJson` prop on `FactaReceipt` and `FactaDownloadButton` adds «JSON original (raw)». Server handler: `capabilities.rawJson` (default `false`) gates `raw` in `documents.download`; the issue response includes `archivoDte` whenever downloads are allowed.

### Performance: regional pinning

- The client sends `x-region` on every request so Edge Functions run next to the database (`us-west-2`) instead of near the caller: `POST /v1/dte` measured 7.2 s to 4.3 s. The region is read once from `GET /v1/status` (`region`), lazily and shared by concurrent calls; an API that does not advertise one falls back to `us-west-2` for both environments.
- New `region` option (string, or `false` to disable) in the constructor, `config.region` and `FACTA_API_REGION`. A failed discovery never fails an operation.
- New `facta.region()`, `facta.servedRegion`, `diagnose().region` / `.servedRegion` (from `x-sb-edge-region`), and optional `Status.region` / `Status.servedRegion`.
- Client code that counts requests will see one extra `GET /v1/status` before the first call; pass `region: false` to avoid it.

### Unchanged

- `archivoJson`, `jws`, `documento`, local archives, remote replication and copy reports store and report exactly what they did before.
