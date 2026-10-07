# Reference clock

[Spanish guide](reference-clock.es.md) · [English README](../README.md) · [Method reference](reference.md)

A device clock can be minutes off. The SDK keeps its own **reference clock**,
calibrated against Facta's public time service, for the few things it
timestamps or signs locally. This guide explains what it is used for, what it is
**not** used for, how to configure it and how to use it on its own.

## What it timestamps, and what it never touches

The date and time of a fiscal document (`fecEmi`, `horEmi`) are set by Facta's
server. **The SDK's clock never sets or changes a document's date.**

It is used for:

- **Archive records**: the `createdAt` of `issueAndArchive` /
  `invalidateAndArchive` journals, the `updatedAt` of remote-copy records, and
  the `occurredAt` of an emergency event.
- **Safety windows**: the 23-hour limit after which `recoverOperation` and
  `recoverInvalidation` refuse to replay an idempotency key is measured with it.
- **S3 request signing**, when you share it with an S3 destination. S3 rejects a
  SigV4 request signed more than 15 minutes away from its own time
  (`RequestTimeTooSkewed`), so a device with a wrong clock could not write.

Plain `issue`, `prepare`, `sign` and the read methods do not use it.

## Configuring it on `Facta`

| Option | Meaning |
| --- | --- |
| `clock: true` (default) | Calibrate against `DEFAULT_CLOCK_URL` (`https://clock.factadte.com/`). |
| `clock: "https://…"` | Use another endpoint that speaks the same protocol. |
| `clock: false` | Use the device clock; `facta.clock` is `null`. |
| `clockFetch` | A `fetch` used only for calibration (defaults to the client's `fetch`). |

Anything other than a boolean or a string makes the constructor throw
`TypeError`.

```ts
import { Facta, createS3ArtifactDestination } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

// Share the client's clock with an S3-compatible destination; without it the
// destination calibrates its own clock (or pass false for the device clock).
const s3 = createS3ArtifactDestination({
  id: "s3-backup",
  label: "S3 backup",
  config: {
    bucket: "my-invoices",
    region: "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  clock: facta.clock ?? false,
});

console.log(facta.clock?.state().status); // "device" until the first calibration
```

See [storage-adapters.md](storage-adapters.md) for the S3 options themselves.

## How calibration works

The protocol is NTP's four timestamps. The SDK calls the service to
**calibrate**, then answers every "what time is it" from the monotonic clock
with no network call:

- A calibration is a burst of **3 samples**, 300 ms apart, and up to 5 while the
  best uncertainty is above 250 ms. The sample with the smallest round-trip
  delay wins; a sample slower than 3 s, or with a mismatching echo, is
  discarded. Each request has a 3 s timeout.
- It recalibrates only when the uncertainty grows past **500 ms** (it widens with
  an assumed drift of 100 ppm, or a measured one), when the calibration is older
  than the service's `nextSyncAfterMs` (6 hours by default), or when the device
  time jumps more than 2 s.
- **It never throws.** If the service is unreachable, `now()` returns the best
  estimate there is, else the device clock, and `state().status` says so. After a
  failure it waits 60 s before trying again, so one operation never pays a burst
  of timeouts per call.

The archived operations (`issueAndArchive`, `recoverOperation`,
`replicateArchive`, `invalidateAndArchive`) call `ensure()` first. On the very
first archived operation of a process this **waits for one calibration burst**
(usually well under a second; when the service is unreachable, roughly two
3-second timeouts before falling back). Later calls answer locally.

## Using a clock on its own

`createReferenceClock(options)` builds an independent clock. You supply the
endpoint, a `fetch` and the two time sources; everything else has defaults.

```ts
import { createReferenceClock, DEFAULT_CLOCK_URL, type ClockState } from "@facta-dte/api";

const clock = createReferenceClock({
  url: DEFAULT_CLOCK_URL,
  fetch: globalThis.fetch.bind(globalThis),
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
});

const state: ClockState = await clock.ensure();       // calibrates if needed; never throws
console.log(clock.now().toISOString(), state.status, Math.round(state.uncertaintyMs), "ms");
await clock.calibrate();                              // force a burst, e.g. after a time-related rejection
```

`ReferenceClockOptions`:

| Field | Default | Meaning |
| --- | --- | --- |
| `url`, `fetch`, `wallNow`, `monoNow` | required | Endpoint, transport, device wall clock (epoch ms), monotonic clock (ms). |
| `store` | none | `{ load(), save(value) }` to keep the last calibration across reloads; a loaded one makes the clock `provisional` until it recalibrates. |
| `sampleSpacingMs` | 300 | Gap between samples of a burst. |
| `timeoutMs` | 3000 | Per-request timeout. |
| `retryCooldownMs` | 60000 | Wait after a failed calibration. |
| `random`, `sleep` | `Math.random`, `setTimeout` | Test hooks. |

`ReferenceClock` has `now(): Date` (synchronous, no network), `state():
ClockState`, `ensure({ maxUncertaintyMs? })` and `calibrate()`.

`ClockState` reports `status` (`ClockStatus`: `"calibrated"`, `"provisional"` or
`"device"`), `offsetMs` (correct time minus device time), `uncertaintyMs`
(`Infinity` when `device`), `driftPpm`, `driftMeasured`, `calibratedAt`,
`lastJumpMs`, `samples`, `delayMs`, `colo` (the data centre that answered),
`nextSyncAfterMs` and `lastError`.

The store's value type and a `localStorage`-backed store exist in
`src/reference-clock.ts` but are not exported from the package entry points in
this version; write the two-method object yourself if you need persistence.

## What can go wrong

- **`state().status` stays `"device"`**: the service is unreachable (firewall,
  offline, blocked `fetch`). Archive timestamps then use the device clock,
  exactly as before the reference clock existed. Check `state().lastError`
  (`timeout`, `network`, `http_<status>`, `echo_mismatch`…).
- **First archived operation slower**: it includes the first calibration.
  Warm up with `await facta.clock?.ensure()` at start-up.
- **`RequestTimeTooSkewed` from S3**: the destination is not using a calibrated
  clock and the device time is wrong. Pass `clock: facta.clock ?? false` or fix
  the device time.
- **Restrictive egress or CSP**: allow `https://clock.factadte.com/`, point
  `clock` at your own compatible endpoint, or set `clock: false`.
- **Expecting it to fix a document's date**: it cannot. Document dates come from
  the server.

## Related

- [Storage adapters](storage-adapters.md) · [Idempotency patterns](idempotency.md)
- [Method reference](reference.md)
