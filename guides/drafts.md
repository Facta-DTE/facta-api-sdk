# Drafts

[Spanish guide](drafts.es.md) · [Issuing](prepare-sign.md) · [Errors](errors.md) · [English README](../README.md)

A draft is an invoice your program leaves for **a person of the company to review and issue** from the Facta DTE app. Nothing is signed and no control number is spent until somebody issues it (or you do, with `issueDraft`). The scope is `draft`; issuing a draft from the API also needs `issue` and the signing key.

Facta validates a draft like an emission up to the point where a number would be reserved, resolves `customerId` / `productId` on the server, **seals the request to the company's public draft key** and keeps no plaintext. Anybody who may issue that document type opens it in the app, not only the owner. It expires after 30 days; a company holds at most 500.

```ts
const draft = await facta.createDraft(
  { tipoDte: "01", items: [{ productId: "…", cantidad: 1 }], customerId: "…", reference: "order-77" },
  { idempotencyKey: "order-77" },
);
// draft.id, draft.version, draft.totals

const page = await facta.listDrafts({ state: "pendiente", reference: "order-77" });
const same = await facta.getDraftByKey("order-77"); // follow draft → invoice without the generation code

// Change it while it is still pending and nobody has it open:
await facta.updateDraft(draft.id, draft.version, { tipoDte: "01", items: [/* … */] });

// Issue it yourself (spends a control number; needs `issue` and the signing key):
const issued = await facta.issueDraft(draft.id, draft.version, request, { idempotencyKey: "issue-order-77" });
// the result of `issue` plus `borradorId`

await facta.cancelDraft(draft.id); // only while it is pending and nobody has it open
```

| Method | Route | Notes |
| --- | --- | --- |
| `createDraft(input, options?)` | `POST /v1/drafts` | `input` is the `issue` request plus optional `id` (your UUID v4) and `reference` (up to 64 characters, no personal data). With the same `idempotencyKey` a repeat returns the same draft; another body is `idempotency_key_reuse`. |
| `listDrafts(options?)` | `GET /v1/drafts` | Only this key's drafts. Filters `state`, `reference`; `limit`, `cursor`; `include: "contenido"` adds each draft's resolved request when this key may open the company data key (max 50 per page). |
| `getDraft(id)` / `getDraftByKey(key)` | `GET /v1/drafts/{id}`, `/by-key/{key}` | An issued draft carries `generationCode`, `controlNumber`, `documentState`, `sealed`, `issuedBy`, `edited`. |
| `updateDraft(id, version, input)` | `PUT /v1/drafts/{id}` | Sends `If-Match: <version>`. Refused while a person has it open, while it is being issued, or once resolved. |
| `cancelDraft(id)` | `DELETE /v1/drafts/{id}` | Only if pending and closed. |
| `issueDraft(id, version, request, options?)` | `POST /v1/drafts/{id}/issue` | One door prevents double issuing: `draft_issuing` / `draft_claimed` (409) spent nothing. A Hacienda rejection counts as issued and the draft is not reopened. |

## Errors worth handling

`drafts_not_ready` (409): the owner has not opened Facta with their vault since the company began sharing its data key; ask them to open it once and repeat. `version_mismatch` (409): read the draft again. `draft_claimed`, `draft_issuing`, `draft_issued`, `draft_not_issuable`, `item_final` (409): the draft is in use or resolved; read it with `getDraft`. `inbox_cap_reached` (429): too many open drafts. None of these is retried automatically. All are in [errors.md](errors.md#drafts).

Like the company-level catalogue routes, drafts refuse a production key (`facta_live_`) while the company is still in the test environment (`environment_not_allowed`, 403); a test key is always allowed.
