# Facta DTE playground

A Worker with static assets that runs the SDK for real against **staging** (environment 00):
the site (`site/`, Vite + React, imports the SDK from source) and its server (`/api/*`,
`worker.ts` + `server/`) in one deploy. Plan and decisions: [`docs/playground.md`](../docs/playground.md).

It is **not** part of the npm package (`package.json#files` does not list it) and it never
touches production: every `/api/*` request is refused with a 503 unless the key is a
`facta_test_` key and the API host is exactly `eobxzotnqzgtpuqvmpkc.supabase.co`.

## Layout

```
playground/
  wrangler.jsonc          Worker + assets + Durable Object (dev worker; `--env production` for main)
  worker.ts               entry: /api/* -> server/router.ts, everything else -> static assets
  server/
    guard.ts              fail-closed checks (key, host, secrets, auth mode, dev bypass only on localhost)
    visitor.ts            who is calling: signed HttpOnly cookie (Turnstile mode, default) or Access (below)
    turnstile.ts          siteverify of one single-use Turnstile token per costly action
    access.ts             Cloudflare Access JWT (RS256, JWKS) -> verified visitor e-mail (PLAYGROUND_AUTH=access)
    delivery.ts           e-mail rules: address validation, masking, hashed keys, the session with `deliver`
    mail-quota.ts         e-mail limits (visitor, IP, recipient, per-document cooldown); pure
    gates.ts              counts issues and e-mails on the visitor cookie AND the hashed IP (Durable Objects)
    quota.ts              20/hour and 100/day per visitor and per IP; QuotaCounter Durable Object (also holds the e-mail counters)
    fixtures.ts           demo customers/products from FACTA_DTE_FIXTURES_JSON
    issued-codes.ts       per-visitor record of issued documents (inside the QuotaCounter Durable Object)
    sale.ts               validated sale description -> fiscal request (BUILDERS per DTE type; sources catalog | demo | custom)
    sale-catalog.ts       confirms every catalog id exists in the key's catalog before a session is sealed
    receptor.ts           typed receivers per type (DUI 9 digits, NIT 14, NRC 2-8 and never zeros, required fields)
    facta.ts              Facta client + createFactaHandler (capabilities, authorize)
    router.ts             GET /api/state · POST /api/session · POST /api/facta · GET /api/registro
  site/
    sections/registry.ts  the five routes; one folder per section (home, screens, headless, server, registro)
    router.ts             GET /api/state · POST /api/session · POST /api/facta · POST /api/recipes/run
    issued-codes.ts       per-visitor record of issued documents (ownership checks)
    recipes/              fixed server recipes: one portable file each + redact/seal/runner/route/specs
  site/
    sections/server/      «Solo servidor»: recipe panel, results, copy for Node/Deno, project zip
    sections/registry.ts  the five routes; one folder per section (home, screens, headless, server, log)
    sections/home/        live invoice (FactaInvoiceDialog) + the code shown with ?raw
  test/                   vitest (node): guard, Access, quota, sale builder, router, packaging
  e2e/ + playwright.config.ts   smoke against PLAYGROUND_BASE_URL (not run in CI yet)
```

## Extension points for the next batches

| To add | Where |
| --- | --- |
| A React screen example | a file in `site/sections/screens/examples/`, imported by `screens/index.tsx` inside `<ExampleCard>` (`site/components/example-card.tsx`), with its source via `import src from "./file.tsx?raw"` |
| A headless example | `site/sections/headless/`, same pattern |
| A server recipe | a fixed file `server/recipes/<name>.ts`, a route in `server/router.ts` behind `visitorOf` + quota, a card in `site/sections/server/` showing the file with `?raw`. Visitors never send code |
| Another DTE type in the sale builder | an entry in `BUILDERS` and `RULES` in `server/sale.ts`, its typed-receiver shape in `server/receptor.ts` (+ tests in `test/sale-sources.test.ts`) |
| Another handler capability | `capabilities` in `server/facta.ts` |
| A new route | `handleApi` in `server/router.ts` (after the guard) |

## Issued documents per visitor (`server/issued-codes.ts`)

The playground key sees every playground document, so anything that reads documents is scoped to what
the visitor issued. The handler's `onIssued` hook records every sealed or contingency result under the
verified e-mail, inside that visitor's `QuotaCounter` Durable Object (last 200 entries; only code, type,
control number, time and state; nothing else about the receiver or the files).

```ts
recordIssued(env, email, { codigoGeneracion, tipoDte, numeroControl, estado }): Promise<void>
listIssued(env, email): Promise<IssuedEntry[]>          // newest first, at most MAX_ISSUED (200)
ownsDocument(env, email, code): Promise<boolean>        // case-insensitive; false for anything that is not a code or on any error
updateIssuedState(env, email, code, estado): Promise<void>
```

`env` is the Worker environment (only `QUOTA` is used). **Server recipes and invalidation must call
`ownsDocument` before acting on a code.** `POST /api/facta` already does it for `documents.get`,
`documents.download`, `documents.copies` and `documents.retryStorage` (403 `document_not_yours`);
`documents.list` and `documents.holding` are not filtered by the handler, so screens that show them list
other visitors' codes (but cannot open them): use `GET /api/registro` for «my documents».
`GET /api/registro` returns the visitor's entries with the API's current state (the 25 newest are read).

## Run locally

```sh
pnpm install
cp playground/.dev.vars.example playground/.dev.vars     # git-ignored; fill in a STAGING test key
pnpm playground:dev                                      # builds the site, then wrangler dev on :8787
```

Locally the playground uses Cloudflare's documented Turnstile **test keys** (`.dev.vars.example`): the widget always
passes, so nothing else is needed. With `PLAYGROUND_AUTH=access` the old behaviour is available:
`PLAYGROUND_DEV_BYPASS=1` replaces Cloudflare Access with the e-mail in `PLAYGROUND_DEV_EMAIL`, **only** when the request
host is `localhost`/`127.0.0.1`; on any other host the guard answers 503.

Other scripts: `pnpm playground:typecheck`, `pnpm playground:test`, `pnpm playground:build`,
`pnpm playground:deploy:check` (bundles the Worker without uploading), and
`PLAYGROUND_BASE_URL=http://localhost:8787 pnpm playground:smoke` (add `PLAYGROUND_ISSUE=1` to issue one test Factura).

## Configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `FACTA_API_KEY` | secret | A **dedicated** `facta_test_` staging key (environment 00). |
| `FACTA_SIGN_KEY` | secret | Its sign key (`factask_…`). |
| `FACTA_UNLOCK_KEY` | secret, optional | `factauk_…`; enables the catalog actions: the React pickers and the sale builder's «Catálogo de la llave» source (the Worker confirms each catalog id with `getCustomer` / `getProduct`, which read the decrypted snapshot). Without it the source is disabled. |
| `FACTA_SESSION_SECRET` | secret | At least 32 random bytes: `openssl rand -base64 48`. |
| `FACTA_DTE_FIXTURES_JSON` | secret, optional | Demo data. Keeps the shape of the live test's `STAGING_FACTA_DTE_FIXTURES_JSON` (an object keyed by DTE type with complete test requests) and adds optional `customers: [{id,label,receptor}]` and `products: [{id,label,descripcion,precioUni,productId?}]`. |
| `TURNSTILE_SITEKEY` | var or secret | Public site key of the Cloudflare Turnstile widget (managed mode, hostname of the deployment). |
| `TURNSTILE_SECRET` | secret | The widget's secret key; only the Worker reads it. |
| `PLAYGROUND_AUTH` | var, optional | `turnstile` (default) or `access`. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | secret, optional | Only with `PLAYGROUND_AUTH=access`: `yourteam.cloudflareaccess.com` and the application's AUD tag. |
| `FACTA_API_BASE_URL` | var (in `wrangler.jsonc`) | Must be the staging host; there is no default on purpose. |
| `PLAYGROUND_DEV_BYPASS`, `PLAYGROUND_DEV_EMAIL` | local only | See above. Never set them on a deployed Worker. |

Bindings: `ASSETS` (the built site) and `QUOTA` (Durable Object `QuotaCounter`, SQLite-backed).

## What Marvin has to do once

1. **Mint a dedicated staging key** in staging's *Llaves de la API*, environment 00, with `issue`,
   `query` and `download` scopes and a readable catalog (so revoking it never breaks the CI key).
2. **Set the Worker secrets**, once per Worker (`facta-playground-dev` and `facta-playground`):
   ```sh
   pnpm exec wrangler secret put FACTA_API_KEY -c playground/wrangler.jsonc --env ""
   # …same for FACTA_SIGN_KEY, FACTA_SESSION_SECRET, ACCESS_TEAM_DOMAIN, ACCESS_AUD (and the optional ones)
   # for main: --env production
   ```
   The first `wrangler deploy` creates the Worker; secrets can be set right after it.
3. **Create the Turnstile widget** (Cloudflare dashboard → Turnstile → Add widget, business account): hostnames
   `playground.factadte.com` and the dev Worker's workers.dev host, mode *Managed*. Put the **site key** in
   `TURNSTILE_SITEKEY` and the **secret key** in `TURNSTILE_SECRET` (`wrangler secret put`, per Worker). Visitors stay
   anonymous: no allow-list, no Access application. (To keep Access instead, set `PLAYGROUND_AUTH=access` and the `ACCESS_*`
   secrets, as before.)
4. **Attach the domain**: the `production` environment declares `playground.factadte.com` as a custom
   domain, so the first deploy of `main` creates the DNS record in the business account's zone.
5. **Add two GitHub secrets** to `Facta-DTE/facta-api-sdk` (Settings → Secrets → Actions):
   `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts: Edit; Workers Routes: Edit; Zone: Read and
   DNS: Edit for `factadte.com`) and `CLOUDFLARE_ACCOUNT_ID`. Until they exist, `playground-deploy.yml`
   validates and skips the upload.

## Safety notes

* **Anonymous visitors, signed cookie.** `GET /api/state` mints `facta_pg_visitor` (random id, HMAC with
  `FACTA_SESSION_SECRET`, HttpOnly, SameSite=Lax, Secure off localhost, 30 days). The id keys ownership
  (`issued-codes`), Registro and the per-visitor quotas. A session token is bound to the visitor it was created for.
* **Turnstile on everything that costs.** One single-use token (`x-turnstile-token`) is verified against
  `https://challenges.cloudflare.com/turnstile/v0/siteverify` (secret, token, the caller's IP and the expected hostname) for:
  each issue **session** (`POST /api/session`), each e-mail send or **resend** (`POST /api/delivery/resend`), each recipe run that
  issues, invalidates or sends, and each **invalidation**. The page renders the managed widget (Spanish) beside the button.
  The CSP allows `https://challenges.cloudflare.com` for scripts and frames and nothing else external.
* **Issue quota: 20/hour and 100/day per visitor cookie and the same per IP** (`cf-connecting-ip`, hashed), counted at `issue`.
* **E-mail** goes to any valid address the visitor types (syntax, ≤ 254 characters, no spaces, commas or CR/LF), always the
  standard Facta DTE delivery of a test document with no visitor text. Limits (server-side, 429 with `Retry-After`, «Se alcanzó el
  límite de envíos»): **5/hour and 20/day per visitor cookie and per IP**, **2/day per recipient across all visitors** (the address is
  normalised and hashed with a pepper, never stored in clear), **one resend per document every 10 minutes**, resend only for a
  document the visitor owns. The recipient is shown masked (`m•••@ejemplo.com`).
* **WhatsApp is never requested**: `deliveryFor` builds `{ email }` only, any body that mentions WhatsApp is refused
  (`channel_not_allowed`), and a test greps the server for a WhatsApp channel. The page shows it disabled, with a local
  «demostración» of the «Sin saldo de WhatsApp» row.
* **Resend** uses the delivery token Facta returns at issue (valid 5 minutes), kept by the Worker in the visitor's Durable Object
  and never sent to the browser, and goes to the address marked at issue. The API sends once per channel, so after the first send
  it returns the current state; after 5 minutes it answers `410 delivery_window_closed` (the API has no token renewal yet, D-9 of
  `docs/api-delivery-tokens.md`).
* The browser sends a small sale description; the server builds the fiscal request (`server/sale.ts`).
* Replaying the same session is free (same idempotency key).
* The static CSP (`site/public/_headers`) allows only same-origin resources and the Turnstile origin.

## Entrega («Pantallas React → Entrega»)

`examples/delivery.tsx` (shown beside its demo): the address field, the Turnstile widget, `createSession` with
`sendEmail`/`emailTo`, `FactaInvoiceDialog` with `onDelivery`, the real SDK receipt with its «Entrega por correo» row, and
«Reenviar por correo». The `server.ts` tab is `server/delivery.ts` (`createDeliverySession`, the rules); the «Solo servidor» tab
is recipe 8 (`server/recipes/deliver-email.ts`: `issue` with `deliver`, `deliverEmail`, `waitForDelivery`). In mock mode
(`?mock=1`) add `&outcome=sealed-delivered|sealed-delivering` and `&resend=limit|closed` to see each state.

## Source links («Ver en GitHub»)

Every file the page shows is imported with `?raw` in **one** module, `site/shown-files.ts`, next to its repository path; code panels
and recipes link to `https://github.com/Facta-DTE/facta-api-sdk/blob/main/<path>`. `test/source-links.test.ts` checks that each path
exists and holds exactly the text shown, and that no other module imports `?raw`. The top bar, Inicio and the footer link the
repository, `playground/`, the npm package and the docs (license: MIT). Until the playground is promoted to `main` the `main` links 404.

## Screens section (`site/sections/screens/`)

* `sale-builder.tsx` describes a sale (type, demo customer or a typed name for a Factura, lines, e-mail); the server
  builds the request. API v1 types: 01, 03, 05, 06, 11, 14. Notes (05/06) can only relate documents the visitor
  issued here. Receivers always come from `FACTA_DTE_FIXTURES_JSON` (`customers`, or the `"03"`/`"05"`/… request's own
  `receptor`); the API request has no discount field, so there are no discounts.
* `examples/*.tsx` are the executed examples; each is shown beside its demo through `?raw`.
* Invalidation: `POST /api/invalidation` seals a session only after `ownsDocument`; the responsible people come from
  the optional `invalidation: { responsable, solicita }` fixture (without it the endpoint answers 503). The session's
  idempotency key carries the visitor tag, so another visitor cannot use the token.
* The key sees every playground document, so `documents.list` answers only the visitor's own codes and
  `documents.holding` is refused.
* Appearance studio: `appearance-code.ts` (pure, tested) prints the JSX the preview applies.
* **Mock mode** (Vite dev server only, never in a production build): `pnpm exec vite --config playground/vite.config.ts`
  then open `/pantallas?mock=1[&outcome=rejected]`. It reuses `examples/react-preview/src/mock-handler.ts`.
## Server recipes («Solo servidor»)

Each recipe is one file in `server/recipes/` that exports `run(facta, input)` and a `sample`. The Worker
executes that exact file; the page shows it with `?raw`. A visitor sends only form parameters to
`POST /api/recipes/run` (`{recipe, stage?, runId?, params}`); `recipes/index.ts` validates them and builds the input
from the demo data, so no visitor code ever runs.

* **Quota:** only recipes that issue or invalidate count, by idempotency key (`<visitorTag>.<runId>…`). «Reintentar con la
  misma llave» reuses the `runId`, so it is free. A webhook order uses `<visitorTag>.order-<orderId>`.
* **Ownership:** invalidation, download, copies and the document list use `issued-codes.ts` (`ownsDocument`,
  `listIssued`); issuing records through `recordIssued`, invalidating through `updateIssuedState`.
* **Two-stage recipe** (`prepare-sign`): the prepared document travels as an AES-GCM blob (`seal.ts`) bound to the
  visitor, valid 10 minutes. The `prepareToken` never reaches the page.
* **Redaction** (`redact.ts`) removes credential and storage keys, scrubs known secret values and credential/path shapes,
  and omits bulky members (`jws`, `archivoJson`, `representacionGrafica`, `documento` unless kept). PDF/JSON become files.
* **Copy for Node / Deno / Bun and the project zip** are generated from the same file (`site/sections/server/export.ts`):
  the import is pointed at `@facta-dte/api` and keys are read from environment variables.
* **«Abrir en StackBlitz» is not offered.** Its POST-form method needs no script, but `api-v1` answers the CORS preflight
  (checked 6-Oct-2026) without `Access-Control-Allow-Origin`, so WebContainers could not call it from the browser. The
  button is a download of a ready-to-run project that asks for the developer's own test key in `.env`.
* **Add a recipe:** a file under `recipes/`, an entry in `specs.ts`, a binder in `recipes/index.ts`, its `?raw` import in
  `site/sections/server/sources.ts`, and tests in `test/recipes.test.ts`.

## Sale builder: where the receiver and the lines come from

`POST /api/session` takes `receptor: { source: "catalog" | "demo" | "custom", customerId?, custom? }` and
`lines[].source` with the same three values.

| Source | Receiver | Line |
| --- | --- | --- |
| `catalog` | `{ customerId }` for 01, 03, 05, 06 (the API's `Recipient`; 11 and 14 have no `customerId`) | `{ productId, cantidad }` |
| `demo` | a fixture customer by id | a fixture product by id |
| `custom` | typed fields, per type (see `server/receptor.ts`) | description, quantity, price, **item type bien/servicio chosen by the visitor**, optional code |

**Catalog resolution.** The session carries ids only (the token is signed, not encrypted, so no customer data is copied
into it). At issue time the SDK (0.3.0) reads `/v1/status`: with `llave.catalogMode: "readable"` the ids go to the API
unchanged and the API resolves them; otherwise the SDK resolves them from the key's decrypted snapshot and needs the unlock
key. Either way the Worker confirms each id with `getCustomer` / `getProduct` before sealing, so a forged id is refused with
`customer_not_in_catalog` / `product_not_in_catalog`; that lookup needs `FACTA_UNLOCK_KEY`, so without it the source is off
(`catalog_unavailable`). Catalog products must match the document's price basis (the SDK's own rule: `vat_included` for 01,
excluded for the rest).

**Typed receivers** (never stored, only validated and placed in the signed session): DUI 9 digits (a typed dash is
removed), NIT 14 digits, NRC 2 to 8 digits and never all zeros; 03/05/06 require name, NIT or DUI, NRC, activity code and
description, address and e-mail; 11 the export receptor (country code, country name, address, `tipoPersona`, activity,
e-mail); 14 name, document and address. Department, municipality, activity and country codes are typed as codes: the SDK
ships no CAT list, and Hacienda's verdict decides.
