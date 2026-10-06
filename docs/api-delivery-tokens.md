# API delivery: e-mail and WhatsApp after issuance, with a delivery token

Status: plan, 5-Oct-2026. Two pull requests:

* **factadte** (this monorepo, branch `feat/api-delivery-tokens`, PR to
  `staging`): API contract, `api-v1` routes, migration, server-to-server
  delivery through the existing `send-document` and `whatsapp-send-document`
  paths.
* **facta-api-sdk** (branch `feat/sdk-delivery`, merged into
  `feat/react-signing-ui`, PR to `dev`): client methods, types, the React
  window handler action and the delivery rows in the window.

Original prompts (Marvin, verbatim):

> que pasa con el envio automatico de correo y whatsapp? se envian desde el
> server ya enviando alguna banderita? o se va a poder hacer luego? validemos
> como tenemos eso

> ok, hay que implementarlo, ademas si se pone whatsapp solo hay que reportar
> en el estado que no se pudo enviar, igual que el correo, ahora, como eso
> puede ser bloqueante, hay que ver una forma de recibir la respuesta luego o
> hacer un request que permita saber que paso, oprque eso puede tomar mucho
> tiempo y bloquear la solicitud principal, en el server se rea como un
> "token" de entrega que puede ser llamado luego, ese token solo dura 5
> minutos, luego de emitir, se puede solicitar el envio por correo y el envio
> por whatsapp desde el sdk, es decir en la request se marca el valor pero son
> dos peticiones diferentes, uno para emitir y otro para entregar en correo, o
> en whataapp si tiene credito, esto ultimo me gusta mucho mas, crea el plan y
> lanza agente sen sonnet que hagan los cambios, son dos pr uno para apisdk y
> otro para factadte

## 1. What exists (validated 5-Oct-2026)

* `api-v1` issues, signs, seals and renders the PDF server-side. It never
  calls a delivery function. `receptor.correo` is only the fiscal field.
* `send-document` (e-mail via Facta's service or the company's own SMTP) and
  `whatsapp-send-document` (WhatsApp Cloud, prepaid wallet, consent) accept
  only a **user session** (member of the company). No API-key path.
* The web app's automatic e-mail (`EmisionResultadoScreen`) and automatic
  WhatsApp (`ResultActionRow`, wallet `autoSend`) are triggered by the
  browser after issuance, not by the server.
* The SDK sends neither (README: «The SDK does not send WhatsApp messages»).

## 2. Decisions (Marvin, 5-Oct-2026)

* **D-1 Explicit only.** The API delivers only what the issue request marks.
  Company web preferences (e-mail on by default) do not apply to API issuance.
* **D-2 Issuance never blocks on delivery.** Issuing and delivering are
  separate requests. The issue request only *marks* the channels.
* **D-3 Delivery token.** A sealed issuance that marked at least one channel
  returns a delivery token valid **5 minutes** from issuance. Delivery
  requests must present it.
* **D-4 One request per channel.** E-mail and WhatsApp are two different
  requests, each optional.
* **D-5 Failures are states, not errors.** A channel that cannot be delivered
  (bad address, SMTP refused, no WhatsApp credit, no consent, provider down)
  is reported in the delivery status with a reason code. Issuance success is
  never affected.
* **D-6 WhatsApp is billed to the company's prepaid wallet**; without credit
  the state is `sin_credito`. Content is the approved template plus the
  document only — no promotional content (standing rule).
* **D-7 Long work does not hold the request.** A delivery request answers
  within a short deadline; if the provider is slower it answers
  `202 en_proceso` and the result is read later with the status route.

## 3. API contract (additive, `openapi.yaml`)

### 3.1 Issue request

`POST /v1/dte` gains optional `entrega`:

```json
"entrega": {
  "correo": true,                       // or an explicit address string
  "whatsapp": { "numero": "+50370000000", "consentimiento": true }
}
```

* `correo: true` uses `receptor.correo`; a string overrides it for delivery
  only (the fiscal document keeps `receptor.correo`).
* `whatsapp.consentimiento` is the integrator's attestation that the
  receiver agreed to receive documents by WhatsApp. It defaults to `true`
  when omitted (asking for WhatsApp is the attestation); only an explicit
  `false` leaves the channel `sin_consentimiento`. The SDK's `deliver.whatsapp`
  helper still requires `consent: true` to be written out. (If `whatsapp-send-document` already has a consent
  model — the `attest` action — reuse its record; the attestation is stored
  with the API key id, timestamp and masked number.)
* Delivery is part of issuing: any key with the `issue` scope may mark and
  deliver both channels. A key minted with only `entrega:correo` /
  `entrega:whatsapp` keeps that one channel; a key with neither the `issue`
  scope nor the channel scope still issues, and the channel state is
  `no_permitido`.
* Idempotency: `entrega` is part of the request fingerprint.

### 3.2 Issue response

A sealed result gains:

```json
"entrega": {
  "token": "fdt_…",                 // opaque, 32 random bytes, base64url
  "venceEn": "2026-10-05T18:05:00Z", // issuance + 5 min
  "canales": {
    "correo":   { "estado": "pendiente", "destino": "m•••@ejemplo.com" },
    "whatsapp": { "estado": "pendiente", "destino": "+503 •••• 0000" }
  }
}
```

A contingency result gets `canales.*.estado = "esperando_sello"` and **no
token** (D-8 below). Unmarked channels are omitted. Replaying the same
idempotent request returns the same token while it is valid.

### 3.3 Delivery routes

```
POST /v1/dte/{codigoGeneracion}/entrega/correo      { "token": "fdt_…" }
POST /v1/dte/{codigoGeneracion}/entrega/whatsapp    { "token": "fdt_…" }
GET  /v1/dte/{codigoGeneracion}/entrega             (API key; token optional)
```

* Auth: the API key (same company) **and** the token for the POSTs. Token is
  stored hashed (SHA-256), bound to company, generation code, environment and
  the marked channels; it expires 5 minutes after issuance. A POST after
  expiry → `410 entrega_vencida` and the channel state becomes `vencido`.
* Each POST is idempotent per channel: the first call starts the send, later
  calls return the current state (no second message).
* Response: `200` with the final channel state if done within ~8 s, else
  `202` with `en_proceso`; the work continues (`EdgeRuntime.waitUntil` or the
  existing outbox worker, whichever the codebase already uses for deferred
  sends) and writes the final state.
* `GET …/entrega` returns all channels; it works after the token expired
  (status reads are not bounded by the 5 minutes).

Channel states: `pendiente`, `en_proceso`, `enviado`, `fallido`,
`sin_credito`, `sin_consentimiento`, `no_permitido`, `vencido`,
`esperando_sello`. Each has `motivo` (stable code, e.g. `smtp_rejected`,
`invalid_address`, `wallet_empty`, `provider_unavailable`, `quota_exceeded`)
and `actualizado` timestamp. Recipients are always masked in responses.

### 3.4 Where the bytes come from

The send uses the exact sealed JSON and the server-rendered PDF that
`api-v1` already produced and holds (`api_idempotency` / holding /
managed storage — reuse whatever `downloadDocument` reads). Nothing new is
retained beyond what is already retained.

### 3.5 Quotas and plans

E-mail counts against the same per-company relay quota as the web app
(`email_relay_log`) and the effective plan; WhatsApp debits the wallet the
same way the web app's send does. Both go through the existing server code
(server-to-server call authenticated with the backend secret, see
`_shared/backend-auth.ts`), not a reimplementation.

## 4. Storage (migration, next free number on `staging`)

`api_deliveries`: `id`, `company_id`, `environment`, `generation_code`,
`api_key_id`, `token_hash`, `token_expires_at`, `channel`
(`correo`|`whatsapp`), `recipient_masked`, `recipient_enc` (only if the send
must be retried by a worker; otherwise not stored), `state`, `reason`,
`provider_ref`, `created_at`, `updated_at`; unique
(`company_id`,`generation_code`,`channel`). RLS: members read their
company's rows; writes only via service role. Retention: rows purged with the
same policy as `api_idempotency` plus the status window (proposal: 30 days).
pgTAP test for RLS and the unique key. **Not applied remotely** by the agent.

## 5. SDK (`facta-api-sdk`)

* Types: `DeliveryRequest`, `DeliveryChannelState`, `DeliveryStatus`,
  `IssueResult.entrega`.
* `issue(request, { deliver: { email: true | string, whatsapp: { number,
  consent: true } } })` maps to `entrega` (wire names stay Spanish).
* `deliverEmail(code, token)`, `deliverWhatsApp(code, token)`,
  `getDelivery(code)`; `waitForDelivery(code, { channels, timeoutMs,
  intervalMs })` polls `getDelivery` until final states.
* Server handler (`@facta-dte/api/server`): the session may carry
  `deliver` (set by the integrator's server, never the browser). After a
  sealed `issue`, the handler fires the marked channel POSTs without awaiting
  their final state and returns a `deliveryHandle` (HMAC-sealed
  `{codigoGeneracion, nonce, exp}`; the Facta token never leaves the
  integrator's server — it is kept inside the sealed handle encrypted with the
  session secret, or re-derived; agent picks the simplest secure option and
  documents it). New action `delivery.status` (handle) → masked channel
  states.
* React: the result screens gain «Entrega» rows per marked channel:
  «Enviando correo…» → «Correo enviado a m•••@ejemplo.com» /
  «No se pudo enviar el correo · Dirección rechazada», same for WhatsApp
  («Sin saldo de WhatsApp» for `sin_credito`). Polling every 2 s up to 60 s,
  then «Consultaremos el estado más tarde». Never blocks «Listo» or
  auto-close; `onDelivery(status)` callback; `auto-close` passes the latest
  status in `onIssued` and keeps reporting through `onDelivery`.

## 6. Open (D-8 onward)

* **D-8** Contingency documents: no token now; delivery for them is a later
  task (needs a token issued when the seal arrives, or the web app's resend).
* **D-9** Whether a resend after 5 minutes should exist for API users (a new
  token from `POST /v1/dte/{cg}/entrega/token` with the API key).
* **D-10** Retention of `api_deliveries` (30 days proposed).

## 7. Release

Staging-first gate (`CLAUDE.md`): PR to `staging`, required checks green,
deploy and verify live in `00` (sealed test document → e-mail to a test
inbox; WhatsApp only in staging per the WhatsApp rule), then a scoped
promotion to `main`. The migration ships with the function in the same act.
