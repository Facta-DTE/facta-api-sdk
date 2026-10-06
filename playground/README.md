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
    guard.ts              fail-closed checks (key, host, secrets, dev bypass only on localhost)
    access.ts             Cloudflare Access JWT (RS256, JWKS) -> verified visitor e-mail
    quota.ts              20/hour and 100/day per visitor; QuotaCounter Durable Object
    fixtures.ts           demo customers/products from FACTA_DTE_FIXTURES_JSON
    issued-codes.ts       per-visitor record of issued documents (inside the QuotaCounter Durable Object)
    sale-credito-fiscal.ts  fallback builder for type 03 (used only if BUILDERS has none)
    sale.ts               validated sale description -> fiscal request (BUILDERS per DTE type)
    facta.ts              Facta client + createFactaHandler (capabilities, authorize)
    router.ts             GET /api/state · POST /api/session · POST /api/facta · GET /api/registro
  site/
    sections/registry.ts  the five routes; one folder per section (home, screens, headless, server, registro)
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
| Another DTE type in the sale builder | an entry in `BUILDERS` in `server/sale.ts` (+ test) |
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

`PLAYGROUND_DEV_BYPASS=1` (in `.dev.vars`) replaces Cloudflare Access with the e-mail in
`PLAYGROUND_DEV_EMAIL`, **only** when the request host is `localhost`/`127.0.0.1`; on any other
host the guard answers 503. Without the bypass, requests need a valid Access token.

Other scripts: `pnpm playground:typecheck`, `pnpm playground:test`, `pnpm playground:build`,
`pnpm playground:deploy:check` (bundles the Worker without uploading), and
`PLAYGROUND_BASE_URL=http://localhost:8787 pnpm playground:smoke` (add `PLAYGROUND_ISSUE=1` to issue one test Factura).

## Configuration

| Name | Kind | Notes |
| --- | --- | --- |
| `FACTA_API_KEY` | secret | A **dedicated** `facta_test_` staging key (environment 00). |
| `FACTA_SIGN_KEY` | secret | Its sign key (`factask_…`). |
| `FACTA_UNLOCK_KEY` | secret, optional | `factauk_…`; enables the catalog actions (key needs a readable catalog). |
| `FACTA_SESSION_SECRET` | secret | At least 32 random bytes: `openssl rand -base64 48`. |
| `FACTA_DTE_FIXTURES_JSON` | secret, optional | Demo data. Keeps the shape of the live test's `STAGING_FACTA_DTE_FIXTURES_JSON` (an object keyed by DTE type with complete test requests) and adds optional `customers: [{id,label,receptor}]` and `products: [{id,label,descripcion,precioUni,productId?}]`. |
| `ACCESS_TEAM_DOMAIN` | secret | `yourteam.cloudflareaccess.com`. |
| `ACCESS_AUD` | secret | The Access application's Audience (AUD) tag. |
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
3. **Create the Cloudflare Access application** (Zero Trust → Access → Applications → Self-hosted) for
   `playground.factadte.com` (the whole hostname) and for the workers.dev URL of the dev Worker, with
   an allow policy limited to the e-mail list you choose (one-time PIN). Copy each application's AUD
   tag into `ACCESS_AUD`.
4. **Attach the domain**: the `production` environment declares `playground.factadte.com` as a custom
   domain, so the first deploy of `main` creates the DNS record in the business account's zone.
5. **Add two GitHub secrets** to `Facta-DTE/facta-api-sdk` (Settings → Secrets → Actions):
   `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts: Edit; Workers Routes: Edit; Zone: Read and
   DNS: Edit for `factadte.com`) and `CLOUDFLARE_ACCOUNT_ID`. Until they exist, `playground-deploy.yml`
   validates and skips the upload.

## Safety notes

* Issuing needs a verified Access visitor; the e-mail comes from the verified token, never from a header
  the browser can set. A session token is bound to the visitor it was created for.
* E-mail delivery goes only to that verified address; WhatsApp is never requested.
* The browser sends a small sale description; the server builds the fiscal request (`server/sale.ts`).
* Quota (20/hour, 100/day) is counted per visitor in a Durable Object when an `issue` arrives; replaying
  the same session is free.
* The static CSP (`site/public/_headers`) allows only same-origin resources.

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
