# React signing UI — analysis and design contract

Status: plan + design contract, 5-Oct-2026. Implementation lives on branch
`feat/react-signing-ui`.

Original request (Marvin, verbatim):

> quisiera que el sdk tenga soporte nativo para react o componentes de UI que
> permitan firmar de forma facil, claro las claves siempre quedan del lado del
> server de quien implementa por seguridad ya que estariamos usando el api pero
> seria bonito una ventana unica que se pueda usar con nosotros

## 1. What exists today

`@facta-dte/api` is a server-side client. `Facta` needs `apiKey` (selects the
environment), `signKey` (sent on `issue`, `sign`, `invalidate`) and optionally
`unlockKey`. None of these may reach a browser. The fiscal surface that a UI
needs is already there:

| Need in the window | SDK method today |
| --- | --- |
| Issue in one step | `issue(request, { idempotencyKey })` → `SealedDte \| DteInContingency` |
| Review the canonical document first | `prepare` → `PreparedDte` (reserves a control number) → `sign` |
| Recover after an uncertain response | same `idempotencyKey`, then `getDocumentStatus(codigoGeneracion)` |
| Give the buyer the files | `SealedDte.archivoJson`, `SealedDte.representacionGrafica` (base64 PDF), `downloadDocument` |
| Explain a failure | `FactaError.code`, `isRejection`, `details`, `spent` |

What is missing is everything between a browser and that server client.

## 2. Architecture: three entry points, one package

```
browser                          implementer's server                 Facta API
┌──────────────────────┐  POST   ┌───────────────────────────┐  HTTPS ┌─────────┐
│ @facta-dte/api/react │ ──────▶ │ @facta-dte/api/server     │ ─────▶ │ api-v1  │
│  <FactaInvoiceWindow>│  JSON   │  createFactaHandler({     │        └─────────┘
│ @facta-dte/api/browser│◀────── │    facta, sessionSecret,  │
│  createFactaClient() │         │    authorize })           │
└──────────────────────┘         └───────────────────────────┘
   no keys, only a                 holds apiKey + signKey
   signed session token            (never serialized out)
```

* `@facta-dte/api/server` — runtime-neutral (`Request` → `Response`), so it
  mounts in Next.js route handlers, Hono, Express (via adapter helper), Deno,
  Bun. Exposes `createFactaSession()` and `createFactaHandler()`.
* `@facta-dte/api/browser` — framework-free client + the issuance state
  machine. No React import. Usable from Vue/Svelte/vanilla.
* `@facta-dte/api/react` — provider, hooks and the components. `react` and
  `react-dom` are **optional peer dependencies** (`>=18`); the root entry stays
  dependency-free and never imports React.
* `@facta-dte/api/react/styles.css` — the component stylesheet.

One package (subpath exports), not three, so the UI and the wire contract
always ship the same version.

## 3. Security model (non-negotiable)

1. **No credential in the browser.** The handler owns the `Facta` instance;
   responses are built from an allow-list of fields and pass through the same
   redaction as `FactaError`.
2. **The browser never authors the fiscal request.** The implementer's server
   creates a *session* from its own order:
   `createFactaSession({ request, idempotencyKey, allow, expiresIn }, secret)`
   returns an opaque token: `base64url(payload).base64url(HMAC-SHA256)`.
   The handler rejects a token with a bad MAC, an expired `exp` (default 15
   min) or an action not in `allow`. Replaying a valid token is harmless: the
   idempotency key is inside it, so the API returns the same document.
3. **What the browser may change is declared, not inferred.** `allow.recipient`
   (`"none" | "optional" | "required"`) and `allow.types` (subset of the
   session's possible `tipoDte`, e.g. `["01","03"]` for «¿Necesita crédito
   fiscal?»). The handler merges only those fields and validates them
   (shape, lengths; DUI 9 digits, NIT 14 digits, NRC digits) before calling
   the API. The API stays the fiscal authority.
4. **`authorize(req, session)` is required.** Constructing the handler without
   it throws. It returns `true`/`false` or throws; it is where the implementer
   checks *their* login/cookie. An explicit `authorize: "session-only"` is
   allowed for anonymous checkout pages and is documented as such.
5. **CSRF/abuse:** only `POST` with `content-type: application/json` and the
   header `x-facta-ui: 1`; body ≤ 32 KB; no CORS headers are emitted (same
   origin by default).
6. **Response minimisation:** by default the browser gets the summary
   (`estado`, `codigoGeneracion`, `numeroControl`, `tipoDte`, `ambiente`,
   `fecEmi`, `horEmi`, `selloRecibido`, `totales`, `observaciones`) plus the
   PDF and JSON *only if* `allow.download` is true (default true). `jws` and
   the full `documento` are returned only with `exposeDocument: true`.

## 4. Fiscal behaviour of the window

* **Default mode `confirm-then-issue`:** the review step shows the draft
  (receptor, lines as qty × unit price **as given**, and the implementer's
  optional `display.total`). The SDK has no VAT engine and must not grow one,
  so it never computes taxes; the authoritative totals are shown after the
  seal. No control number is reserved until the person presses «Emitir».
* **Opt-in mode `review-prepared`:** «Continuar» calls `prepare`, the window
  shows the server's `numeroControl` and `totales`, then «Firmar y enviar»
  calls `sign`. The window must say that closing at this point leaves a
  reserved number that the server releases as a documented gap. Never the
  default, because gaps are fiscal records.
* **Uncertain outcome** (network error, timeout, 5xx after send): the window
  does NOT offer «Intentar de nuevo» with a new key. It shows «Verificando con
  Hacienda…», re-sends the same session (same idempotency key) up to the
  client limit, then falls back to `status`. Only a definitive `FactaError`
  that says nothing was spent leads to «Intentar de nuevo».
* **Contingency** is a success state with a warning, not an error.
* **Rejection** shows Hacienda's `observaciones` verbatim (raw external
  messages are not translated) plus a Spanish explanation keyed by `code`.

## 5. Handler wire contract (browser ↔ implementer)

`POST {endpoint}` body `{ "action": string, "session": string, ... }`.

| action | extra body | server call | response |
| --- | --- | --- | --- |
| `session.describe` | — | none | `{ draft, allow, mode, environment, expiresAt }` (draft = request with recipient/items, no secrets) |
| `issue` | `recipient?`, `tipoDte?` | `facta.issue` | `{ result }` |
| `prepare` | `recipient?`, `tipoDte?` | `facta.prepare` | `{ prepared, preparedSeal }` — `preparedSeal` is an HMAC over the session nonce + the exact `prepared` JSON, so `sign` stays stateless and the browser cannot swap the document |
| `sign` | `prepared`, `preparedSeal` | `facta.sign` | `{ result }` |
| `status` | `codigoGeneracion` | `facta.getDocumentStatus` | `{ status }` |

Errors: `{ error: { code, message, retryable, spent?, observaciones? } }` with
the HTTP status mirrored. `code` values are `FactaErrorCode` plus the handler's
own: `session_invalid`, `session_expired`, `action_not_allowed`,
`recipient_invalid`, `unauthorized`, `bad_request`.

## 6. React surface

```tsx
<FactaProvider endpoint="/api/facta" theme="auto" messages={overrides}>
  <FactaIssueButton session={token} onIssued={(r) => …} />
  {/* or controlled */}
  <FactaInvoiceWindow session={token} open={open} onOpenChange={setOpen}
    presentation="auto" /* dialog | sheet | inline */
    onIssued onError onClose />
</FactaProvider>

const flow = useFactaIssue(token); // headless: flow.state, flow.next(), …
<FactaStatusBadge estado="sellado" />
```

State machine (in `browser`, shared by every framework):
`loading → review → recipient? → submitting(signing|sending) → verifying? →
sealed | contingency | rejected | failed | expired`, plus
`prepared` between `recipient` and `submitting` in `review-prepared` mode.

## 7. Design contract («la ventana única»)

**Identity.** It is a Facta DTE window embedded in someone else's product: it
must look trustworthy and neutral, adopt the host's font (`font: inherit`),
and carry Facta DTE only as a quiet footer «Powered by factadte.com» + seal
glyph (attribution, never advertising). Accent defaults to Torogoz
`oklch(0.55 0.13 225)` (sRGB fallback `#007faa`), dark `oklch(0.7 0.12 225)`.

**Tokens** (all overridable on any ancestor): `--facta-accent`,
`--facta-accent-ink`, `--facta-accent-soft`, `--facta-bg`, `--facta-surface`,
`--facta-text`, `--facta-muted`, `--facta-border`, `--facta-success`,
`--facta-warning`, `--facta-danger`, `--facta-radius` (12px),
`--facta-radius-sm` (8px), `--facta-shadow`, `--facta-font`. Themes:
`light | dark | auto` via `data-facta-theme`. Classes prefixed `facta-`; no
global selectors, no CSS reset leakage.

**Layout.** Dialog 480 px wide, max-height 88vh, scrolling body, fixed header
(title + environment chip + close) and fixed footer (primary + secondary).
≤ 640 px → bottom sheet with grab handle, safe-area inset, full width.
`inline` renders the same card without overlay. Targets ≥ 44 px, inputs
16 px text (no iOS zoom), visible focus ring in accent.

**Header.** Title by step; chip «Pruebas» (amber) when `ambiente === "00"`,
nothing in production. Close «×» hidden while submitting.

**Screens** (copy is es-SV, usted; all strings overridable):

1. *Revisar* — «Revise su factura». Document type label (Factura, Crédito
   fiscal, Nota de crédito, Nota de débito, Factura de exportación, Sujeto
   excluido). Receptor block («Consumidor final» when none). Lines list:
   description, `cantidad × precio`, line amount; `display.total` if given,
   labelled «Total de su pedido»; small note «Hacienda calcula los totales
   definitivos al sellar». Primary «Emitir factura» (or «Continuar» when the
   recipient step follows).
2. *Datos fiscales* (only if `allow.recipient` ≠ none) — segmented control
   «Factura» / «Crédito fiscal» when both allowed; fields Nombre, Tipo de
   documento (DUI · NIT), Número, NRC + Actividad (CCF only), Correo.
   Inline validation on blur, error text under the field. Secondary «Atrás».
3. *Revisión preparada* (mode `review-prepared` only) — número de control,
   totals table (Gravado, IVA, Total a pagar, total en letras), warning
   callout about the reserved number. Primary «Firmar y enviar».
4. *Enviando* — vertical 3-step progress: «Preparando el documento» →
   «Firmando» → «Enviando a Hacienda», animated indicator, `aria-live`
   polite, no buttons, Esc disabled. Respect `prefers-reduced-motion`.
5. *Verificando* — same layout, text «Estamos confirmando con Hacienda. No
   cierre esta ventana.» No retry button.
6. *Sellado* — success seal icon, «Factura emitida», total a pagar large;
   definition list: Número de control, Código de generación (copy button),
   Sello de recepción (truncated + copy), Fecha y hora. Actions: «Descargar
   PDF», «Descargar JSON», «Listo».
7. *Contingencia* — warning tone, «Factura firmada, pendiente de Hacienda»,
   explanation that it will be transmitted and that it must not be issued
   again; same identifiers; «Descargar JSON», «Listo».
8. *Rechazada* — danger tone, «Hacienda rechazó el documento», Spanish
   explanation + verbatim `observaciones` list in a quoted block; if a control
   number was spent, say so. Actions «Cerrar», optional «Corregir datos»
   (back to step 2 when recipient is editable).
9. *Error* — generic failure with message + code in small mono; «Intentar de
   nuevo» only when `retryable` and nothing was spent.
10. *Sesión vencida* — «Esta ventana venció. Vuelva a abrirla desde su
    pedido.» «Cerrar».
11. *Cargando* — skeleton of screen 1.

**Footer** (all screens): left «Powered by factadte.com» (12px, muted), right
the actions.

## 8. Deliverables of the first batch

* `src/server/` (session, handler, validation) + Deno tests.
* `src/browser/` (client, state machine, messages es-SV) + Deno tests.
* `src/react/` (provider, hooks, components, styles.css) + Vitest tests
  (happy-dom, Testing Library).
* `examples/react-vite/` demo with a mock handler covering every screen, built
  to a single static `preview/index.html` used for review.
* Build: `scripts/build.mjs` gains the three subpath bundles (React external)
  and `.d.ts`; `package.json` exports + optional peers.
* Docs: `guides/react.md` + `guides/react.es.md`.

## 9. Open decisions (Marvin)

* D-1: a Facta-*hosted* window (redirect/popup like a payment checkout) needs
  a new API resource («signing sessions» created with the API key, opened on a
  Facta domain). Not in this batch; the embedded window comes first.
* D-2: Web Component wrapper (`<facta-invoice-window>`) for non-React hosts.
* D-3: whether `review-prepared` should exist publicly at all given gaps.
* D-4: whether the buyer-facing recipient step should offer the Facta
  customer catalog search (requires `unlockKey` on the server, never browser).

## 10. Scope changes after review (5-Oct-2026)

Original prompts (Marvin, verbatim):

> pensaria que fuera mas simple, pensando en que los datos vengan bien desde el
> otro sistema, si, podemos mostrar errores y eso, pero permitir editarlos en
> caso de errores se siente muy drastico […] permitir que el modal se pueda
> integrar con el sistema, permitiendo cambiar algunos colores, tener como
> varias implementaciones disponibles, incluso ocultar que se emite con FactaDTE

> que pasa con los datos, estos componentens siguen manejando todo deal lado
> del server? que pasa con las sync de almacenamiento?

These supersede parts of §3–§7:

* The session request is final. No recipient step, no type switch, no
  `review-prepared` mode, no `prepare`/`sign` actions. Handler actions:
  `session.describe`, `issue`, `status` (status bound to the session with a
  `statusToken`). Errors are read-only and carry `fields: [{ path, message }]`
  when a path is literally present, so the host fixes data in its own form.
* `confirm={false}` issues on open (POS).
* Variants: `FactaInvoiceDialog`, `FactaInvoiceDrawer`, `FactaInvoiceInline`,
  `FactaIssueButton` (morphing), `FactaReceipt`, `useFactaWindow().open()`,
  headless `useFactaIssue`.
* `appearance` (theme, variables, density, motion), `classNames`, `unstyled`,
  `branding: { name, logo, attribution }`; `attribution: false` hides «Emitido
  con Facta DTE» (D-5 below).
* Storage: the handler uses `issueAndArchive` when the client has a runtime
  archive (`archive: "auto" | "required" | "off"`), so the integrator's
  encrypted archive and BYOS copies happen server-side; Facta-managed storage
  happens in the API. The browser gets only a `storage` summary; pending copies
  are recovered with `recoverOperation(operationId)` from a server job.
  `onIssued(result)` lets the integrator persist the full result.

## 11. Batch 2 — data providers and simple actions

Original prompt (Marvin, verbatim):

> agrega al plan, poder tener providers que nos brinden listados, y acciones
> que brinde el sdk para poder usarlas mas simples, que funciones podriamos?

### 11.1 Principle: two kinds of browser call

| Kind | Examples | Authorization |
| --- | --- | --- |
| **Reads** | lists, detail, downloads, catalog search, status | `authorize(req, { action })` + a server-declared `capabilities` allow-list. No session token. |
| **Fiscal writes** | issue, invalidate | Always a signed session created by the integrator's server from its own data. The browser never authors a fiscal payload. |

`capabilities` is declared once on the handler, e.g.
`{ documents: "read", downloads: true, catalog: "read", status: true,
invalidate: "session", storage: "read" }`. Anything not declared is
`action_not_allowed`. `authorize` receives the action name, so the host can
allow a cashier to list but not to invalidate.

### 11.2 Server: one handler, more actions (all wrap existing SDK methods)

| Action | SDK method | Notes |
| --- | --- | --- |
| `documents.list` | `listDocuments({ desde, hasta, estado, tipoDte, limit, cursor })` | cursor pagination; server-side `scope(req)` hook can force filters (e.g. only this branch) |
| `documents.get` | `getDocumentStatus(code)` | summary; receptor only if `exposeRecipient` |
| `documents.download` | `downloadDocument(code, "pdf" \| "json" \| "ticket")` | streamed bytes with filename; ticket width option |
| `documents.copies` / `documents.retryStorage` | `getDocumentCopies`, `retryDocumentStorage` | retry is idempotent, reads-tier but opt-in |
| `documents.holding` | `listHolding` | contingency queue |
| `catalog.customers.search` / `.get` | `searchCustomers`, `getCustomer` | needs `unlockKey` on the server; returns a display projection only |
| `catalog.products.search` / `.get` | `searchProducts`, `getProduct` | same |
| `service.status` | `status`, `diagnose` (reduced) | «Hacienda en línea / en contingencia» indicator |
| `storage.status` | `getStorageStatus` | quota bar |
| `invalidate` | `invalidateAndArchive` (or `invalidate`) | **session only**: `createFactaInvalidationSession({ generationCode, tipoAnulacion, motivo, codigoGeneracionReemplazo, responsable, solicita })`; the window only confirms |

Server conveniences (no fiscal logic added):
`createFactaSession.fromOrder(order, mapper)` typed mapper helper;
`createFactaInvalidationSession`; `facta.react.nextHandler()` /
`honoHandler()` / `expressHandler()` thin adapters.

### 11.3 Browser / React

Providers and hooks (cache + revalidation built in, no React Query dependency;
an adapter for TanStack Query is optional):

* `useFactaDocuments(filters)` → `{ items, loadMore, hasMore, loading, error, refresh }`
* `useFactaDocument(code)` → summary + `refresh`; polls while `contingencia`
* `useFactaCustomers(query)`, `useFactaProducts(query)` → debounced search
* `useFactaServiceStatus()` → `online | contingency | degraded`, polled gently
* `useFactaStorage()` → quota and state
* `useFactaActions()` → `download(code, kind)`, `retryStorage(code)`,
  `invalidate(sessionToken)` (opens the invalidation window), `copyCode`

Ready components (same appearance/branding system, all optional):

* `FactaDocumentList` — table on desktop, cards on phone; filters by date,
  type and state; status badges; row actions (PDF, JSON, ticket, copy code,
  anular when allowed); empty and loading states; infinite scroll or pages.
* `FactaDocumentDetail` — drawer with identifiers, totals, seal, copies,
  event history (contingency → sealed, invalidated).
* `FactaInvalidateDialog` — confirms a server-made invalidation session,
  shows the event seal on success.
* `FactaCustomerPicker`, `FactaProductPicker` — comboboxes over the catalog
  for host forms (they return the catalog id; the host's server builds the
  session with `customerId` / `productId`).
* `FactaServiceStatus` — small pill «Hacienda en línea» / «Contingencia».
* `FactaStorageMeter` — quota bar.
* `FactaDownloadButton` — PDF/JSON/ticket in one menu.

### 11.4 Open decisions for batch 2

* D-5: may attribution be hidden on every plan in the browser window (the PDF
  stays governed by the server and the plan)?
* D-6: does `documents.list` expose receptor names to the browser? They are
  personal data; default off, host opts in per handler.
* D-7: is invalidation from the browser in scope at all, or server-only?
* D-8: printing (`print`) uses a local transport on the integrator's machine;
  keep it out of the browser components?

## 12. Attribution text and run modes (5-Oct-2026)

Original prompt (Marvin, verbatim):

> me gusta, cambia el emitido con Facta por, Power by factadte.com, permite que
> se ejecute en automatico sin ningun click mas necesario, solo de abrir y dejar
> abierto el resultado, o incluso abrir y cerrar automaticamente para que el
> usuario muestre en su sistema el resultado ambos casos y claro el totalmente
> manual

* Attribution line is «Powered by factadte.com» (English on purpose, the
  domain as the name), rendered as text plus seal glyph; `attribution: false`
  still hides it.
* `run` prop replaces the boolean `confirm`:
  * `"manual"` (default): review → «Emitir factura» → result → «Listo».
  * `"auto"`: opens straight into issuing, no click; the result stays open
    until the person closes it.
  * `"auto-close"`: opens, issues, and closes itself; the host shows the result
    from `onIssued` / the `open()` promise. Options:
    `autoCloseDelay` (ms the result is visible before closing, default 1200,
    0 = immediately after the seal animation is skipped) and
    `autoCloseOn` (`"success"` default = sealed and contingency close, a
    rejection or failure stays open so the person can read it; `"any"` = close
    on every final state and let the host render the error from `onError`).
  * While closing in `auto-close`, a thin countdown bar under the header shows
    the remaining delay; any pointer/keyboard interaction inside the window
    cancels the auto-close (the person wanted to read it).
* `FactaIssueButton` keeps its own morph flow and accepts the same `run`
  values; `auto-close` there means the success popover is not shown.
