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
    sale.ts               validated sale description -> fiscal request (BUILDERS per DTE type)
    facta.ts              Facta client + createFactaHandler (capabilities, authorize)
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
| A React screen example | a file in `site/sections/screens/`, imported by its `index.tsx`; show its source with `import src from "./file.tsx?raw"` and `<CodeBlock>` |
| A headless example | `site/sections/headless/`, same pattern |
| A server recipe | a fixed file `server/recipes/<name>.ts`, a route in `server/router.ts` behind `visitorOf` + quota, a card in `site/sections/server/` showing the file with `?raw`. Visitors never send code |
| Another DTE type in the sale builder | an entry in `BUILDERS` in `server/sale.ts` (+ test) |
| Another handler capability | `capabilities` in `server/facta.ts` |
| A new route | `handleApi` in `server/router.ts` (after the guard) |

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
