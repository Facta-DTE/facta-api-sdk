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

## React (`@facta-dte/api/react`)

```tsx
import { FactaProvider, FactaInvoiceDialog, FactaIssueButton } from "@facta-dte/api/react";
import "@facta-dte/api/react/styles.css";

<FactaProvider endpoint="/api/facta">
  <FactaInvoiceDialog session={token} open={open} onOpenChange={setOpen} onIssued={(r) => …} />
</FactaProvider>
```

- Windows: `FactaInvoiceDialog`, `FactaInvoiceDrawer`, `FactaInvoiceInline`,
  `FactaIssueButton`, hook `useFactaIssue`, `useFactaWindow().open(session)`.
- `run`: `"manual"` (default: review then «Emitir factura»), `"auto"`, `"auto-close"`.
- Data components: `FactaDocumentList`, `FactaDocumentDetail`, `FactaDownloadButton`,
  `FactaReceipt`, `FactaCustomerPicker`, `FactaProductPicker`, `FactaServiceStatus`,
  `FactaStorageMeter`, `FactaInvalidateDialog`; hooks `useFactaDocuments`,
  `useFactaDocument`, `useFactaCustomers`, `useFactaProducts`, `useFactaServiceStatus`,
  `useFactaStorage`, `useFactaActions`.
- «Descargar JSON» gives the Archivo DTE; `rawJson` adds «JSON original (raw)» and
  needs `capabilities.rawJson: true` on the server.
- Look: `appearance` tokens (theme, density, motion, variables), per-slot `styles` /
  `classNames`, `data-facta-slot` attributes for your own CSS.
- The pickers return the catalog `id`; your server then builds the session with
  `customerId` / `productId`.
- Server-side rendering: the components are client components; create the session
  token on the server and pass it down.
