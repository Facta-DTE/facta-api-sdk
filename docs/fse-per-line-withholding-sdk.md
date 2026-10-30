# FSE per-line withholding SDK preflight (unpublished)

Status: local SDK preparation only. The current API does not implement per-line withholding and its request parser may discard these fields. This SDK change must remain unpublished and unused against hosted/current backends until matching API validation and calculation support has been deployed and verified. The coordinator should decide whether a supported capability/version guard is needed to prevent a new SDK from silently issuing against an older or rolled-back backend; this SDK change does not invent a capability contract or add an extra status request.

The opt-in request is `tipoDte: "14"` with `incomeWithholding: { mode: "per_line" }`. Every item must provide a boolean `applyIncomeWithholding`. The legacy `aplicarReteRenta` property must be absent, including when its value is `false`. The SDK preserves legacy absent/false/true requests unchanged and does not infer a selection from `tipoItem`.

The runtime preflight runs before catalog status reads, catalog resolution, transport requests, and archive journal writes in `issue`, `prepare`, and `issueAndArchive`. It does not mutate the request. Direct HTTP clients and older SDK versions still need equivalent authoritative API validation.

## Proposed local error mapping for API alignment

All codes below are proposed stable codes for API/OpenAPI alignment. SDK preflight errors are `FactaError`s with status `0`, indicating no HTTP response was received; `details.field` identifies the invalid path.

| Code | Field path | Condition |
| --- | --- | --- |
| `fse_withholding_mode_invalid` | `incomeWithholding.mode` or `incomeWithholding.<property>` | Mode is missing its `per_line` value, has an unknown value, or includes an unsupported control such as a caller-selected rate or amount. |
| `fse_withholding_legacy_conflict` | `aplicarReteRenta` | Legacy property is an own property with per-line mode, including `false` or `undefined`. |
| `fse_withholding_not_supported` | `incomeWithholding` or indexed line flag | A new withholding control is present on a non-FSE request. |
| `fse_withholding_selection_required` | `items[i].applyIncomeWithholding` | A per-line item is missing its selection. |
| `fse_withholding_selection_invalid` | `items[i].applyIncomeWithholding` | A selection is not a boolean. |
| `fse_withholding_mode_required` | `items[i].applyIncomeWithholding` | A line selection appears without the opt-in mode. |

For malformed legacy booleans or legacy withholding on a non-FSE request, the SDK reuses the API's existing `invalid_request` code and `details.field`; it does not propose changing that server contract. The API should adopt the new `fse_withholding_*` codes and matching field paths for per-line-mode errors. No SDK preflight error should fabricate an HTTP response or imply fiscal eligibility.
