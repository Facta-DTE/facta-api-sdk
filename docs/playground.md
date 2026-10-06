# Facta DTE playground: a live examples site on the staging API

Status: plan approved 6-Oct-2026 (D-1..D-7 as recommended). Batch A (foundation) is implemented in `playground/`; see `playground/README.md`.

## Original prompt (Marvin, verbatim)

> vamos a crear un sitio de ejemplos potente, quiero poder usar las pantallas
> que ya tenemos en react, quiero hacer mis propias implementaciones, quiero
> usarlo solo del lado del servidor, quiero que hagas un playground que pueda
> hacer facturas con el entorno staging que tenemos, lo que ya tenemos, pero
> usando esas mismas variables de entorno tener un sitio de pruebas, no se si
> lo tenemos en github pages o en cloudflare, primero analiza y crea el plan
> para eso, cuando lo tengas me dices, luego lo vamos a diseñar y por ultimo lo
> vamos implementar

## 1. What exists today (verified 6-Oct-2026 against `main`, version 0.3.0)

| Piece | Where | What it gives the playground |
| --- | --- | --- |
| Server client `Facta` | `src/client.ts` | `issue`, `prepare`/`sign`, `invalidate`, `getDocumentStatus`, `listDocuments`, downloads, catalog, managed storage, BYOS copy reports. `baseUrl` defaults to **production** (`hcnvknpsbadplnfcflxx`). |
| Server handler | `src/server/` (`createFactaSession`, `createFactaHandler`, `createDataActions`, `createFactaInvalidationSession`) | Runtime-neutral `Request → Response`. Holds `apiKey`/`signKey`; the browser only gets a signed session token. Read actions: documents list/get/download/copies/retryStorage/holding, customer and product search/get, service and storage status; invalidation. |
| Headless browser client | `src/browser/` (`./browser` export) | Issuance state machine without React. Basis for «my own implementation». |
| React screens | `src/react/` (`./react` export) | `FactaInvoiceDialog`, `FactaInvoiceDrawer`, `FactaInvoiceInline`, `FactaIssueButton`, `useFactaIssue`, `useFactaWindow`, `FactaReceipt`, `FactaStatusBadge`, `FactaDocumentList`, `FactaDocumentDetail`, `FactaDownloadButton`, `FactaCustomerPicker`, `FactaProductPicker`, `FactaServiceStatus`; appearance tokens, `classNames` slots, message overrides. |
| Design preview | `examples/react-preview/` → `preview/index.html` | The same React screens against a **mock** handler (`mock-handler.ts`, nine outcomes). Static, single file. No real invoice. |
| Server examples | `examples/hola-factura.ts`, `dte-types.ts`, `managed-storage.ts`, `workflows.ts` | Scripts that run from a terminal with `.env`. |
| Staging live test | `.github/workflows/sdk-live-integration.yml` | Already emits a test FE against staging with repository secrets `STAGING_FACTA_API_KEY`, `STAGING_FACTA_SIGN_KEY`, `STAGING_FACTA_UNLOCK_KEY`, `STAGING_FACTA_DTE_FIXTURES_JSON` and base URL `https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1`. |

What is missing is a place where those pieces run **for real** against staging,
with a server that holds the key, and where a developer can see the code
beside the result.

«Las pantallas que ya tenemos en React» here means the SDK's React screens
above. The Facta web app's own screens (`apps/web`) are not packaged and stay
out of scope; the SDK screens were designed from them.

## 2. Hosting: Cloudflare, not GitHub Pages

GitHub Pages serves static files only. A playground that issues invoices needs
a server that holds the staging API key and sign key, so GitHub Pages can host
at most the mock preview. Facta's sites already run on Cloudflare (Pages for
`www`, `staging`, `sdk`; Workers for status, JSON viewer, managed storage,
clock), on the business account.

**Recommendation:** one Cloudflare Worker with static assets
(Workers Static Assets) serving both the site and its `/api/*` server, at
**`playground.factadte.com`** (alternative name to decide: `ejemplos.factadte.com`).
One deploy, one domain, secrets as Worker secrets, no CORS. The SDK's server
handler runs on Workers unchanged (it uses only `fetch` and WebCrypto; the
`node:` imports are confined to `./node` and `./file-archive`, which the
playground does not load).

`sdk.factadte.com` links to it from its header and from each SDK page section
(«Probar en vivo»).

## 3. Where the code lives

In this repository, under `playground/`, built from the package's own source.
That way every SDK change is exercised by the playground in the same PR, and
the playground can never document an API the SDK does not have. Deploys:

| Branch | Deploy | API |
| --- | --- | --- |
| `dev` | `playground-dev` (workers.dev URL, for review) | staging |
| `main` | `playground.factadte.com` | staging |

Both talk to **staging only**. There is no production mode.

## 4. Credentials and safety

* **Same variables as the live test**, as Worker secrets:
  `FACTA_API_KEY`, `FACTA_SIGN_KEY`, `FACTA_UNLOCK_KEY` (optional),
  `FACTA_API_BASE_URL` (staging), `FACTA_SESSION_SECRET` (new, ≥ 32 bytes),
  `FACTA_DTE_FIXTURES_JSON` (demo customers and products).
* **Recommended: a dedicated staging key for the playground**, minted by Marvin
  in staging's Llaves de la API (environment 00, catalog readable), instead of
  reusing the CI key. Revoking one never breaks the other, and the API's own
  per-key rate limit then protects the CI test from playground traffic.
* **Fail closed at start-up:** the Worker refuses every request when the key is
  `facta_live_*` or the base URL is not the staging host. A test pins this.
* **Who may issue:** the site is public to read, but issuing, invalidating and
  reading documents need a signed-in visitor. Recommended: **Cloudflare Access**
  (one-time e-mail code; free tier) on `/api/*` and the issuing pages, with an
  allow-list Marvin controls. Alternative for a public launch later:
  Turnstile + per-IP quota.
* **Quotas inside the Worker** (in addition to the API's): issues per visitor
  per hour and per day, kept in a Durable Object or KV; clear «límite alcanzado»
  copy.
* **Visitors never see a credential**, a bucket name or a path: the handler's
  projections already strip them.
* Every playground document is a real environment-00 DTE transmitted to the
  Ministry's test service and spends a staging control number. That is the
  point (it is what «hacer facturas» means) and it is harmless in 00; the
  quotas keep it bounded.
* **No user code ever runs on the Worker.** Editing and running custom code is
  offered through «Abrir en StackBlitz» with a template that asks for the
  developer's own test key (§5.4), never with the playground's key.

## 5. What the site contains

### 5.1 Inicio
What the SDK is, three paths (screens, own UI, server only), the live service
status (`FactaServiceStatus`) and the latest playground invoices.

### 5.2 Pantallas React (the existing screens, live)
Each screen runs against the real staging handler, with its code beside it:

* Issue: `FactaInvoiceDialog`, `FactaInvoiceDrawer`, `FactaInvoiceInline`,
  `FactaIssueButton`, run modes `manual` / `auto` / `auto-close`.
* After issuing: `FactaReceipt`, `FactaStatusBadge`, `FactaDownloadButton`
  (PDF, JSON, ticket), delivery by e-mail (to the signed-in visitor's own
  address only; WhatsApp off in the playground).
* Data: `FactaDocumentList`, `FactaDocumentDetail`, `FactaCustomerPicker`,
  `FactaProductPicker`, invalidation dialog.
* A sale builder: pick a document type (FE, CCF, FEX, FSE, NR, NC, ND…, as far
  as the API supports them), a demo customer or a typed one, lines and
  discounts; the server builds the session from it.
* Appearance studio: theme, density, motion, accent, radius, fonts, branding,
  `classNames` slots and messages, with a «Copiar código» of the resulting
  props. Reuses the three presets of the current preview.

### 5.3 Mi propia implementación (headless)
Examples built with `@facta-dte/api/browser` and `useFactaIssue` without the
SDK's components: a checkout form, a point-of-sale keypad, a «¿necesita
crédito fiscal?» switch. Each one shows the 30–60 lines it takes.

### 5.4 Solo servidor
For developers who never put Facta in a browser. Each example is a server
recipe shown as code, with a **«Ejecutar en staging»** button that runs that
exact recipe on the Worker (fixed recipes, parameters from a form, never
arbitrary code) and shows the request, the response, timings and the files:

* Issue an FE / a CCF, with idempotency and a retry with the same key.
* `prepare` → review → `sign`.
* Status lookup and recovery after an uncertain response.
* Invalidation.
* List and download documents; managed storage copies.
* Catalog references (`customerId`/`productId`) with a readable key.
* Webhook-style flow: an order in, a sealed document out.
Each recipe also offers «Copiar para Node», «Copiar para Deno/Bun» and a downloadable project
that asks for the developer's own test key. StackBlitz is not offered because `api-v1` sends no CORS
headers (decision recorded in `playground/README.md`).

### 5.5 Registro
A per-visitor log of the documents issued from the playground (code, type,
state, links to the JSON viewer and the PDF), read from the API, not stored by
the playground.

## 6. Build

* Vite + React 19 for the site, importing the SDK from `../` source (like
  `examples/react-preview`), so the playground and the package never diverge.
* The Worker (`playground/worker.ts`) mounts `createFactaHandler`,
  `createDataActions`, the invalidation handler and the recipe runner, all
  behind the Access check and the quota.
* Code samples are the real files the page runs, imported as raw text, so the
  shown code cannot drift from the executed code.
* Tests: unit tests for the recipe runner and the fail-closed guard; a
  Playwright smoke against the `dev` deploy that issues one FE end to end.
* CI: the existing `ci.yml` builds the playground; a new deploy job publishes
  `dev` and `main` with Wrangler (token as a GitHub secret).

## 7. Phases

1. **Plan** (this document) — Marvin approves.
2. **Design** — boards for Inicio, Pantallas React, Mi propia implementación,
   Solo servidor, Registro, at 1280×800 and 390×844, using the SDK's
   `docs/design/react-ui/` language and the portal's chrome. Marvin approves.
3. **Implementation** — batches: (a) Worker + guard + Access + quota +
   one live FE; (b) React screens gallery; (c) server recipes; (d) headless
   examples; (e) appearance studio and StackBlitz templates; (f) deploys and
   the link from `sdk.factadte.com`.
4. **Show Marvin** on `playground-dev`, then promote to `main`.

## 8. Decisions for Marvin

| # | Question | Recommendation |
| --- | --- | --- |
| D-1 | Hosting | Cloudflare Worker with static assets (GitHub Pages cannot hold the key). |
| D-2 | Domain | `playground.factadte.com` (or `ejemplos.factadte.com`). |
| D-3 | Key | A dedicated staging key for the playground, not the CI key. Marvin mints it. |
| D-4 | Who may issue | Cloudflare Access with an e-mail allow-list now; Turnstile + quotas only if it opens to the public. |
| D-5 | Quotas | 20 issues per visitor per hour, 100 per day. |
| D-6 | Delivery | E-mail only to the visitor's own address; WhatsApp off. |
| D-7 | Code location | `playground/` in this repository, built from the SDK source. |

## 9. What Marvin will need to do

* Mint the playground key in staging and give it to the Worker with
  `wrangler secret put` (or let the deploy job read it from GitHub secrets).
* Approve the Cloudflare Access policy (who gets in).
* Create the DNS record for the chosen subdomain (or let the deploy attach it).
