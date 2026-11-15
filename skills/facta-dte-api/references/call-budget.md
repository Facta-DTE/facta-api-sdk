# Call budget: fewest calls to the server

Sources: contract (`openapi.yaml`: `info.description`, `/v1/customers`, `/v1/products`,
`/v1/dte/pendientes`, `/v1/drafts/by-key/{key}`, `/v1/dte` list, `/v1/webhooks`, `Techo`), the
server's ledger (`api-v1/ledger.ts`, migration `api_request_admit`), `src/client.ts`, `src/types.ts`.
Where the SDK does something the contract does not say, it is marked **(SDK)**.

Facta counts requests, not only emissions. An integration that lists, re-downloads and
polls hits the key's ceiling long before it issues many documents. A real ERP integration hit a
ceiling of 25 requests per hour within minutes because its jobs listed drafts and re-downloaded
the JSON and PDF of every sealed document on every run. **Decide the call plan before you write
the loop.**

## How Facta counts

- Every request authenticated with the key is written to a ledger **before** the work runs, and
  counts against two sliding windows per key: the **last 60 minutes** (`per_hour`) and the
  **last 24 hours** (`per_day`). Reads, lists, downloads, catalog calls, drafts, webhooks and
  emissions all count the same, one each.
- `GET /v1/status` has its **own** window (`status_per_hour`) and does not spend the two above.
  It is still limited, so it is not a free poll.
- Defaults when nobody chose anything: 60 per hour, 300 per day, 240 status per hour, $5,000 per
  document. These are only defaults: **the real numbers are per key**, set by the company owner
  (a key minted in the app proposes `per_hour = ceil(per_day / 8)`). Read the real ones from
  `status().limites` (`hora`, `dia`, `estado`: `limit`, `used`, `remaining`;
  `montoMaximoPorDocumentoCentavos`) and never hard-code them.
- A request refused with `429 rate_limited` is **not** written to the ledger, so it does not
  spend a slot, but it does nothing useful either. A request that dies half way stays counted.
  `details.window` says which ceiling (`hour`, `day`, `status`), `details.retryAfterSeconds` how
  long to wait. `amount_limit` (429) is a different ceiling: the document is above the key's
  maximum per document; it is checked before a control number is reserved, so no number is spent.
- Every answer carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and
  `RateLimit-Policy` for the window **closest to biting**; waiting answers (429, 409 in flight,
  503) add `Retry-After` in seconds. **(SDK)** The client does not expose these headers (the
  internal `onHeaders` is not in `CallOptions`); `FactaError.retryAfterSeconds` carries the
  server's wait, and `status()` is the way to read the remaining budget.
  **(SDK)** `rate_limited` is **not** retried by the client: the error reaches your code. Other
  retryable conditions (`mh_unreachable`, `service_unavailable`, `idempotency_in_flight`, …) are
  retried up to `maxRetries` (default 3), and **every attempt is a counted request**: during an
  outage one `issue()` can cost 4 calls. Lower `maxRetries` for bulk jobs.
- Webhooks exist for **catalog changes only** (`catalog.customer.*`, `catalog.product.*`,
  `catalog.restored`; they carry ids, never content). There is no webhook for documents: do not
  expect Facta to notify you that a document was sealed.

## Business operation → minimal calls

| Operation | Minimal flow | Do NOT |
| --- | --- | --- |
| Sync customers from an ERP | `createCustomer(body, { idempotencyKey: "erp-customer-" + erpId })` per **changed** record: **1 call**. First time it creates (`201`), the same key with a different body updates that record (`200`, `actualizado: true`). See [catalog.md](catalog.md). | List customers, then GET, then PATCH; store Facta ids just to patch; re-send customers that did not change; full re-sync to recover one failure |
| Sync products from an ERP | Same: `createProduct(body, { idempotencyKey: "erp-product-" + sku })`: **1 call** per changed product | Same as above |
| Issue a document and give the customer the files | `issue(request, { idempotencyKey })`: **1 call**. A sealed answer already carries `archivoDte`, `archivoJson`, `jws` and the PDF (`representacionGrafica`, base64): store those. Mark `deliver` in the same request if Facta should e-mail it | GET the document after issuing; `downloadDocument` for the file you just received; `getDocumentStatus` to see if it sealed |
| Keep an archive while issuing | `issueAndArchive` costs more **(SDK)**: one `status()` (identity check), the `POST /v1/dte`, and by default one ticket download (`includeTicket: false` skips it); JSON and PDF come inline. Add confirm/BYOS/destination-vault calls when those are configured. Use it for crash safety, not for bulk | Use it in a high-volume loop without counting; let it download PDFs you do not print |
| Check that the key and environment are ready | `status()` **once at start-up** (and in a health check at a low rate, from the separate status window). **(SDK)** The client already reads `/v1/status` once per client to learn its region | Call `status()` or `diagnose()` before each issue or each sync run |
| List documents for a period | `listDocuments({ desde, hasta, estado, limit, cursor })`, following `siguiente`; add `include: ["dte"]` only when you need the content (max 25 rows per page) | One `GET /v1/dte/{cg}` per document; re-listing the whole history every run; filtering client-side what the server can filter |
| Follow documents Hacienda has not answered | `listPendingDocuments()` (`GET /v1/dte/pendientes`): **1 call per page** for all pending documents; then `retryDocument(code)` only for those listed and `reintentable` | Poll `getDocumentStatus` for every recent document; retry documents that were never pending |
| Find a draft from your own id | `getDraftByKey(idempotencyKey)` (`GET /v1/drafts/by-key/{key}`): **1 call** | List drafts and filter; poll a draft until a person issues it, in a tight loop |
| React to catalog changes made elsewhere | A webhook (`createWebhook`, scope `catalog:read`) is one call to register and zero to receive; then `listCatalogChanges({ since })` for just the changed ids | Poll `listCustomers` / `listProducts` on a timer |
| Invoice from an order or payment webhook | **One** `issue()` with the order's own id as `idempotencyKey` (a duplicate webhook replays the stored answer). Send the full receiver and lines inline | Look the customer up first; create the customer then issue; verify with a GET afterwards |
| Show a document again later | Use the copy you stored. Download (`downloadDocument`) only when a person asks for it | Re-download every sealed document on each job run |

## Inline receiver and lines vs catalog

When the ERP is the source of truth, send the complete `receptor` and `items` inline in
`issue()`: the invoice then needs **no catalog calls at all**, no customer sync and no ids to
keep. Inline data never creates or edits a catalog customer. Use `customerId` / `productId`
only when the catalog in Facta is the source of truth (the ids are resolved on the server in the
same request, so they cost no extra call either). Do not run a catalog sync **and** send inline
data for the same documents; pick one.

## Call-budget method (do this before writing the code)

1. List every operation your integration performs (start-up, per sale, per changed record, per
   scheduled job, per user click).
2. For each, write the calls it makes using the table above, including the calls the SDK adds
   (`issueAndArchive`, retries).
3. Multiply by the expected volume **per hour** and **per day**, at the peak, plus the
   scheduled jobs. Add 20 % for retries and reruns.
4. Compare with the key's `per_hour` and `per_day` (`status().limites`, in test and in
   production). If the plan does not fit, **change the flow first** (batch by changed records,
   webhooks, inline data, cap the job), and only then ask for more.
5. Asking for more is the company owner's decision, not the integrator's: in Facta → Cuenta →
   API the owner edits the key's limits. The hourly ceiling cannot exceed the daily one, the daily
   one cannot exceed the plan's monthly allowance, raising needs the owner's second factor, and a
   production key needs the word PRODUCCION typed. Give the owner the numbers from step 3.
6. Put the figures in the integration's README so the next person (or agent) does not undo them.

Worked example: 400 customers changed per night, 150 sales per day. Upsert: 400 + 150 = 550
calls per day, 1 per record, no reads: it needs `per_day` of at least 550 plus margin. The
list-get-patch flow would be 3 × 400 + 150 = 1,350 and would not fit a 300 per day key at all.

## Retry and backoff

- On `rate_limited` wait `retryAfterSeconds` (or the `Retry-After` header on direct HTTP), then
  retry the **same** request, with the **same** idempotency key. Do not retry in a tight loop.
- For other transient errors back off exponentially with jitter and a cap on attempts. The SDK
  does this for its retryable codes; your own code must for `rate_limited` and `network_error`.
- A scheduled job has a hard cap of calls per run. When it reaches the cap or a 429, it stops and
  continues next run from a stored cursor or from the list of changed records.
- To recover one failed record, retry that record. Never re-run the whole sync.
- Never answer a 429 by issuing with a new idempotency key: that creates a second document (see
  [idempotency-and-recovery.md](idempotency-and-recovery.md)).

## Gaps in the SDK for the efficient flows

- `createCustomer` / `createProduct` return the record but drop the `actualizado` flag of the
  `200` answer, so the SDK cannot tell "created" from "updated by repeating the key". If you need
  it, call `POST /v1/customers` over HTTP.
- The client validates a create body locally (a customer needs `nombre`, etc.), so an upsert sends
  the full record each time even though the server keeps omitted fields.
- `RateLimit-*` headers are not exposed by the client; read the budget with `status()`.
