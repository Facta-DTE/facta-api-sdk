# Delivery by e-mail and WhatsApp

[Spanish guide](delivery.es.md) · [English README](../README.md) · [Method reference](reference.md)

Facta's API can send a sealed document to the receiver by e-mail, by WhatsApp,
or both. The SDK itself sends nothing: you **mark** the channels when you issue,
and then **start** each channel with its own request. Issuing never waits for a
delivery, and a delivery that cannot go out is reported as a state, never as a
failed issuance.

## The flow in four steps

1. `issue(request, { deliver })` marks the channels. The sealed result carries
   `entrega: { token, venceEn, canales }`.
2. Within **five minutes of issuance**, `deliverEmail(code, token)` and/or
   `deliverWhatsApp(code, token)` start each channel. One request per channel.
3. Each answers with the channel's state: final (HTTP 200) or `en_proceso`
   (HTTP 202) when the provider is slower.
4. `getDelivery(code)` or `waitForDelivery(code)` read the final states, also
   after the token expired.

```ts
import { Facta, isDeliveryLimitReason, type DteRequest } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });
const sale: DteRequest = {
  tipoDte: "01",
  receptor: { nombre: "Ana López", correo: "ana@example.com" },
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 2.5 }],
};

const result = await facta.issue(sale, {
  idempotencyKey: "order-1042",
  deliver: { email: true, whatsapp: { number: "+50370000000", consent: true } },
});

const token = result.estado === "sellado" ? result.entrega?.token : undefined;
if (token) {
  await facta.deliverEmail(result.codigoGeneracion, token);
  await facta.deliverWhatsApp(result.codigoGeneracion, token);
  const status = await facta.waitForDelivery(result.codigoGeneracion, { timeoutMs: 30_000 });
  for (const [channel, state] of Object.entries(status.canales)) {
    if (state?.estado === "enviado") console.log(channel, "sent to", state.destino);
    else if (isDeliveryLimitReason(state?.motivo)) console.warn(channel, "could not go out now; offer the PDF");
    else console.warn(channel, state?.estado, state?.motivo);
  }
}
```

## Marking channels: `deliver`

| Option | Wire (`entrega`) | Meaning |
| --- | --- | --- |
| `email: true` | `correo: true` | Send to `receptor.correo`. |
| `email: "x@y.com"` | `correo: "x@y.com"` | Send to this address for delivery only; the fiscal document keeps `receptor.correo`. |
| `whatsapp: { number, consent: true }` | `whatsapp: { numero, consentimiento: true }` | Send by WhatsApp. `consent: true` is **your attestation** that the receiver agreed; it is stored with the key id and the masked number. |

The SDK checks `deliver` before sending anything and throws `TypeError` when:
no channel is marked, `email` is neither `true` nor an address, the WhatsApp
number does not look like a phone number (use `+503…`), or `consent` is not
literally `true`.

`entrega` is part of the request, so it is part of the idempotency fingerprint:
replaying the same request with the same key returns the same token while it is
valid, and changing `deliver` with the same key is `idempotency_key_reuse`.

**Scopes.** A key with the `issue` scope may mark and deliver both channels. A
key minted with only `entrega:correo` or `entrega:whatsapp` keeps that channel.
A channel the key may not use still issues the document; the channel state is
`no_permitido`.

## The delivery token

`result.entrega` (`DeliveryOffer`) has:

- `token`: an opaque bearer secret, valid until `venceEn` (issuance + 5
  minutes). Keep it on your server; never send it to a browser.
- `venceEn`: ISO-8601 expiry.
- `canales`: the marked channels with their initial state and masked
  `destino` («m•••@example.com»). Unmarked channels are omitted.

`token` is **absent** when nothing is deliverable: a contingency document
(channels are `esperando_sello`; delivery after a contingency is not offered
yet), or no marked channel has its scope and consent. There is currently no
way to obtain a new token after the five minutes; deliver late documents from
the Facta app or by your own means.

## Channel states and reasons

| `estado` | Final? | Meaning |
| --- | --- | --- |
| `pendiente` | no | Marked, not started. |
| `en_proceso` | no | Started; the provider has not answered yet. |
| `enviado` | yes | Handed to the provider. |
| `fallido` | yes | Could not be sent; see `motivo`. |
| `sin_credito` | yes | WhatsApp: the company's prepaid wallet is empty. |
| `sin_consentimiento` | yes | WhatsApp: consent was not attested. |
| `no_permitido` | yes | The key's scopes do not include this channel. |
| `vencido` | yes | The token expired before the channel was started. |
| `esperando_sello` | not waited for | Contingency: nothing is sent until a seal exists. |

`motivo` is a stable reason code: `smtp_rejected`, `invalid_address`,
`wallet_empty`, `provider_unavailable`, `quota_exceeded`,
`consent_not_attested`, `scope_missing`, `token_expired`, `contingency`,
`document_rejected`, `document_unavailable`, `provider_rejected`,
`outcome_unknown`, `delivery_unavailable`. New codes may appear; treat unknown
ones as a generic failure.

`DELIVERY_LIMIT_REASONS` (`quota_exceeded`, `provider_unavailable`) and
`isDeliveryLimitReason(motivo)` identify «the message could not go out right
now» as opposed to «something is wrong with the address». The document is
already issued: show a warning and offer the PDF or JSON instead. Both are
exported from the root package and from `@facta-dte/api/browser`.

WhatsApp is billed to the company's prepaid wallet; the message is the approved
template plus the document, nothing else. E-mail counts against the company's
e-mail quota.

## Starting and reading channels

- `deliverEmail(code, token, { signal? })` / `deliverWhatsApp(...)` →
  `DeliveryChannelResult` (the channel status plus `canal`). A second call for
  the same channel returns the current state and does not send a second
  message. The SDK strips the token from any error message or details.
- `getDelivery(code, { signal? })` → `DeliveryStatus` with every channel. Works
  after the token expired. Scope `query`.
- `waitForDelivery(code, { channels?, timeoutMs = 60000, intervalMs = 2000, signal? })`
  polls `getDelivery` until every awaited channel is final. On timeout it
  **returns** the last status with `settled: false`; it does not throw.

```ts
const status = await facta.waitForDelivery(code, { channels: ["correo"], timeoutMs: 20_000 });
if (!status.settled) {
  // Still pendiente/en_proceso: read it again later with getDelivery(code).
}
```

## In the server handler and React

With the React signing window, put `deliver` in the session your server creates
(`createFactaSession({ request, idempotencyKey, deliver }, secret)`); the
browser can neither add nor change it. After a sealed issue the handler starts
the marked channels itself, without waiting longer than
`deliveryStartTimeoutMs` (default 1500 ms), and gives the browser a
`deliveryHandle` instead of the Facta token. The window shows one «Entrega» row
per channel, polls `delivery.status` every 2 s for up to 60 s, and reports
through `onDelivery(view)`. Details: [react-server.md](react-server.md#delivery-by-e-mail-and-whatsapp).
The headless flow in `@facta-dte/api/browser` exposes the same view as
`state.delivery` and `onDelivery` (see [browser.md](browser.md)).

## What can go wrong

- **`entrega_vencida` (HTTP 410)**: more than five minutes passed since
  issuance. The channel becomes `vencido`; do not retry with that token.
- **`entrega_token_invalido` (HTTP 401)**: the token does not belong to this
  document and channel, is mistyped, or the document never had one.
- **`canal_no_marcado` (HTTP 409)**: the issue request did not mark that
  channel. Channels can only be marked when issuing.
- **No `token` in the result**: contingency, or no marked channel was
  deliverable (check `canales` for `no_permitido` / `sin_consentimiento`).
- **`waitForDelivery` never settles**: you listed a channel in `channels` that
  was not marked; it is never reported, so the call waits until `timeoutMs`.
- **`issueAndArchive` with `deliver`**: in this version `issueAndArchive` does
  **not** send `entrega` on its first request, so the result has no delivery
  token and nothing is delivered (the server handler inherits this when the
  client has `runtime.archive`). Use `issue(request, { deliver })` when you need
  delivery until this is fixed.
- **Delivery failure is not an issuance failure**: never re-issue a document
  because a channel ended `fallido`.

## Related

- [The Archivo DTE](archivo-dte.md) · [Idempotency patterns](idempotency.md)
- [Error catalogue](errors.md#delivery) · [Method reference](reference.md)
