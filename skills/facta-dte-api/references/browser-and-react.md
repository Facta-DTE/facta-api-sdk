# Server handler, browser client and React

Sources: `guides/browser.md`, `guides/react.md`, `guides/react-server.md`,
`guides/region.md`, `server.ts`, `src/server/*`, `src/react/*`.

The browser **never holds a Facta credential**. Your server owns the `Facta`
instance, builds the final request from *your* order, seals it in a signed session
token and hands only the token to the page. The window only reviews and issues it.

```
browser (token only) ──> YOUR endpoint: createFactaHandler ──> Facta (keys here)
```

## Server (`@facta-dte/api/server`)

```ts
import { Facta } from "@facta-dte/api";
import { createFactaHandler, createFactaSession, toNodeHandler } from "@facta-dte/api/server";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });
export const handler = createFactaHandler({
  facta,
  sessionSecret: process.env.FACTA_SESSION_SECRET!, // >= 32 bytes; signs session tokens; a server secret
  authorize: (req) => isLoggedIn(req),               // REQUIRED. "session-only" accepts any valid token (anonymous checkout)
  onIssued: (result, { session }) => saveInvoice(session.idempotencyKey, result), // make it idempotent
});
const token = await createFactaSession(
  { request, idempotencyKey: `order-${order.id}`, display: { total: order.total, reference: order.id }, deliver: { email: true } },
  process.env.FACTA_SESSION_SECRET!,
);
```

- `handler` is `(req: Request) => Promise<Response>` (Next.js route handlers, Deno,
  Bun, Workers). For Express or `node:http` wrap it: `app.post("/api/facta", toNodeHandler(handler))`.
- A session lasts 900 s by default (`expiresIn` up to 86 400). The token is
  **authenticated, not encrypted**: it holds no secret, but the draft and `deliver`
  contacts are readable by whoever holds it. The browser can neither add nor change
  `deliver`. Replaying a token is harmless: the idempotency key is inside.
- `archive`: `"auto"` (default; uses `issueAndArchive` when the client has
  `runtime.archive`), `"required"`, `"off"`.
- The handler returns `{ result, storage, statusToken }`; `storage` has counts and
  states only, never paths or credentials. A sealed or contingency document is
  always returned, even if archiving failed.
- **Capabilities** (default: nothing but issuing; anything undeclared is `403
  action_not_allowed`): `documents: "read"`, `downloads: ["pdf","json"]` (or `true`
  for pdf, json, ticket), `catalog: "read" | "write"`, `status`, `storage: "read"`,
  `rawJson` (browser may ask for the stored original), `retryStorage`,
  `invalidate: "session"`. Also `scope(req)` (filters forced onto lists),
  `exposeRecipient` (default `false`: receivers never reach the browser; document
  numbers come masked), `maxDownloadBytes` (8 MiB), `exposeDocument`, `maxBodyBytes`.
- Invalidating from a page: your server seals the decision with
  `createFactaInvalidationSession({ generationCode, tipoAnulacion, responsable, solicita }, secret)`;
  the browser only confirms (`useFactaActions().invalidate(token)`).
- Delivery: put `deliver` in the session; after a sealed issue the handler starts the
  channels (waits at most `deliveryStartTimeoutMs`, default 1500) and gives the
  browser a `deliveryHandle`, never the Facta token.
- Mount the handler on the **same origin** as the page (the client uses same-origin
  credentials) and protect it with your own session/CSRF.
- The browser and React need no region; your server's `Facta` instance pins it.

## Browser, no framework (`@facta-dte/api/browser`)

`createFactaClient({ endpoint, headers?, fetch?, timeoutMs? })`, then `describe`,
`issue`, `status`, `deliveryStatus`, plus data actions (each needs the matching
capability). `createIssueFlow({ client, session })` is the state machine
(`loading → review → issuing → verifying → sealed | contingency | rejected | failed | expired`).
It re-sends the **same session** on an uncertain outcome (never a new request),
allows `retry()` only when `state.error.canRetry`, and treats contingency as success.
`FactaClientError.transport === true` means the outcome is unknown: verify, do not
start over. User-facing text is Spanish (es-SV, usted) in `esMessages`; override with
`mergeMessages`. Display helpers: `formatMoney`, `describeFields`, `explainError`.
**Never use `lineAmount` for fiscal totals** (display only).

## React (`@facta-dte/api/react`): the graphical mode

Every component lives under one `FactaProvider endpoint="/api/facta"` (the handler of
the section above) and imports the stylesheet once:

```tsx
import { FactaProvider } from "@facta-dte/api/react";
import "@facta-dte/api/react/styles.css";
```

The components are client components. Create session tokens on your server and pass
them down. Starters: [`templates/react-checkout.tsx`](../templates/react-checkout.tsx)
and [`templates/react-documents.tsx`](../templates/react-documents.tsx); the playground's
working examples are indexed in [recipes.md](recipes.md).

### 1. Windows that issue (need a `session` token)

Same props on all of them: `session`, `run`, `autoCloseDelay`, `autoCloseOn`,
`onIssued(result)`, `onError`, `onDelivery`, `onEvent`, `onClose`, plus the look props
(below). `onIssued` fires for a sealed document **and** for a contingency.

| Component | Use it for |
| --- | --- |
| `FactaInvoiceDialog` (`open`, `onOpenChange`) | A centred dialog on desktop, a bottom sheet on a phone. |
| `FactaInvoiceDrawer` (`open`, `onOpenChange`) | A side panel when the sale must stay visible behind it. |
| `FactaInvoiceInline` | Embedded in your page, no overlay. |
| `FactaIssueButton` (`label`, `popover`, `disabled`) | One button for a point of sale: spinner, then a check; a popover carries the result. |
| `useFactaWindow().open(session, { variant, run, … })` | No component in your JSX: `open()` resolves with the `IssueResult`, or rejects with `FactaWindowError` (`closed`, `superseded` or the failure code). |

```tsx
// Dialog; the same props work on Drawer and Inline.
<FactaInvoiceDialog session={token} open={open} onOpenChange={setOpen} run="manual" onIssued={(r) => save(r)} />
// Button for a POS
<FactaIssueButton session={token} label="Emitir factura" onIssued={(r) => save(r)} />
// Hook
const { open } = useFactaWindow();
const result = await open(token, { variant: "drawer", run: "auto-close" });
```

The three **run modes** (`RunMode`):

| `run` | Behaviour |
| --- | --- |
| `"manual"` (default) | Review, press «Emitir factura», read the result, press «Listo». |
| `"auto"` | Issues as soon as it opens (`FactaIssueButton`/`Inline`: on mount). The result stays until the person closes it. |
| `"auto-close"` | Issues, shows the result for `autoCloseDelay` ms (default 1200; `0` = at once) and closes itself. A thin countdown bar shows it; any pointer, key or focus event inside cancels it. Never closes while issuing or verifying. |

`autoCloseOn`: `"success"` (default: sealed and contingency close; a rejection, failure or
expired session stays open so it can be read) or `"any"` (every final state closes; show
errors from `onError`). With `FactaIssueButton`, `auto-close` shows no success popover. An
uncertain outcome is verified by re-sending the **same session**, never started over.

### 2. After issuing

```tsx
<FactaReceipt result={result} environment="00" reference="Pedido #1042" />   // renders a result you hold; no network call
<FactaStatusBadge estado={result.estado} />                                  // sellado | contingencia | rechazado | invalidado…
<FactaDownloadButton codigoGeneracion={result.codigoGeneracion} kinds={["pdf", "json", "ticket"]} />
<FactaDownloadButton codigoGeneracion={code} variant="outline" size="sm" kinds={["json"]} />
```

- `FactaDownloadButton`: `kinds` (default `["pdf","json","ticket"]`, the first is the main
  action), `variant` `solid | outline | icon`, `size` `md | sm`, `paperWidthMm` (ticket roll,
  40–120), `rawJson` (adds «JSON original (raw)»), `onDownloaded`, `onError`. It asks **your
  handler**: the server must declare `capabilities.downloads` (and `rawJson: true` for raw).
- «Descargar JSON» is the Archivo DTE. `FactaReceipt` shows the «Entrega» rows when the
  session marked channels and a banner when the emergency safeguard ran.

### 3. Documents, customers and status (declare capabilities on the server)

```tsx
<FactaDocumentList title="Documentos" pageSize={10} downloads={["pdf", "json"]}
  onInvalidate={(row) => requestInvalidationToken(row.codigoGeneracion)} onInvalidated={refresh} />
<FactaDocumentDetail codigoGeneracion={code} presentation="inline" />            // or open/onOpenChange for the drawer
<FactaCustomerPicker value={customer} onChange={setCustomer} minChars={2} debounceMs={350} />
<FactaProductPicker onSelect={(p) => addLine(p.id)} />
<FactaServiceStatus />            // pill; variant="dot" for a POS header; polls every 60 s, paused when the tab is hidden
<FactaStorageMeter warnAt={85} />
```

- `FactaDocumentList`: table above 640 px, cards below (`variant`: `auto | table | cards`),
  `defaultFilters` / `filters` / `onFiltersChange`, `showFilters`, `hideHeader`,
  `downloads` (`[]` hides them), `detail` (built-in drawer, default true), `onOpen`. Needs
  `documents: "read"` and `downloads`. **«Anular» appears only if you pass `onInvalidate`**.
- `FactaDocumentDetail`: identifiers with copy, totals as the server returned them, the
  receiver only when the handler exposes it, copies with «Reintentar», timeline; polls
  while in contingency. `kinds`, `showCopies`, `onInvalidate`, `onInvalidated`.
- Pickers return the **catalog `id`** (a short projection, receiver data masked); your
  server then builds the session with `customerId` / `productId`. They need
  `capabilities.catalog` and a catalog the API can read (`readable` or `plain`; an
  encrypted one needs the server's `unlockKey`).
- `FactaServiceStatus` and `FactaStorageMeter` need `capabilities.status` / `storage: "read"`.
- Headless hooks if you draw your own table: `useFactaDocuments`, `useFactaDocument`,
  `useFactaCustomers`, `useFactaProducts`, `useFactaServiceStatus`, `useFactaStorage`,
  `useFactaActions` (`download`, `retryStorage`, `invalidate(sessionToken)`, `copyCode`).

### 4. Invalidation: your server decides, the dialog confirms

The browser never authors an invalidation. Your server creates the token with
`createFactaInvalidationSession({ generationCode, tipoAnulacion, responsable, solicita }, secret)`
(it does not verify as an issue session, and the other way round) and the handler needs
`capabilities.invalidate: "session"`:

```tsx
const actions = useFactaActions();
const token = await fetch("/api/invalidation", { method: "POST", body: JSON.stringify({ code }) }).then((r) => r.text());
const outcome = await actions.invalidate(token);               // opens FactaInvalidateDialog and resolves with the outcome
// or controlled: <FactaInvalidateDialog session={token} open={open} onOpenChange={setOpen} onInvalidated={refresh} onViewDetail={show} />
```

`FactaInvalidateDialog` shows the people named on the event and the document, asks
confirmation, and shows the event seal or Hacienda's message verbatim. The idempotency key
defaults to `invalidate:<generationCode>`, so replaying a token cannot invalidate twice.

### 5. Look: tokens, theme, density, branding, messages

Every component takes the same optional look props (`FactaLook`), also settable once on
`FactaProvider`; the component wins over the provider.

```tsx
<FactaProvider
  endpoint="/api/facta"
  appearance={{
    theme: "auto",            // "light" | "dark" | "auto"  (shortcut: theme="dark")
    density: "compact",       // "comfortable" | "compact"
    motion: "reduced",        // "full" | "reduced" | "none"
    variables: { accent: "#6d4bd8", radius: "4px", headingFontFamily: "Georgia, serif" },
  }}
  branding={{ name: "Ferretería San Miguel", logo: "/logo.svg", attribution: false }} // false hides «Powered by factadte.com»
  messages={{ review: { issue: "Facturar ahora", cancel: "Volver" }, chipTest: "Modo de pruebas" }}
  classNames={{ primaryButton: "my-primary", card: "my-card" }}
  styles={{ total: { fontSize: 40 } }}
/>
```

- **Variables** (`appearance.variables`): colours `accent`, `accentInk`, `accentSoft`,
  `background`, `surface`, `text`, `muted`, `border`, `success`, `warning`, `danger`,
  `shadow`; shape and type `radius`, `radiusSm`, `fontFamily`, `headingFontFamily`; size
  and spacing `fontSizeBase`, `titleSize`, `totalSize`, `buttonHeight`, `downloadHeight`,
  `space`, `gap`, `windowWidth`, `drawerWidth`. Setting `accent` derives `accentInk` (WCAG 4.5:1 between
  white and `#0b1419`; hex and `rgb()` only), `accentSoft`, and so on. You can also set the `--facta-*`
  custom properties from your own CSS. The playground's «Apariencia» studio only exposes: theme,
  density, motion, accent, radius, font families, branding name/logo/attribution, class names and
  three message overrides.
- **Slots** shared by `styles`, `classNames` and the `data-facta-slot` attribute: `root`,
  `overlay`, `card`, `header`, `title`, `chip`, `body`, `footer`, `primaryButton`,
  `secondaryButton`, `downloadButton`, `statusIcon`, `total`, `identifiers`, `storageRow`,
  `attribution`, `countdown`, `stepper`, `fieldList`, `quote`, and for the data components `list`,
  `row`, `detail`, `menu`, `field`, `option`, `pill`, `meter`, `dialog`, `deliveryRow`. Roots also carry
  `data-facta-state`, `-run`, `-variant`, `-theme`, `-density`, `-motion` for plain CSS;
  `unstyled` drops every default class.
- **Spanish messages** (es-SV, usted) are built in. `messages` takes a partial override
  (`FactaMessagesOverride`); outside React the same data is `esMessages`, `mergeMessages`,
  `explainError`, `describeFields`. Keep the usted register when you override.
- **Themes:** light, dark and `"auto"` (follows the system). Check both when you change
  colours.
