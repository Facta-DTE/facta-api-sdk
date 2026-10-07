# Debug timings

[Spanish guide](timings.es.md) · [English README](../README.md) · [Method reference](reference.md)

When a call is slow you want to know where the time went: authentication, the
idempotency claim, opening the signing vault, Hacienda's answer, the PDF. With
debug timings the API returns its own per-step processing times next to the
result. It is a **debugging aid**: off by default, and not meant to stay on in
production code.

## Turning it on

Client-wide, for every call of that instance:

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY!,
  debug: { timings: true },
});
```

Or for one call, through the `debug` member of its options. A per-call value
wins over the client-wide one, so `{ debug: { timings: false } }` turns a
client-wide flag off for that call.

```ts
const result = await facta.issue(request, {
  idempotencyKey: order.id,
  debug: { timings: true },
});
for (const { step, ms, startedAtMs } of result.debug?.timings ?? []) {
  console.log(step.padEnd(24), ms.toFixed(1), "ms", startedAtMs === undefined ? "" : `@${startedAtMs.toFixed(1)}`);
}
console.log("total", result.debug?.totalMs, "from", result.debug?.source);
```

With the flag the SDK sends the header `X-Facta-Debug: timings`. Without it the
header is never sent and the API response does not change.

## What comes back

`result.debug` is a `DebugInfo`:

| Field | Meaning |
| --- | --- |
| `timings: DebugTiming[]` | One entry per measured step: `step` (a fixed name), `ms` (duration) and, when the body carried it, `startedAtMs` (start, measured from the moment the request reached the function). |
| `totalMs` | From arrival to the moment the report was built. When the source omits it, the sum of the steps. |
| `source` | `"body"` when the SDK read the response body's `debug` member, `"server-timing"` when it fell back to the `Server-Timing` header. |

Step names are phases such as `auth`, `rate_limit_admit`, `idempotency_claim`,
`vault_open`, `jws_sign`, `mh_transmit`, `pdf_render`, `index_write`,
`managed_upload`, or database calls (`rpc.<function>`, `db.<METHOD>.<table>`).
They never carry document data, identifiers, paths or secrets. Phases can
contain other phases and parallel steps overlap, so do not simply add every
`ms`; compare `startedAtMs` to find what ran in parallel.

The SDK validates the report because it is untrusted network input: entries
without a string `step` or a non-negative finite `ms` are dropped, and step names
are cut at 80 characters.

## Which calls report timings

`DebugInfo` is typed on `SealedDte`, `DteInContingency`, `PreparedDte`,
`DocumentStatus`, `DeliveryStatus` and `DeliveryChannelStatus`, and the `debug`
option is accepted by `issue`, `prepare`, `sign`, `status`,
`getDocumentStatus`, `deliverEmail`, `deliverWhatsApp`, `getDelivery` and
`waitForDelivery`.

The published API contract documents timings for `POST /v1/dte`,
`POST /v1/dte/prepare`, `POST /v1/dte/sign` and the file download
(`GET /v1/dte/{codigoGeneracion}/file`, `Server-Timing` only); other routes may
ignore the header, and then `result.debug` is simply absent. Two SDK limits:

- `downloadDocument` returns bytes, and the SDK does not parse `Server-Timing`
  on binary responses, so a download result has no `debug`.
- A `FactaError` carries no timings, even if the API attached a `debug` member
  to the error body.

A replay through the same `Idempotency-Key` also accepts the flag; the report
then describes the replay, not the original emission.

## Reading the header yourself

If you call the API without the SDK, or want the raw header, the
`Server-Timing` format is standard: `auth;dur=41.2, mh_transmit;dur=812.5,
total;dur=2310.4`. A metric named `total` is the total, not a step. Browser
developer tools show it in the network panel's Timing tab.

## What can go wrong

- **`result.debug` is `undefined`**: the flag was off for that call, the route
  does not report timings, or the server predates the feature.
- **Leaving it on in production**: every response grows and the API's internal
  step names end up in your logs. Turn it on for an investigation, then off. The
  SDK never forwards a `debug` member you did not ask for.
- **Adding all `ms` values gives more than `totalMs`**: steps nest and overlap.
- **Timings on a failed call**: not available through `FactaError`; reproduce
  with a successful call, or use the browser's network panel.

## Related

- [Regional pinning](region.md): the most common cause of slow calls.
- [Diagnostics](diagnose.md) · [Method reference](reference.md#debug-timings-a-debugging-aid)
