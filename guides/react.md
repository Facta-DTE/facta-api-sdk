# Signing window for React

`@facta-dte/api/react` renders the invoice window next to your own UI. The data
comes from your server (see [react-server.md](react-server.md)); the window only
reviews, issues and shows the result.

```tsx
import { FactaProvider, FactaInvoiceDialog } from "@facta-dte/api/react";
import "@facta-dte/api/react/styles.css";

<FactaProvider endpoint="/api/facta">
  <FactaInvoiceDialog session={token} open={open} onOpenChange={setOpen} />
</FactaProvider>
```

## Run modes

`run` replaces the old boolean `confirm`. It works on `FactaInvoiceDialog`,
`FactaInvoiceDrawer`, `FactaInvoiceInline`, `FactaIssueButton`,
`useFactaIssue` and `useFactaWindow().open(session, options)`.

| `run` | Behaviour |
| --- | --- |
| `"manual"` (default) | Review, press «Emitir factura», read the result, press «Listo». |
| `"auto"` | Issues as soon as it opens. The result stays until the person closes it. |
| `"auto-close"` | Issues, shows the result for `autoCloseDelay` ms (default 1200, `0` = at once) and closes itself. |

`autoCloseOn` is `"success"` (default: sealed and contingency close; a rejection,
failure or expired session stays open so it can be read) or `"any"` (every final
state closes; render errors from `onError`). A 3 px countdown bar sits under the
header (text only with reduced motion); any pointer, key or focus event inside
the window cancels it. Auto-close never fires while issuing or verifying.
`onIssued` runs before the window closes and the `open()` promise resolves with
the result once it has.

On `FactaIssueButton`, `auto` and `auto-close` start on mount, and `auto-close`
shows no success popover.

## Customize

Three layers, from coarse to fine. All are optional.

### 1. Tokens (`appearance`)

```tsx
<FactaProvider
  endpoint="/api/facta"
  appearance={{
    theme: "auto",              // light | dark | auto
    density: "compact",         // comfortable | compact
    motion: "reduced",          // full | reduced | none
    variables: { accent: "#6d4bd8", radius: "4px", headingFontFamily: "Georgia, serif" },
  }}
/>
```

Colour: `accent`, `accentInk`, `accentSoft`, `background`, `surface`, `text`,
`muted`, `border`, `success`, `warning`, `danger`, `shadow`.
Shape and type: `radius`, `radiusSm`, `fontFamily`, `headingFontFamily`.

Size and spacing (CSS variable, default comfortable / compact):

| Variable key | CSS custom property | Default |
| --- | --- | --- |
| `fontSizeBase` | `--facta-font-size` | 15px |
| `titleSize` | `--facta-title-size` | 18px |
| `totalSize` | `--facta-total-size` | 32px |
| `buttonHeight` | `--facta-button-height` | 44px / 38px (44px on touch) |
| `downloadHeight` | `--facta-download-height` | 56px / 48px |
| `space` | `--facta-space` | 20px / 16px (padding of header, body, footer) |
| `gap` | `--facta-gap` | 12px / 8px |
| `windowWidth` | `--facta-window-width` | 480px |
| `drawerWidth` | `--facta-drawer-width` | 440px |

Density only moves the defaults; a value you set always wins. You can set the
same custom properties from your own CSS on any ancestor instead.

Derived tokens: set `accent` and `accentInk` is picked for WCAG 4.5:1 between
`#ffffff` and `#0b1419` (a one-time development warning appears if neither
reaches it; hex and `rgb()` accents only) and `accentSoft` is mixed with the
window colour. Set `background` and `surface` and `border` follow; set `text` and
`muted` follows; `radiusSm` is `round(radius × .64)`, minimum 2px.

### 2. Per-slot `styles` and `classNames`

```tsx
<FactaInvoiceDialog
  session={token}
  open={open}
  styles={{
    primaryButton: { height: 52, borderRadius: 999 },
    downloadButton: { height: 64 },
    total: { fontSize: 40 },
  }}
  classNames={{ footer: "my-footer" }}
/>
```

`styles` (React `CSSProperties`) is merged after ours; it can also be set on the
provider or inside `appearance.styles`, and the component wins over the provider.
Slots, shared by `styles`, `classNames` and the `data-facta-slot` attribute:
`root`, `overlay`, `card`, `header`, `title`, `chip`, `body`, `footer`,
`primaryButton`, `secondaryButton`, `downloadButton`, `statusIcon`, `total`,
`identifiers`, `storageRow`, `attribution`, `countdown`, `stepper`, `fieldList`,
`quote`. `unstyled` drops every default class if you bring all the CSS.

### 3. Your own CSS: data attributes

Every slot element carries `data-facta-slot="<slot>"`. The root (and the overlay
of a dialog or drawer) also carries:

* `data-facta-state`: `loading`, `review`, `issuing`, `verifying`, `sealed`,
  `contingency`, `rejected`, `failed`, `expired` (the button: `idle`, `working`,
  `done`, `contingency`, `failed`);
* `data-facta-run`: `manual`, `auto`, `auto-close`;
* `data-facta-variant`: `dialog`, `sheet`, `drawer`, `inline`, `button`;
* `data-facta-theme`, `data-facta-density`, `data-facta-motion`.

```css
[data-facta-state="sealed"] [data-facta-slot="total"] { color: #0a7a43; }
[data-facta-variant="sheet"] [data-facta-slot="downloadButton"] { height: 64px; }
.my-pos [data-facta-slot="attribution"] { opacity: .6; }
```

The stylesheet keeps every selector at one class of specificity (state, theme
and motion switches sit inside `:where()`), so a single-class rule in your CSS
wins when it loads later, or inside a layer ordered after ours, with no
`!important`. A guard test enforces it.

## Data components

Lists, details, downloads, catalog pickers, status and storage come from the
same package and the same look (`appearance`, `branding`, `styles`,
`classNames`, `data-facta-slot`, «Powered by factadte.com»). Your handler must
declare what the browser may read; see **Capabilities** in
[react-server.md](react-server.md#capabilities).

```tsx
<FactaProvider endpoint="/api/facta">
  <FactaDocumentList onInvalidate={(row) => fetchInvalidationToken(row.codigoGeneracion)} />
  <FactaServiceStatus />
  <FactaStorageMeter warnAt={85} />
  <FactaCustomerPicker onChange={(c) => setCustomerId(c?.id ?? null)} />
  <FactaProductPicker onSelect={(p) => addLine(p.id)} />
</FactaProvider>
```

| Component | What it does |
| --- | --- |
| `FactaDocumentList` | Table above 640 px, cards below. Filters by period, type and state (the API filters one of each) and a control-number search over the rows already loaded. Row menu: PDF, JSON, ticket, copy code, detail, and «Anular» when you pass `onInvalidate`. «Cargar más» pagination, skeleton, empty and error states. |
| `FactaDocumentDetail` | Right drawer (bottom sheet on phones) or `presentation="inline"`: identifiers with copy, totals exactly as the server returned them, receiver (only when exposed), copies with «Reintentar», timeline. Polls while the document is in contingency. |
| `FactaDownloadButton` | Split button, PDF by default; `variant` `solid` · `outline` · `icon`, `size` `md` · `sm`. |
| `FactaCustomerPicker`, `FactaProductPicker` | Accessible comboboxes (↑↓ Enter Esc, match highlight, 250 ms debounce, 2 characters minimum). They return the catalog `id`; your server builds the session with `customerId` / `productId`. |
| `FactaServiceStatus` | Pill, or `variant="dot"` (44 px target) for a POS header. |
| `FactaStorageMeter` | Normal, near (≥ `warnAt`, default 85 %), full and unconfigured. |
| `FactaInvalidateDialog` | Read-only confirmation of a server-made invalidation session; shows the event seal or Hacienda's message verbatim. Usually opened with `useFactaActions().invalidate(token)`. |

Headless hooks, all under `FactaProvider` and sharing one stale-while-revalidate
cache: `useFactaDocuments(filters)` (`items`, `loadMore`, `hasMore`, `loading`,
`error`, `refresh`), `useFactaDocument(code)`, `useFactaCustomers(query)`,
`useFactaProducts(query)`, `useFactaServiceStatus()` (polls every 60 s, paused
while the tab is hidden), `useFactaStorage()` and `useFactaActions()`
(`download`, `retryStorage`, `invalidate(sessionToken)`, `copyCode`).

`FactaClient` in `@facta-dte/api/browser` has the same reads for any framework:
`listDocuments`, `getDocument`, `downloadDocument`, `getDocumentCopies`,
`retryDocumentStorage`, `searchCustomers`, `searchProducts`, `getServiceStatus`,
`getStorageStatus`, `describeInvalidation`, `invalidate`, plus `createFactaCache`.

Extra slots for these components: `list`, `row`, `detail`, `menu`, `field`,
`option`, `pill`, `meter`, `dialog`.
