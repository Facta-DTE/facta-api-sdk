# Drafts: leave an invoice for a person to review and issue

Use when the developer's system should *propose* an invoice and a human at the company approves it in the Facta DTE app (scope `draft`; issuing from the API also needs `issue` and the signing key).

```ts
const draft = await facta.createDraft(
  { tipoDte: "01", customerId, items: [{ productId, cantidad: 1 }], reference: "order-77" },
  { idempotencyKey: "order-77" },            // repeat-safe, and lets you find it later
);
const found = await facta.getDraftByKey("order-77");     // draft → invoice, no generation code needed
await facta.updateDraft(draft.id, draft.version, { /* full request */ });   // If-Match: version
await facta.cancelDraft(draft.id);                       // pending and closed only
await facta.issueDraft(draft.id, draft.version, request, { idempotencyKey: "issue-order-77" });
```

- No control number is spent on `createDraft`/`updateDraft`/`cancelDraft`; `issueDraft` spends one through the same road as `issue`.
- Drafts are sealed to the company's public key; Facta keeps no plaintext. A person who may issue that type opens them in the app (not only the owner). They expire after 30 days; 500 per company.
- `drafts_not_ready` (409): the owner has not opened Facta with their vault since the company began sharing its data key → ask them to open it once and repeat. Not retried automatically.
- `version_mismatch`, `draft_claimed`, `draft_issuing`, `draft_issued`, `draft_not_issuable`, `item_final` (409) are about the draft's state: read it with `getDraft`, never re-issue blindly (`draft_issuing`/`draft_claimed` spent nothing).
- A production key (`facta_live_`) is refused with `environment_not_allowed` while the company is still in the test environment.
- Full guide: `guides/drafts.md` in the package.
