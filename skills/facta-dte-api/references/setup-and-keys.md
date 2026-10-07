# Setup, keys, environments and the HTTP API

Sources: `README.md`, `guides/node.md`, `guides/deno.md`, `guides/region.md`,
`.env.example`, `src/client.ts`, the OpenAPI contract (`info.description`).

## Install

The package is `@facta-dte/api` (ESM, Node.js 22+, Deno, Bun; TypeScript 5.9+ to
compile). It has no runtime dependencies. `react` / `react-dom` are optional
peers, needed only for `@facta-dte/api/react`.

```sh
# 1. What is published? `latest` is the approved stable release.
npm view @facta-dte/api version dist-tags
pnpm add @facta-dte/api            # or: npm install @facta-dte/api
```

**Version `0.5.0` or later is needed for the newest methods** (`0.5.0` is on npm; the skill itself ships in
the package, `0.5.1` and later target the public API explicitly). It adds, among others, the Archivo
DTE as the default JSON download, catalog writes, regional pinning, debug
timings, the emergency safeguard and the return event. If `npm view` shows an
older version and you need those, install from the repository:

```sh
# pnpm 10: git-hosted packages that build on install must be allowed first.
# pnpm-workspace.yaml (or the "pnpm" field of package.json):
#   onlyBuiltDependencies:
#     - "@facta-dte/api"
pnpm add github:Facta-DTE/facta-api-sdk#dev

# Any package manager (works with npm too, which does not build git dependencies):
git clone https://github.com/Facta-DTE/facta-api-sdk && cd facta-api-sdk
git checkout dev && pnpm install --frozen-lockfile
pnpm pack --pack-destination /tmp/facta     # builds dist/ and writes facta-dte-api-<version>.tgz
cd /your/project && npm install /tmp/facta/facta-dte-api-*.tgz
```

Notes: without `#dev`, `github:Facta-DTE/facta-api-sdk` resolves the default
branch (`main`), which carries the last release, not the unreleased code. With
npm, a `github:` install gives you the sources but **no `dist/`**; use the
tarball. Pin an exact published version in your lockfile once it exists.

Entry points: `@facta-dte/api` (portable client), `/node` (encrypted file
archive, config-file loader), `/file-archive`, `/server` (handler for the web
window), `/browser` (credential-free headless client), `/react` and
`/react/styles.css`.

## Keys: what each one is for

| Option / env var | Looks like | What it is | Where it may live |
| --- | --- | --- | --- |
| `apiKey` / `FACTA_API_KEY` | `facta_test_…` or `facta_live_…` | Identifies the integration, carries its scopes, allowed DTE types, limits and its environment. Sent as `X-Facta-Key`. | Server only |
| `signKey` / `FACTA_SIGN_KEY` | `factask_…` | Second factor that opens the signing vault. Sent only on `issue`, `sign`, `invalidate`, `registerReturn`. Not needed for `prepare`, queries, downloads or delivery. | Server only; only the process that signs |
| `unlockKey` / `FACTA_UNLOCK_KEY` | `factauk_…` | Decrypts, **locally**, the published catalog and storage-destination snapshots. **Never sent to the API.** Not needed for plain/readable catalogs or if you send complete data. | Server only |

Rules:

- Never in a browser bundle, mobile app, repo, log, error report, screenshot or
  AI prompt. The SDK redacts the three keys and delivery tokens from error
  messages and details, but your own logging is on you (never log `FactaOptions`).
- Passing a `factauk_` value as `signKey` throws `unauthorized` locally.
- A key's scopes cannot be edited after minting: `issue`, `query`, `download`,
  `catalog:write`, and the narrow `entrega:correo` / `entrega:whatsapp`. Keys
  are minted in the Facta DTE app. `forbidden_scope` says which one was missing
  (`details.required`, `details.granted`).
- Keys can have an expiry (`key_expired`), an IP allow-list with CIDR
  (`ip_not_allowed`), a maximum amount per document (`amount_limit`) and hourly
  and daily ceilings (`rate_limited`).
- `.env.example` in the SDK repo shows the names; copy it to an ignored `.env`,
  and fill it from your secret manager. The SDK never loads `.env` by itself.

## Environments: pruebas (00) and producción (01)

Always use Facta's public API. Omit `baseUrl`: the SDK default is the production
host, and it serves both environments. **There is no staging or internal URL for
integrators; never configure one. The environment is chosen by the key, never by
the URL.**

| | Pruebas | Producción |
| --- | --- | --- |
| Key prefix | `facta_test_` | `facta_live_` |
| `ambiente` | `"00"` (Hacienda test environment) | `"01"` |
| Fiscal value | None | Real documents, real control numbers |
| Where | local, CI, tests | the production deploy only |

- A production key can only be minted for a company that has completed its own
  step to production. The server compares the key's environment with the
  company's and refuses a mismatch with `environment_not_allowed`.
- Test issuance consumes a *test* control-number sequence. Use a stable test order id.
- Keep one variable name (`FACTA_API_KEY`) and give each deployment its own secret.
  **A live key issues real fiscal documents**: keep it out of tests, CI and
  developer machines.
- `await facta.status()` returns `ambiente`, the issuer (`emisor`), the key
  (`llave.keyId`, `alcances`, `tiposDte`, `venceEl`, `catalogMode`) and
  remaining limits. Gate on it at start-up, for each environment:

```ts
const status = await facta.status();
const expected = process.env.FACTA_EXPECTED_AMBIENTE ?? "00"; // "01" only in the production deploy
if (status.ambiente !== expected) {
  throw new Error(`Facta key is in ambiente ${status.ambiente}, expected ${expected}`);
}
```

## Configure the client

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,
  signKey: process.env.FACTA_SIGN_KEY,      // omit in processes that never sign
  // unlockKey: process.env.FACTA_UNLOCK_KEY, // only for encrypted catalogs / BYOS snapshots
  // Do not set baseUrl: the default is Facta's public API (both environments).
  timeoutMs: 60_000, // default; includes reading the body
  maxRetries: 3,     // default; only explicitly retryable codes (see errors.md)
  config: { version: 1, expectedEnvironment: "00", requiredScopes: ["issue", "query", "download"] },
});
```

| Option | Notes |
| --- | --- |
| `region` | Region header `x-region`. See below. |
| `clock`, `clockFetch` | Reference clock for archive timestamps and S3 signing. Default on; `false` uses the device clock. Archive methods wait for its first calibration (≈6 s worst case when the clock service is unreachable). |
| `debug` | `{ timings: true }`; see debugging.md. |
| `config` | `FactaConfigV1` (`version: 1`), scalar, no secrets: `expectedEnvironment`, `requiredScopes`, `region`, `baseUrl`, ticket width… Flat options win. |
| `runtime` | `FactaRuntimeConfigV1` (`version: 1`): `archive`, `invalidationArchive`, `remoteDestinations`, `printTransport`, `emergencyStore`, `onEmergency`. See storage-and-emergency.md. |
| `fetch` | Custom fetch, for tests or an owning runtime. |

Node can load the scalar config from an explicit file:
`createFactaFromConfigFile({ configFile, apiKey, signKey })` from
`@facta-dte/api/node`. Unknown keys in that file are rejected; keep keys out of it.

Deno needs `--allow-net` and `--allow-env` (for the env names you read, e.g.
`--allow-env=FACTA_API_KEY,FACTA_SIGN_KEY,FACTA_API_REGION`).

## Region pinning

Facta's functions run next to a database in `us-west-2`. The SDK sends `x-region`
on every request; measured on `POST /v1/dte`: 7.2 s unpinned, 4.3 s pinned. Order
of precedence: `region` option → `config.region` → `FACTA_API_REGION` → the
region `GET /v1/status` advertises (read once per client, lazily) → built-in
default `us-west-2`. `false` disables it. A failed discovery never fails a call.

In **serverless** code that creates a `Facta` per invocation, pass `region`
explicitly (for example `region: "us-west-2"`) to skip the extra `GET /v1/status`
before the first call. `await facta.region()` shows the value;
`facta.servedRegion` / `diagnose().servedRegion` show which region answered.

## Server only, and the entry-point split

The SDK root and `/server` run **where the keys are**. The browser only ever
talks to *your* endpoint: `@facta-dte/api/server` (`createFactaHandler`,
`createFactaSession`) on your server, `@facta-dte/api/browser` or
`@facta-dte/api/react` in the page, carrying only an opaque, signed session
token. See [browser-and-react.md](browser-and-react.md).

## Calling the HTTP API without the SDK

Only when there is no SDK for the language (the official package supports
TypeScript and JavaScript; other SDKs are pending). The authoritative contract is
`GET <baseUrl>/v1/openapi.json` (public, no key); the SDK can also read it with
`facta.getContract()`.

- Auth: header `X-Facta-Key: <apiKey>` (**never** `Authorization`).
  Signing routes also need `X-Facta-Sign-Key: <signKey>`.
- Bodies and responses are `application/json; charset=utf-8`, body ≤ 1 MB
  (`400 invalid_request`).
- Errors are always `{ "error": { "code", "message", "details" } }`; `code` is the
  contract.
- `Idempotency-Key` is **mandatory** on `POST /v1/dte`, `/v1/dte/prepare`,
  `/v1/dte/sign`, `/v1/dte/{codigoGeneracion}/invalidate` and
  `/v1/dte/{codigoGeneracion}/return`; scope `(API key, key)`, TTL 24 h.
- Rate-limit headers on every response: `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset`, `RateLimit-Policy`; `Retry-After` when you must wait.
- Routes: `GET /v1/status`, `POST /v1/dte`, `GET /v1/dte` (list, cursor
  pagination via `siguiente`, `limit` ≤ 100), `POST /v1/dte/prepare`,
  `POST /v1/dte/sign`, `GET /v1/dte/{codigoGeneracion}`,
  `POST …/invalidate`, `POST …/return`, `GET …/file?kind=json|pdf|ticket`,
  `POST …/entrega/correo`, `POST …/entrega/whatsapp`, `GET …/entrega`,
  `GET /v1/dte/holding`, and the `storage` and `vault` routes.
- The issuer, environment, establishment and point of sale come from the key;
  the client cannot name them.
- With a direct call, send complete receiver and item data: only the TypeScript
  SDK resolves ids from an *encrypted* catalog locally.
