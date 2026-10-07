# Emergency safeguard

[Spanish guide](emergency.es.md) · [English README](../README.md)

Facta keeps every sealed document in a one-hour holding copy while it is written
to durable storage. If the server cannot store it anywhere durable, or every
replication the SDK attempted fails, that holding copy is the only one left. The
emergency safeguard is the last resort so the API keeps signing and the files
are still saved. The SDK ships no storage for it: you may provide one function. It is optional.

There is a second, server-side mechanism: if nothing could be stored anywhere, Facta e-mails the company owner a backup copy (JSON plus PDF, to import later). `emergencyStore` is an extra safeguard on top of that.

## When it runs

Only in an emergency, once per document (deduplicated by `codigoGeneracion`),
never on a normal issue and never on a timer:

- The sealed response carries a server warning: `sin_almacenamiento_duradero`
  (no durable storage; only the holding copy), `sin_copia_en_servidor`
  (critical: even holding failed; the document exists only in the response) or
  `copia_solo_temporal` (the managed write failed; only holding). Any warning
  whose code starts with `sin_` or contains `temporal` counts too.
- `issueAndArchive` ran replication to destinations and **every** destination
  failed.
- `issueAndArchive` found no destination at all (no managed copy, no BYOS copy
  and an incomplete local archive).

It runs after the fiscal result exists and never turns a sealed document into an
error.

## Configure your function

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey,
  runtime: {
    version: 1,
    emergencyStore: async (files, info) => {
      // files.archivoDte?: string   the receiver's Archivo DTE (absent in contingency)
      // files.jsonRaw: string       the stored original JSON
      // files.pdf: Uint8Array|null  the PDF
      // info: { codigoGeneracion, numeroControl, tipoDte, ambiente, fecEmi,
      //         reason, warnings, occurredAt }
      await saveSomewhereYouOwn(files, info); // throw if you could not
    },
    onEmergency: ({ info, report }) => alertYourTeam(info, report), // optional
  },
});
```

The bytes come from the response; when the response lacks them, the SDK
downloads them from holding (`GET /v1/dte/{code}/file`) within the hour. The SDK
sends them nowhere else.

## What you get back

The issue result (and `issueAndArchive`'s `emission` and result) carries
`emergency: { saved, reason, trigger, detail }` and, when your function ran, an
`sdkWarnings` entry `emergency_saved` or `emergency_failed`:

- `saved: true`: your function accepted the files; `reason` is the trigger.
- `saved: false, reason: "not_configured"`: you set no `emergencyStore` (it is
  optional; no warning is raised, and `diagnose()` lists it as plain
  information). Facta e-mails the owner a backup copy, and the files stay in the
  result (`archivoDte`, `archivoJson`, `representacionGrafica`) if you want to
  keep them too.
- `saved: false, reason: "store_failed"`: your function threw. Same advice.

In React, `FactaReceipt` and the sealed window show a banner («Este documento no
quedó en un almacenamiento permanente; se guardó en el respaldo de emergencia»
or, without a store, «Facta DTE enviará una copia de respaldo al correo del dueño; también puede descargarlo ahora»). «Descárguelo ahora» appears only when your function failed and the server reported `sin_copia_en_servidor`. The download buttons stay.

## Recovery and runbook

`facta.emergency.replicate(files, info)` re-tries normal replication from files
your store kept: every configured or synced destination, then the copy report to
Facta. It returns `{ stored, failed }` destination ids. The SDK keeps nothing, so
it is your function that remembers what is waiting.

1. An alert fires (`onEmergency`, or `emergency_saved` in your logs). Check that
   the files exist where your function put them.
2. Once the storage problem is fixed, call `replicate` with those files; a
   verified copy at a destination is the proof.
3. Only then delete your emergency copy.
4. If `saved` was `false`, go to the result you still hold, or download from
   holding within the hour: `downloadDocument(code, "json")`, `"pdf"`.

An example (not shipped code): write to a folder you own.

```ts
import { mkdir, writeFile } from "node:fs/promises";

const emergencyStore = async (files, info) => {
  const dir = `./emergency/${info.ambiente}/${info.codigoGeneracion}`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${dir}/raw.json`, files.jsonRaw, { mode: 0o600 });
  if (files.archivoDte) await writeFile(`${dir}/archivo-dte.json`, files.archivoDte, { mode: 0o600 });
  if (files.pdf) await writeFile(`${dir}/documento.pdf`, files.pdf, { mode: 0o600 });
  await writeFile(`${dir}/info.json`, JSON.stringify(info, null, 2), { mode: 0o600 });
};
```
