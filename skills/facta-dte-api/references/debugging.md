# Debugging: timings, diagnose, status

Sources: `guides/timings.md`, `guides/diagnose.md`, `guides/region.md`.

## `diagnose()` before the first sale and in health checks

```ts
const report = await facta.diagnose({ dteType: "03", expectedEnvironment: "00" });
if (!report.canIssue) for (const c of report.checks) if (c.state === "blocked") console.error(c.id, c.message);
```

- No vault opened, no number reserved. Calls `GET /v1/status` and `GET /v1/storage/status`.
  An unreadable status does **not** throw: you get a `blocked` report with an `api` check.
- **Decide with `canIssue` / `canQuery` / `canDownload` / `canIssueAndArchive`**; use
  `overall` and messages for humans. `overall` is strict: a production key always adds an
  `environment` warning and a missing archive adds `unknown` checks, so healthy
  integrations often read `"attention"`.
- Options: `archive`, `dteType`, `expectedEnvironment`, `requiredScopes` (also from
  `config`). Check ids include `api`, `issuer`, `scope-*`, `environment`,
  `issue-quota`, `key-expiry`, `dte-type`, `certificate-*`, `signing`, `sign-sync`,
  `destinations-sync`, `catalog-sync`, `managed-storage`, `archive`, `emergency-store`.
  Switch on `id` and `state` (`ok | warning | blocked | unknown`), never on message text.
- Typical blocks: `signing` → key has no signing vault (re-mint); `managed-storage` →
  no ready destination; `configured-environment` → live key where you expected `00`.
- `catalogState()` for the catalog; `diagnoseDestinations()` for remote copies.

## Slow call: `X-Facta-Debug: timings`

```ts
const result = await facta.issue(request, { idempotencyKey, debug: { timings: true } });
for (const { step, ms, startedAtMs } of result.debug?.timings ?? []) console.log(step, ms, startedAtMs);
console.log(result.debug?.totalMs, result.debug?.source); // "body" | "server-timing"
```

- Client-wide: `new Facta({ debug: { timings: true } })`; per call wins.
- A **debugging aid**: turn it off in production code (responses grow, internal step names
  reach your logs).
- Accepted by `issue`, `prepare`, `sign`, `status`, `getDocumentStatus`, `deliverEmail`,
  `deliverWhatsApp`, `getDelivery`, `waitForDelivery`. Downloads and `FactaError` carry no timings.
- Steps nest and overlap (`auth`, `idempotency_claim`, `vault_open`, `jws_sign`,
  `mh_transmit`, `pdf_render`, `index_write`, …); do not sum them, compare `startedAtMs`.
- The most common cause of slowness is region: check `await facta.region()`,
  `facta.servedRegion`, and pass `region` explicitly in serverless code.
- Hacienda itself can take ~40 s; keep `timeoutMs` at its 60 s default.

## Reading a status check

`status()` → `ambiente`, `emisor`, `llave` (`alcances`, `tiposDte`, `venceEl`,
`catalogMode`), `firma` (public certificate facts: validity, NIT), `sincronizacion`
(sign / destinations / catalog revisions), `limites` (`hora`, `dia`, `estado`,
`montoMaximoPorDocumentoCentavos`). `/v1/status` has its own generous rate window.
