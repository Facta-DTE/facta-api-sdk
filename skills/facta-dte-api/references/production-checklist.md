# Going to production

Sources: contract (`info.description`), `guides/*`, `CHANGELOG.md`, `RELEASING.md`.

Work through it in order; do not skip because the test environment "worked".

1. **The company is in production.** A `facta_live_` key can only be minted for a
   company that completed its own step to production in the Facta DTE app (real
   certificate and transmission credential). Otherwise `environment_not_allowed`.
2. **New key, new secrets.** Mint a production key with the *minimum* scopes
   (`issue`, `query`, `download`, … only what you use), only the DTE types you
   need, an expiry, an IP allow-list (CIDR), and a maximum amount per document.
   Store `FACTA_API_KEY` / `FACTA_SIGN_KEY` (and `FACTA_UNLOCK_KEY` if used) in the
   production secret manager. Test keys are not reused. Nothing in the repo, image,
   client bundle or logs.
3. **Same code path, different key.** The base URL is the same; the key selects the
   environment. Guard with `config: { version: 1, expectedEnvironment: "01" }` in
   production and `"00"` elsewhere, and fail startup on a mismatch.
4. **Run `diagnose()`** at deploy time and in a health check (`canIssue`,
   `storageReady`, certificate validity, key expiry within 72 h, quota).
5. **Idempotency keys come from stored business ids** and are persisted before the
   first attempt. Webhook handlers are idempotent.
6. **Uncertain results are replayed, never re-issued.** A job reconciles
   contingencies with `getDocumentStatus`; `issueAndArchive` + a startup
   `recoverOperation` loop if you need crash safety.
7. **Errors:** branch on `code`; rejections surface Hacienda's text verbatim;
   contingency shown as success; delivery/storage trouble shown as warnings.
8. **Files:** store the Archivo DTE or `archivoJson` exactly as returned; keep the PDF;
   at least two copies in places you control. Decide what happens with
   `sin_almacenamiento_duradero` (an `emergencyStore`, alerting).
9. **Delivery:** only mark WhatsApp with real consent (`consent: true` is your
   attestation). Start channels within 5 minutes; keep the token server-side.
10. **Personal data:** do not log receivers, DUI/NIT or listing rows. Browser handler:
    leave `exposeRecipient` off unless needed; `authorize` is real; `sessionSecret`
    is a strong server secret.
11. **Limits:** respect `RateLimit-*` / `Retry-After`; back off on `rate_limited`.
12. **Invalidation and returns** need confirmation UX; invalidation is irreversible.
13. **Pin the SDK version** in your lockfile; `0.5.0` behaviour change: default JSON
    download is the Archivo DTE.
14. **First production document:** issue one real, small document with a designated
    receiver, verify the seal, the files, the e-mail and the stored copies, before
    opening to customers.
15. **Remove debugging:** `debug.timings` off; no verbose HTTP logging with headers.
