---
name: facta-dte-api-staging
description: STAGING variant, ready to test with TypeScript (`npm i @facta-dte/api@next`, staging API URL, test key in ambiente 00, nothing reaches production). Use when integrating Facta DTE electronic invoicing for El Salvador (Hacienda DTE: Factura, Crédito Fiscal, notas, exportación, sujeto excluido) into an application, through the TypeScript/JavaScript SDK `@facta-dte/api` or the Facta HTTP API (`X-Facta-Key`, `/v1/dte`). Covers setup and keys, issuing each DTE type, idempotency, contingency, invalidation and returns, PDF/JSON/ticket files, e-mail and WhatsApp delivery, catalog, storage, errors, debugging and the production checklist. Do not use for other countries' e-invoicing or for the Hacienda portal itself.
---

# Facta DTE en STAGING: listo para probar con TypeScript

**Esta skill es para probar en staging, no en producción.** Usted puede probar su
integración con TypeScript ya: instale el SDK de prueba, apunte el cliente al API de
staging y emita con una llave de pruebas (ambiente `00`). Nada de lo que emita aquí
llega a producción ni tiene valor fiscal.

```sh
npm i @facta-dte/api@next      # SDK de prueba (dist-tag `next`); `latest` es el SDK de producción
```

| | URL |
| --- | --- |
| Aplicación (cree cuenta, empresa y llave de pruebas en Configuración → Llaves de la API) | https://staging.factadte.com |
| **API base de staging** (póngala siempre en `baseUrl`) | `https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1` |
| Referencia de la API | https://staging.factadte.com/api/ |
| Contrato OpenAPI | https://staging.factadte.com/api/openapi.yaml |
| Documentación del SDK (vista previa de staging) | https://staging.factadte-sdk.pages.dev |

```ts
import { Facta, FACTA_STAGING_BASE_URL } from "@facta-dte/api"; // 0.6.0-next.3 o posterior

const facta = new Facta({
  apiKey: process.env.FACTA_API_KEY!,     // facta_test_… creada en staging.factadte.com
  signKey: process.env.FACTA_SIGN_KEY,    // factask_… solo para emitir
  baseUrl: FACTA_STAGING_BASE_URL,        // https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1
  config: { version: 1, expectedEnvironment: "00" },
});
```

**Las llaves de staging solo funcionan contra la API base de staging, y las llaves de
producción nunca van aquí.** Una llave `facta_test_` elige el ambiente `00` en el servidor
al que llega; no elige el proyecto. Enviada al servidor de producción, una llave de staging
falla con `401`. El valor por defecto del SDK es producción, así que **sin `baseUrl` no está
probando en staging**. Confirme con `await facta.status()`: `ambiente` debe ser `"00"`.

Lo que ya existe y lo que viene está en [references/staging.md](references/staging.md)
(«Disponible ahora en staging» y «En la próxima versión»). Léalo antes de escribir código
que dependa de descuentos, pagos mixtos, régimen de exportación o advertencias.

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
7. **Test environment only**: a `facta_test_` key created in the staging app
   (environment `00`). A `facta_live_` key must never be used with this skill.
8. **Always set `baseUrl` to the staging API** (`FACTA_STAGING_BASE_URL`, exported by
   `@facta-dte/api` 0.6.0-next.2 and later (`tipoVenta`, `aplicarRetencionIva` and `aplicarPercepcionIva` are typed from 0.6.0-next.3)) and `expectedEnvironment: "00"`. The SDK
   default is the PRODUCTION host. When the integration goes live, remove `baseUrl`
   and use the production skill (`facta-dte-api`) and a `facta_live_` key.
9. **Do not invent.** If a method, field or code is not in the references, check
   `src/types.ts` / `src/client.ts` in the installed package before using it.
10. **Storing is not enough: report it.** Facta deletes its temporary encrypted copy of a
    sealed document **30 days after sealing** (2 days after you report it stored). After
    every emission either let `issueAndArchive` write to a synced destination, or store the
    JSON yourself and call `confirmDocumentStorage`; and run `storeAndConfirmUnconfirmed`
    (or poll `GET /v1/storage/unconfirmed`) **daily**. `runtime.emergencyStore` saves the
    files but does **not** confirm. The company owner is mailed from day one (production
    only). See [references/storage-and-emergency.md](references/storage-and-emergency.md).

## Ambiente

Staging only has the test environment: `status().ambiente` is `"00"` (Hacienda's
test service), documents have no fiscal value, and control numbers come from a
test sequence. Gate on `await facta.status()` at start-up and refuse to continue
if `ambiente !== "00"` (`config.expectedEnvironment: "00"` does the same check).

## Which reference to read

| The developer wants to… | Read |
| --- | --- |
| install the SDK, get keys, choose environment, configure the client, call the HTTP API without the SDK | [references/setup-and-keys.md](references/setup-and-keys.md) |
| issue a Factura, Crédito Fiscal, nota de crédito/débito, exportación or sujeto excluido; know what each needs; prepare then sign | [references/issuing-dte-types.md](references/issuing-dte-types.md) |
| make issuing safe against retries, timeouts and duplicate webhooks; order-to-invoice | [references/idempotency-and-recovery.md](references/idempotency-and-recovery.md) |
| handle contingency, cancel (invalidate) a document, register a return | [references/contingency-invalidation-return.md](references/contingency-invalidation-return.md) |
| give the customer the JSON/PDF/ticket, list documents, send by e-mail or WhatsApp | [references/files-and-delivery.md](references/files-and-delivery.md) |
| use saved customers/products, or manage them from the API | [references/catalog.md](references/catalog.md) |
| leave an invoice as a draft for a person of the company to review and issue | [references/drafts.md](references/drafts.md) |
| keep copies of the documents, or survive a storage failure | [references/storage-and-emergency.md](references/storage-and-emergency.md) |
| report a document as stored, drain the «documents unconfirmed after N days» list, understand the 30-day deadline and the owner mails, or use the emergency store correctly | [references/storage-and-emergency.md](references/storage-and-emergency.md) |
| show a checkout/invoice window in a web page (server handler, browser client, React) | [references/browser-and-react.md](references/browser-and-react.md) |
| understand or handle an error code | [references/errors.md](references/errors.md) |
| find out why a call is slow or a key is not ready | [references/debugging.md](references/debugging.md) |
| see what staging has now and what comes next, test the 0.6 fields (`montoDescu`, `pagos`, `tipoVenta`, VAT withholding/perception, warnings) | [references/staging.md](references/staging.md) |
| go live (switch to the production skill) | [references/production-checklist.md](references/production-checklist.md) |
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
  baseUrl: "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1", // staging API
  config: { version: 1, expectedEnvironment: "00" },
  apiKey: process.env.FACTA_API_KEY!,   // facta_test_… created in staging.factadte.com
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

- Is the key a `facta_test_` created in the staging app? Which DTE types does
  the key allow? (`await facta.status()` → `llave.tiposDte`, `llave.alcances`.)
- Does the company's catalog use `customerId` / `productId`, and in which mode?
  (`encrypted`, `readable`, `plain` — see the catalog reference.)
- Is the SDK version installed the one with the method you need? `0.6.0-next.3` (`@facta-dte/api@next`) is
  needed for the staging fields; see setup. When in doubt, read `node_modules/@facta-dte/api/src/types.ts`.

## Spanish

Esta skill ayuda a integrar Facta DTE (facturación electrónica de El Salvador)
con el SDK `@facta-dte/api` o con la API HTTP. El contenido técnico está en
inglés; el texto de cara al usuario final en sus aplicaciones debe ir en español
de El Salvador, tratando de usted. Instalación y descarga: `skills/README.md`.
