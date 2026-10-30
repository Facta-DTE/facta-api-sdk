import { assert, assertEquals } from "jsr:@std/assert@1";

/**
 * Every operation of the API contract (test/fixtures/openapi.yaml, a snapshot of the server's
 * openapi.yaml on staging) is either wrapped by a client method or listed here as deliberately not
 * wrapped. A route the server adds therefore fails this test until somebody decides which it is.
 * The PHP SDK keeps the same table in tests/ContractCoverageTest.php.
 */
const WRAPPED: Record<string, string> = {
  "GET /v1/openapi.json": "getContract",
  "GET /v1/status": "status",
  "GET /v1/storage/status": "getStorageStatus",
  "GET /v1/storage/copies": "getDocumentCopies",
  "POST /v1/storage/copies/{codigoGeneracion}/repair": "retryDocumentStorage",
  "GET /v1/storage/unconfirmed": "listUnconfirmedDocuments",
  "POST /v1/dte/{codigoGeneracion}/storage-confirmation": "confirmDocumentStorage",
  "GET /v1/vault/destinations": "syncDestinations",
  "POST /v1/dte": "issue",
  "GET /v1/dte": "listDocuments",
  "POST /v1/dte/prepare": "prepare",
  "POST /v1/dte/sign": "sign",
  "GET /v1/dte/{codigoGeneracion}": "getDocumentStatus",
  "POST /v1/dte/{codigoGeneracion}/invalidate": "invalidate",
  "POST /v1/dte/{codigoGeneracion}/return": "registerReturn",
  "GET /v1/dte/{codigoGeneracion}/file": "downloadDocument",
  "POST /v1/dte/{codigoGeneracion}/entrega/correo": "deliverEmail",
  "POST /v1/dte/{codigoGeneracion}/entrega/whatsapp": "deliverWhatsApp",
  "GET /v1/dte/{codigoGeneracion}/entrega": "getDelivery",
  "GET /v1/dte/holding": "listHolding",
  "GET /v1/customers": "listCustomers",
  "POST /v1/customers": "createCustomer",
  "GET /v1/customers/{id}": "getCustomer",
  "PATCH /v1/customers/{id}": "updateCustomer",
  "DELETE /v1/customers/{id}": "deactivateCustomer",
  "GET /v1/products": "listProducts",
  "POST /v1/products": "createProduct",
  "GET /v1/products/{id}": "getProduct",
  "PATCH /v1/products/{id}": "updateProduct",
  "DELETE /v1/products/{id}": "deactivateProduct",
  "GET /v1/catalog/changes": "listCatalogChanges",
  "POST /v1/webhooks": "createWebhook",
  "GET /v1/webhooks": "listWebhooks",
  "GET /v1/webhooks/{id}": "getWebhook",
  "PATCH /v1/webhooks/{id}": "updateWebhook",
  "DELETE /v1/webhooks/{id}": "deleteWebhook",
  "POST /v1/webhooks/{id}/rotate-secret": "rotateWebhookSecret",
  "POST /v1/webhooks/{id}/test": "testWebhook",
  "POST /v1/drafts": "createDraft",
  "GET /v1/drafts": "listDrafts",
  "GET /v1/drafts/{id}": "getDraft",
  "PUT /v1/drafts/{id}": "updateDraft",
  "DELETE /v1/drafts/{id}": "cancelDraft",
  "GET /v1/drafts/by-key/{key}": "getDraftByKey",
  "POST /v1/drafts/{id}/issue": "issueDraft",
};

const NOT_WRAPPED: Record<string, string> = {
  "POST /v1/storage/copies/{codigoGeneracion}/byos": "used internally by issueAndArchive (private)",
  "POST /v1/destinations/{destinationId}/drive-token": "Drive does not count as API storage (drive_not_available_for_api)",
  "GET /v1/representacion/plantillas": "no client method yet (0.7 candidate)",
  "DELETE /v1/dte/{codigoGeneracion}/return/{evento}": "no client method yet (0.7 candidate)",
  // The sealed catalogue inbox: every answer is 410 inbox_retired.
  "POST /v1/catalog/changes": "retired, answers 410 inbox_retired",
  "GET /v1/catalog/changes/{id}": "retired, answers 410 inbox_retired",
  "DELETE /v1/catalog/changes/{id}": "retired, answers 410 inbox_retired",
  "GET /v1/catalog/changes/by-key/{key}": "retired, answers 410 inbox_retired",
};

function operations(yaml: string): string[] {
  const out: string[] = [];
  let path = "";
  for (const line of yaml.slice(yaml.indexOf("\npaths:"), yaml.indexOf("\ncomponents:")).split("\n")) {
    const p = /^ {2}(\/v1\/[^\s:]*):\s*$/.exec(line);
    if (p) path = p[1];
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && path) out.push(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

Deno.test("every operation of the contract is wrapped by a client method or explicitly not wrapped", async () => {
  const ops = operations(await Deno.readTextFile("test/fixtures/openapi.yaml"));
  assert(ops.length > 40, "Expected to read the contract's operations");
  const known = new Set([...Object.keys(WRAPPED), ...Object.keys(NOT_WRAPPED)]);
  assertEquals(ops.filter((op) => !known.has(op)), [], "operations of the contract nobody decided on");
  assertEquals([...known].filter((op) => !ops.includes(op)), [], "table entries for operations the contract no longer has");
});

Deno.test("every wrapped operation names a real public method of the client", async () => {
  const source = await Deno.readTextFile("src/client.ts");
  for (const [op, method] of Object.entries(WRAPPED)) {
    assert(new RegExp(`^  (?:async )?${method}\\(`, "m").test(source), `${op}: Facta.${method}() is missing`);
  }
});
