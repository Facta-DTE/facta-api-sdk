// Small live run of the 0.6 surface against a company that shares its data key (staging, environment 00).
// The harness (FactaDTE tools/e2e/api-keys-shared.live.mjs) creates a temporary company and the keys, runs this
// script with them in the environment, and deletes everything afterwards. Each check prints one JSON line
// {"check","ok","detail"}; no key, secret or personal value is ever printed. Exit code 1 when a check fails.
//
//   FACTA_LIVE_BASE_URL         .../functions/v1/api-v1 (must be a staging host)
//   FACTA_LIVE_KEY              facta_test_ key with catalog:read + catalog:write, granted the catalogue
//   FACTA_LIVE_DRAFT_KEY        facta_test_ key with catalog:read + draft (not granted)
//   FACTA_LIVE_PRODUCTION_KEY   facta_live_ key of the same company (which is still in 00)
//   FACTA_LIVE_DUI              a valid unique 9-digit DUI for this run
//   FACTA_LIVE_TAG              unique text for names and codes
import { Facta, FactaError } from "../dist/index.js";

const base = process.env.FACTA_LIVE_BASE_URL ?? "";
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/api-v1$/.test(base) || base.includes("hcnvknpsbadplnfcflxx")) {
  console.log(JSON.stringify({ check: "target", ok: false, detail: "refusing: not the staging api-v1 URL" }));
  process.exit(2);
}
const tag = process.env.FACTA_LIVE_TAG ?? "sdk";
const options = { baseUrl: base, region: false, clock: false, maxRetries: 1 };
const facta = new Facta({ ...options, apiKey: process.env.FACTA_LIVE_KEY });
const drafts = new Facta({ ...options, apiKey: process.env.FACTA_LIVE_DRAFT_KEY });
const production = new Facta({ ...options, apiKey: process.env.FACTA_LIVE_PRODUCTION_KEY });

let failed = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(JSON.stringify({ check: name, ok: true, detail: String(detail ?? "") }));
  } catch (error) {
    failed += 1;
    const code = error instanceof FactaError ? `${error.code} ${error.status}` : "";
    console.log(JSON.stringify({ check: name, ok: false, detail: `${code} ${String(error?.message ?? error).slice(0, 200)}`.trim() }));
  }
}
async function refusal(promise, code, status) {
  try { await promise; } catch (error) {
    if (error instanceof FactaError && error.code === code && (status === undefined || error.status === status)) return error;
    throw new Error(`expected ${code}, got ${error instanceof FactaError ? `${error.code} ${error.status}` : error}`);
  }
  throw new Error(`expected ${code}, the call succeeded`);
}

let customer;
let product;
await check("status", async () => {
  const status = await facta.status();
  if (status.ambiente !== "00") throw new Error(`ambiente ${status.ambiente}`);
  return `ambiente ${status.ambiente}`;
});
await check("customers.create+duplicate", async () => {
  const input = { nombre: `QA SDK TS ${tag}`, tipoDocumento: "13", numDocumento: process.env.FACTA_LIVE_DUI, correo: "sdk-ts@qa.factadte.invalid", direccion: { departamento: "06", municipio: "23", distrito: "14", complemento: "Colonia de prueba 1" } };
  customer = await facta.createCustomer(input, { idempotencyKey: `sdk-ts-customer-${tag}` });
  if (typeof customer.revision !== "number") throw new Error("created customer has no revision");
  await refusal(facta.createCustomer(input, { idempotencyKey: `sdk-ts-customer-dup-${tag}` }), "catalog_duplicate", 409);
  return `revision ${customer.revision}; duplicate refused`;
});
await check("customers.revision+ifMatch", async () => {
  const read = await facta.getCustomer(customer.id);
  const updated = await facta.updateCustomer(customer.id, { telefono: "22223333" }, { ifMatch: read.revision });
  if (!(updated.revision > read.revision)) throw new Error(`revision ${read.revision} -> ${updated.revision}`);
  const conflict = await refusal(facta.updateCustomer(customer.id, { telefono: "22224444" }, { ifMatch: read.revision }), "catalog_revision_conflict", 409);
  if (typeof conflict.details?.revisionActual !== "number") throw new Error("no revisionActual in details");
  return `revision ${read.revision} -> ${updated.revision}; stale ifMatch refused (revisionActual ${conflict.details.revisionActual})`;
});
await check("customers.deactivate+inactive+reactivate", async () => {
  const off = await facta.deactivateCustomer(customer.id);
  if (off.active !== false) throw new Error("not deactivated");
  await refusal(facta.updateCustomer(customer.id, { telefono: "22225555" }), "catalog_record_inactive", 409);
  const back = await facta.updateCustomer(customer.id, { activo: true, telefono: "22225555" });
  if (back.active !== true) throw new Error("not reactivated");
  return "deactivate; edit of an inactive record refused; activo:true reactivates";
});
await check("customers.list+search", async () => {
  const rows = await facta.listCustomers();
  if (!rows.some((row) => row.id === customer.id)) throw new Error("listCustomers misses the created customer");
  const found = await facta.searchCustomers(`QA SDK TS ${tag}`);
  if (!found.some((row) => row.id === customer.id)) throw new Error("searchCustomers misses it");
  return `${rows.length} customers; search finds it`;
});
await check("products.create+update+deactivate", async () => {
  product = await facta.createProduct({ descripcion: `Producto SDK TS ${tag}`, tipoItem: 2, precioUni: 2.5, ivaIncluido: false, codigo: `SDKTS-${tag}` }, { idempotencyKey: `sdk-ts-product-${tag}` });
  const read = await facta.getProduct(product.id);
  const updated = await facta.updateProduct(product.id, { precioUni: 3 }, { ifMatch: read.revision });
  await refusal(facta.updateProduct(product.id, { precioUni: 4 }, { ifMatch: read.revision }), "catalog_revision_conflict", 409);
  const off = await facta.deactivateProduct(product.id);
  if (off.active !== false) throw new Error("not deactivated");
  return `revision ${read.revision} -> ${updated.revision}; stale refused; deactivated`;
});
await check("catalog.changes", async () => {
  const page = await facta.listCatalogChanges({ since: 0, limit: 100 });
  const mine = page.changes.filter((change) => change.recordId === customer.id);
  if (mine.length === 0) throw new Error("the feed does not list the customer");
  if (JSON.stringify(page).includes(`QA SDK TS ${tag}`)) throw new Error("the feed carries content");
  const expired = await refusal(facta.listCatalogChanges({ since: page.head + 1000 }), "catalog_cursor_expired", 410);
  if (typeof expired.details?.cabeza !== "number") throw new Error("no cabeza in details");
  return `head ${page.head}; ${mine.length} changes of the customer; cursor ahead -> catalog_cursor_expired (reason ${expired.details.reason})`;
});
await check("webhooks.lifecycle", async () => {
  const url = `https://example.com/facta-sdk-qa-${tag}`;
  const created = await facta.createWebhook({ url, events: ["catalog.customer.updated"], description: "sdk live" });
  try {
    if (!/^whsec_/.test(created.secret)) throw new Error("no secret on create");
    await refusal(facta.createWebhook({ url }), "webhook_duplicate", 409);
    const listed = await facta.listWebhooks();
    if (!listed.some((hook) => hook.id === created.id && !("secret" in hook))) throw new Error("not listed (or listed with a secret)");
    const off = await facta.updateWebhook(created.id, { active: false });
    if (off.active !== false) throw new Error("not switched off");
    const rotated = await facta.rotateWebhookSecret(created.id);
    if (rotated.secret === created.secret) throw new Error("secret did not change");
    return "create (secret once); duplicate refused; list without secret; switched off; rotated";
  } finally {
    await facta.deleteWebhook(created.id);
  }
});
await check("drafts.scope", async () => {
  await refusal(facta.createDraft({ tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1, tipoItem: 2 }] }), "forbidden_scope", 403);
  return "a key without the draft scope hears forbidden_scope";
});
await check("drafts.lifecycle", async () => {
  const request = { tipoDte: "01", items: [{ descripcion: `Servicio SDK TS ${tag}`, cantidad: 1, precioUni: 1.13, tipoItem: 2 }] };
  let draft;
  try {
    draft = await drafts.createDraft({ ...request, reference: `sdk-ts-${tag}` }, { idempotencyKey: `sdk-ts-draft-${tag}` });
  } catch (error) {
    if (error instanceof FactaError && error.code === "drafts_not_ready" && error.status === 409) return "drafts_not_ready (409): the owner has not published the draft-box key; typed refusal as documented";
    throw error;
  }
  try {
    const again = await drafts.createDraft({ ...request, reference: `sdk-ts-${tag}` }, { idempotencyKey: `sdk-ts-draft-${tag}` });
    if (again.id !== draft.id) throw new Error("same idempotency key, another draft");
    const byKey = await drafts.getDraftByKey(`sdk-ts-draft-${tag}`);
    const listed = await drafts.listDrafts({ reference: `sdk-ts-${tag}` });
    if (byKey.id !== draft.id || !listed.drafts.some((row) => row.id === draft.id)) throw new Error("not found by key / listing");
    const updated = await drafts.updateDraft(draft.id, draft.version, { ...request, reference: `sdk-ts-${tag}` });
    await refusal(drafts.updateDraft(draft.id, draft.version, request), "version_mismatch", 409);
    return `created v${draft.version}; same key -> same draft; by key and listing find it; update v${updated.version}; stale version refused`;
  } finally {
    await drafts.cancelDraft(draft.id).catch(() => undefined);
  }
});
await check("drafts.issue-scope", async () => {
  await refusal(drafts.issueDraft("00000000-0000-4000-8000-000000000000", 1, { tipoDte: "01", items: [{ descripcion: "x", cantidad: 1, precioUni: 1, tipoItem: 2 }] }), "forbidden_scope", 403);
  return "issueDraft with a key that lacks the issue scope hears forbidden_scope";
});
await check("environment.production-key-on-test-company", async () => {
  const error = await refusal(production.listCustomers(), "environment_not_allowed", 403);
  return `facta_live_ key on a company in 00 -> ${error.code}`;
});

process.exit(failed === 0 ? 0 : 1);
