# The headless browser client

[Spanish guide](browser.es.md) · [English README](../README.md) · [Method reference](reference.md)

`@facta-dte/api/browser` is the framework-free half of the signing window: no
React, no credentials. It talks only to the handler you mount on **your**
server (`createFactaHandler` from `@facta-dte/api/server`), with an opaque
session token your server created. The React components in
`@facta-dte/api/react` are built on it; use it directly for Vue, Svelte, plain
DOM code or a custom UI. This guide organises its exports; the server side is in
[react-server.md](react-server.md) and the React layer in [react.md](react.md).

## What is exported

| Group | Exports |
| --- | --- |
| Transport | `createFactaClient`, `FactaClientError`; types `FactaClient`, `FactaDataClient`, `FactaFullClient`, `FactaClientOptions` |
| Issuance state machine | `createIssueFlow`, `initialFlowState`; types `IssueFlow`, `IssueFlowOptions`, `FlowState`, `FlowStep`, `FlowFailure`, `IssuePhase`, `RunMode` |
| Messages | `esMessages`, `mergeMessages`, `fill`, `explainError`; types `FactaMessages`, `FactaMessagesOverride` |
| Field errors | `describeFields`, `describeFieldPath`; type `FieldIssue` |
| Formatting | `formatMoney`, `formatQuantity`, `formatDateTime`, `truncateMiddle`, `lineAmount`, `storageTone` (type `StorageTone`) |
| Files | `archivoDteOf`, `base64ToBytes`, `saveBlob`, `downloadPdf`, `downloadJson` |
| Delivery | `DELIVERY_LIMIT_REASONS`, `isDeliveryLimitReason` |
| Data cache | `createFactaCache`; types `FactaCache`, `CacheEntry` |
| Appearance | `appearanceToCssVariables`, `mergeAppearance`, `pickAccentInk`, `resolveAccentInk`, `colorToSrgb`, `resolveMotion`, `resetAppearanceWarnings`; types `FactaAppearance`, `FactaVariables`, `FactaTheme`, `FactaDensity`, `FactaMotion`, `FactaSlot`, `FactaStyles`, `InkChoice` |
| Wire types | everything in `src/browser/wire.ts`: `IssueSummary`, `SessionInfo`, `DeliveryView`, `StorageSummary`, `DocumentRow`, `DocumentDetail`, `WireError`, `HandlerErrorCode`, … |

## The client

`createFactaClient({ endpoint, fetch?, headers?, timeoutMs? })` posts
`{ action, session, ...}` as JSON to `endpoint` with `x-facta-ui: 1` and
same-origin credentials. `headers` can be a function (for a CSRF token, say).
`timeoutMs` defaults to 60 s; a timeout counts as an uncertain outcome.

```ts
import { createFactaClient, FactaClientError } from "@facta-dte/api/browser";

const client = createFactaClient({ endpoint: "/api/facta", headers: () => ({ "x-csrf-token": csrf() }) });

const info = await client.describe(sessionToken);      // what will be issued, environment, expiry
try {
  const summary = await client.issue(sessionToken);    // IssueSummary: sellado | contingencia
  console.log(summary.numeroControl, summary.storage, summary.delivery);
} catch (error) {
  if (error instanceof FactaClientError && error.transport) {
    // No usable answer: verify (same session again, or status) instead of starting over.
  }
}
```

Session actions: `describe`, `issue`, `status(session, code, statusToken)` and
`deliveryStatus(session, deliveryHandle)`. Data actions (each needs the matching
handler capability, otherwise `403 action_not_allowed`): `listDocuments`,
`getDocument`, `downloadDocument(code, kind, { paperWidthMm?, raw? })`,
`getDocumentCopies`, `retryDocumentStorage`, `listHolding`, `searchCustomers`,
`getCustomer`, `searchProducts`, `getProduct`, `getServiceStatus`,
`getStorageStatus`, `describeInvalidation`, `invalidate`.

`FactaClientError` has `code`, `status`, `retryable`, `spent` (`true`, or
`{ codigoGeneracion?, numeroControl? }`, when a number was burned; `wasSpent`
as a boolean), `observaciones`, `fields` (`{ path, message }[]`),
`statusToken` and `transport` (`true` when the browser never got a usable
answer: no connection, timeout, non-JSON body).

## The issuance flow

`createIssueFlow({ client, session, run?, messages?, onDelivery?, ... })` is the
state machine behind the window. States (`FlowStep`): `loading` → `review` →
`issuing` → (`verifying`) → `sealed` | `contingency` | `rejected` | `failed` |
`expired`. `initialFlowState()` gives the starting `FlowState` for a first
render.

```ts
import { createFactaClient, createIssueFlow } from "@facta-dte/api/browser";

const flow = createIssueFlow({ client: createFactaClient({ endpoint: "/api/facta" }), session: sessionToken });
const stop = flow.subscribe((state) => render(state)); // step, info, phase, result, error, delivery
await flow.start();          // loads the session -> "review" (or issues at once with run: "auto")
await flow.next();           // issue
// state.error?.canRetry ? flow.retry() : show state.error.explanation
stop();
flow.destroy();
```

Rules the machine enforces, so a custom UI does not have to:

- An uncertain outcome is never retried as a new request: the **same session**
  is re-sent up to `maxResends` times (default 2, `verifyDelayMs` 1500 ms
  apart), then `status` is asked when a status token exists.
- `retry()` («Intentar de nuevo») is allowed only when `state.error.canRetry`:
  retryable, nothing spent, outcome known.
- Contingency is a success. Storage trouble never changes a fiscal result.
- Delivery (`state.delivery`, `onDelivery`) is polled every
  `deliveryIntervalMs` (2 s) for up to `deliveryTimeoutMs` (60 s) and never
  gates `step`.

`run: "auto" | "auto-close"` skips the review and issues as soon as the session
loads; closing the window is the UI's job.

## Messages and field errors

All user-facing text is Spanish (es-SV, usted) in `esMessages`. Override any
part with `mergeMessages(override)`; `explainError(code, messages)` returns the
explanation for an error code (a generic one for unknown codes); `fill` replaces
`{name}` placeholders. `describeFields(fields, messages)` turns paths such as
`cuerpoDocumento[2].precioUni` into labels like «Precio de la línea 3».

```ts
import { describeFields, explainError, mergeMessages } from "@facta-dte/api/browser";

const messages = mergeMessages({ errors: { rate_limited: "Demasiadas facturas seguidas. Espere un momento." } });
const text = explainError("rate_limited", messages);
const issues = describeFields([{ path: "receptor.nrc", message: "required" }], messages); // label: «NRC del receptor»
```

## Formatting, files and cache

- `formatMoney(1234.5)` → `$1,234.50` (locale-independent, `—` for invalid);
  `formatQuantity`, `formatDateTime(fecEmi, horEmi)` → `05/10/2026 14:32`,
  `truncateMiddle(code)`; `lineAmount(cantidad, precioUni)` is display-only and
  rounds to cents. Never use it for fiscal totals: the server's `totales` are
  the truth.
- `storageTone(summary)` → `"saved" | "pending" | "off" | null` for a quiet
  storage indicator.
- `downloadPdf(base64, code)`, `downloadJson(text, code)`, `saveBlob`,
  `base64ToBytes`: hand a sealed result's files to the person without a server
  trip. Prefer `archivoDteOf(result) ?? result.archivoJson` for the JSON (see
  [archivo-dte.md](archivo-dte.md)).
- `createFactaCache()`: a small stale-while-revalidate cache (`get`, `fetch`
  with in-flight dedupe, `revalidate(key, fetcher, staleMs)`, `subscribe`,
  `invalidate(prefix)`, `set`). The React data hooks share one.

## Appearance helpers

The same tokens as the React `appearance` prop, usable from any framework:
`appearanceToCssVariables(variables, { dark? })` returns `--facta-*` custom
properties (deriving `accentInk`, `accentSoft`, `surface`, `border`, `muted`,
`radiusSm` from what you set); `mergeAppearance(...layers)` merges layers (later
wins); `pickAccentInk(accent)` picks white or `#0b1419` for WCAG 4.5:1 (hex and
`rgb()` only; `resolveAccentInk(accent, element)` asks the browser for other
colour syntaxes); `resolveMotion(motion, prefersReduced)`. The variable list is
in [react.md](react.md#1-tokens-appearance).

## What can go wrong

- **`403 action_not_allowed`** from a data action: the handler did not declare
  that capability (see [react-server.md](react-server.md#capabilities)).
- **`session_expired` / `session_invalid`**: the session token is too old or was
  not signed with the handler's `sessionSecret`; the flow moves to `expired`.
  Create a new session on your server.
- **`transport: true`**: the outcome is unknown. Do not create a new session for
  the same sale; let the flow verify, or call `status`.
- **CORS or a different origin**: the client sends `credentials: "same-origin"`;
  mount the handler on the same origin, or pass a `fetch` that does what your
  setup needs.
- **Putting an API key in the browser**: never. This package needs none.

## Related

- [Signing window for React](react.md) · [Server side and storage](react-server.md)
- [Delivery](delivery.md) · [Error catalogue](errors.md) · [Method reference](reference.md)
