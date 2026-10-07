---
name: facta-dte-api
description: Use when integrating Facta DTE electronic invoicing for El Salvador (Hacienda DTE: Factura, Crédito Fiscal, notas, exportación, sujeto excluido) into an application, through the TypeScript/JavaScript SDK `@facta-dte/api` or the Facta HTTP API (`X-Facta-Key`, `/v1/dte`). Covers setup and keys, issuing each DTE type, idempotency, contingency, invalidation and returns, PDF/JSON/ticket files, e-mail and WhatsApp delivery, catalog, storage, errors, debugging and the production checklist. Do not use for other countries' e-invoicing or for the Hacienda portal itself.
---

# Facta DTE API / SDK integration

Facta DTE issues *Documentos Tributarios Electrónicos* for El Salvador. The
**server is the fiscal authority**: your code describes the sale (who, what, how
much per unit) and Facta reserves the control number, computes totals and VAT,
signs (JWS RS512) and transmits to the Ministerio de Hacienda. The SDK never
computes tax and never signs locally.

This skill is a router. Read only the reference file(s) the task needs; every
claim in them comes from the SDK repository (`src/`, `guides/`, `README.md`,
`CHANGELOG.md`) or the published OpenAPI contract. If something is not in those
sources, it is not in the skill: say so to the developer instead of guessing.

## Non-negotiable rules (apply to every task)

1. **Keys stay on the server.** `apiKey`, `signKey` and `unlockKey` never go to a
   browser bundle, a mobile app, a repository, a log line or a prompt. Read them
   from environment variables or a secret manager. Never print them, never paste
   them into code you generate, never commit `.env`.
2. **Always pass your own `idempotencyKey`**, derived from a business id that
   survives restarts (order number, ticket, payment id). One key per fiscal
   operation; `prepare` and `sign` get **different** keys.
3. **An uncertain answer is never a reason to issue again with a new key.**
   Replay the same request with the same key, then ask `getDocumentStatus`.
4. **Branch on `FactaError.code`, never on `message`.** Messages are prose and
   change.
5. **`mh_rejected` spent a control number; a contingency (`estado:
   "contingencia"`) is a success.** A delivery or storage problem is a state or a
   warning, never a reason to re-issue.
6. **Never recompute totals.** Show what the server returned (`totales`).
7. **Start in the test environment**: a `facta_test_` key on the same public API
   (environment `00`). Production is a different key (`facta_live_`, environment `01`).
8. **Always use Facta's public API.** Omit `baseUrl`: the SDK default is the
   production host. Never configure a staging or internal URL. Choose the
   environment with the key: `facta_test_` = pruebas (`00`), `facta_live_` =
   producción (`01`). Never switch by URL.
9. **Do not invent.** If a method, field or code is not in the references, check
   `src/types.ts` / `src/client.ts` in the installed package before using it.

## Ambientes (pruebas and producción)

Both run on the same public API; only the key differs.

| | Pruebas | Producción |
| --- | --- | --- |
| Key | `facta_test_…` | `facta_live_…` |
| `status().ambiente` | `"00"` (Hacienda test) | `"01"` |
| Documents | No fiscal value | Real fiscal documents |
| Use in | local, CI, tests | the production deploy only |

Config pattern: one variable name, a different secret per deployment
(`FACTA_API_KEY` holds a test key in dev/CI/staging-like deploys and a live key only
in the production deploy). At start-up gate on `await facta.status()`: expect
`ambiente === "00"` in tests and CI, and `"01"` only in the production deploy;
refuse to start on a mismatch (`config.expectedEnvironment` does the same check).
**A live key issues real fiscal documents and spends real control numbers**: never
put one in a test job, a seed script or a developer machine.

## Which reference to read

| The developer wants to… | Read |
| --- | --- |
| install the SDK, get keys, choose environment, configure the client, call the HTTP API without the SDK | [references/setup-and-keys.md](references/setup-and-keys.md) |
| issue a Factura, Crédito Fiscal, nota de crédito/débito, exportación or sujeto excluido; know what each needs; prepare then sign | [references/issuing-dte-types.md](references/issuing-dte-types.md) |
| make issuing safe against retries, timeouts and duplicate webhooks; order-to-invoice | [references/idempotency-and-recovery.md](references/idempotency-and-recovery.md) |
| handle contingency, cancel (invalidate) a document, register a return | [references/contingency-invalidation-return.md](references/contingency-invalidation-return.md) |
| give the customer the JSON/PDF/ticket, list documents, send by e-mail or WhatsApp | [references/files-and-delivery.md](references/files-and-delivery.md) |
| use saved customers/products, or manage them from the API | [references/catalog.md](references/catalog.md) |
| keep copies of the documents, or survive a storage failure | [references/storage-and-emergency.md](references/storage-and-emergency.md) |
| show a checkout/invoice window in a web page (server handler, browser client, React) | [references/browser-and-react.md](references/browser-and-react.md) |
| understand or handle an error code | [references/errors.md](references/errors.md) |
| find out why a call is slow or a key is not ready | [references/debugging.md](references/debugging.md) |
| go live | [references/production-checklist.md](references/production-checklist.md) |
| review code for typical integration bugs | [references/common-mistakes.md](references/common-mistakes.md) |
| find a real, tested example of any of the above to copy (the playground's recipes, with live links) | [references/recipes.md](references/recipes.md) |

Copy-paste starting points live in [templates/](templates/README.md): an Express
route, a Next.js route handler, a React checkout, a React documents screen and an
order-webhook-to-invoice handler. They are adapted from the playground's real, tested code (see
[references/recipes.md](references/recipes.md)) and type-check against the SDK in this
repository's CI. Prefer adapting a recipe or template over writing from scratch.

## Minimal working example

```ts
import { Facta, FactaError, type DteRequest } from "@facta-dte/api";

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,   // facta_test_… while developing
  signKey: process.env.FACTA_SIGN_KEY!, // factask_… second factor, signing calls only
});

const sale: DteRequest = {
  tipoDte: "01", // Factura; receptor is optional (consumidor final)
  items: [{ descripcion: "Café", cantidad: 2, precioUni: 2.5 }], // FE price INCLUDES VAT
};

try {
  const result = await facta.issue(sale, { idempotencyKey: `order-${order.id}` });
  if (result.estado === "sellado") {
    // Hacienda sealed it: result.numeroControl, result.selloRecibido, result.archivoDte, PDF in result.representacionGrafica
  } else {
    // "contingencia": signed, Hacienda did not answer; Facta retransmits. Not an error.
  }
} catch (error) {
  if (!(error instanceof FactaError)) throw error;
  if (error.isRejection) console.error("Hacienda refused:", error.mhObservations, error.spent);
  else console.error(error.code, error.status); // see references/errors.md
}
```

## Before you write code, ask (or check)

- Test or production key? (`facta_test_` / `facta_live_`.) Which DTE types does
  the key allow? (`await facta.status()` → `llave.tiposDte`, `llave.alcances`.)
- Does the company's catalog use `customerId` / `productId`, and in which mode?
  (`encrypted`, `readable`, `plain` — see the catalog reference.)
- Is the SDK version installed the one with the method you need? `0.5.0` or later is
  needed for the newest methods; see setup. When in doubt, read `node_modules/@facta-dte/api/src/types.ts`.

## Spanish

Esta skill ayuda a integrar Facta DTE (facturación electrónica de El Salvador)
con el SDK `@facta-dte/api` o con la API HTTP. El contenido técnico está en
inglés; el texto de cara al usuario final en sus aplicaciones debe ir en español
de El Salvador, tratando de usted. Instalación y descarga: `skills/README.md`.
