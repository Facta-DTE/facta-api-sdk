# Regional pinning

[Spanish guide](region.es.md) · [English README](../README.md) · [Method reference](reference.md)

Facta's API runs on Supabase Edge Functions. By default an Edge Function runs in
the region nearest to the caller, but the Facta database lives in one region
(`us-west-2`). A function that starts far from the database pays a
cross-country round trip for every query it makes, and issuing a DTE makes many.
Measured on `POST /v1/dte`: **7.2 s on average unpinned, 4.3 s pinned**.

The SDK therefore sends an `x-region` header on every request so the function
runs next to the database. You normally do not need to do anything; this guide
explains how the value is chosen, how to override or disable it, and how to
check which region actually answered.

## How the region is chosen

For each `Facta` instance the value is, in this order:

1. the `region` constructor option;
2. `config.region` (inside `config: { version: 1, ... }`);
3. the `FACTA_API_REGION` environment variable (read from `process.env` in Node
   and Bun, `Deno.env` in Deno; trimmed and lower-cased);
4. the `region` that `GET /v1/status` advertises, read **once per client**,
   lazily, on the first request; concurrent first calls share that one read;
5. a built-in default, `us-west-2`, for both `facta_test_` and `facta_live_`
   keys, when the API does not advertise a region.

A string value must look like a Supabase region (`us-west-2`, `sa-east-1`…);
anything else makes the constructor throw `TypeError`. `false` (or
`FACTA_API_REGION=false` / `off`) disables the header.

```ts
import { Facta } from "@facta-dte/api";

// Default: discover from /v1/status.
const facta = new Facta({ apiKey: process.env.FACTA_API_KEY! });

// Fixed region, no discovery request:
const pinned = new Facta({ apiKey: process.env.FACTA_API_KEY!, region: "us-west-2" });

// Same thing through the versioned config:
const configured = new Facta({ apiKey: process.env.FACTA_API_KEY!, config: { version: 1, region: "us-west-2" } });

// No x-region header at all:
const unpinned = new Facta({ apiKey: process.env.FACTA_API_KEY!, region: false });
```

## The discovery request

Discovery is one extra `GET /v1/status` before the first real request of a
client. It is a single attempt (no retries) with a deadline of
`min(timeoutMs, 5 s)`, and the same status document also tells the SDK the key's
catalog mode, so later catalog reads usually need no further status call.
`/v1/status` has its own rate-limit window on the server.

If discovery fails (network error, timeout, any API error) the operation that
triggered it **is not failed**: it is sent without `x-region`, and discovery is
tried again after 60 seconds. Pinning is an optimisation, never a requirement.

Set `region` explicitly when you want to avoid that extra request, for example in
a short-lived serverless function that creates a new `Facta` instance per
invocation.

## Checking what is in use

```ts
const region = await facta.region();   // "us-west-2", or null when disabled or discovery failed
await facta.status();
console.log(facta.servedRegion);       // region that answered the latest response, e.g. "us-west-2"

const report = await facta.diagnose();
console.log(report.region, report.servedRegion);
```

- `await facta.region()` returns the value the client sends, or `null` when it is
  disabled or the last discovery failed. It never throws.
- `facta.servedRegion` is the region that served the latest response, read from
  the `x-sb-edge-region` response header; `null` before any response or when the
  header is absent.
- `diagnose()` reports both as `region` and `servedRegion`.

If `servedRegion` differs from `region`, the header was probably not honoured (a
proxy stripping it, for example); calls still work, only slower.

## Browser and server handler

The browser client (`@facta-dte/api/browser`) and the React components talk to
**your** server, never to Facta, so they need no region. The `Facta` instance on
your server does the pinning.

## What can go wrong

- **`TypeError: region must be a Supabase region such as 'us-west-2', or false.`**:
  the option, `config.region` or `FACTA_API_REGION` holds something else.
- **Deno permissions**: reading `FACTA_API_REGION` needs `--allow-env` (for example
  `--allow-env=FACTA_API_REGION`). The SDK wraps the read in `try`/`catch`; in a
  non-interactive run without the permission it simply behaves as if the variable
  were unset. Pass `region` explicitly to avoid the question entirely.
- **First call slower than expected**: it includes the discovery request. Set
  `region` to skip it.
- **`region()` returns `null` although you did not disable it**: discovery failed;
  the SDK retries after 60 s. Check connectivity with `facta.status()`.
- **A database moves**: the built-in default lives in `src/client.ts`
  (`DEFAULT_REGIONS`). The value advertised by `/v1/status` takes precedence, so a
  current API keeps clients correct without an SDK update.

## Related

- [Debug timings](timings.md): measure where a slow call spends its time.
- [Diagnostics](diagnose.md) · [Method reference](reference.md#regional-pinning)
