// These functions run only when explicitly called. Use designated test documents.
// Run from Node or Deno with an installed @facta-dte/api package.
import { Facta, type DteRequest, type FactaArchiveEmissionOptions, type InvoiceArchive, type InvalidationRequest, type InvalidationArchive, type RemoteArtifactDestination } from "@facta-dte/api";

export async function issueManaged(facta: Facta, request: DteRequest, orderId: string) {
  if (!orderId.trim()) throw new Error("A stable order ID is required.");
  const ready = await facta.diagnose({ expectedEnvironment: "00" });
  if (!ready.canIssue) throw new Error("Resolve readiness checks before issuance.");
  return await facta.issue(request, { idempotencyKey: orderId });
}

export async function issueWithCopies(facta: Facta, request: DteRequest, options: FactaArchiveEmissionOptions) {
  // Managed copy receipts, encrypted local storage and optional BYOS outcomes
  // remain independent. A copy failure must never trigger another issuance.
  return await facta.issueAndArchive(request, { includeTicket: false, ...options });
}

export async function recoverAfterRestart(facta: Facta, archive: InvoiceArchive, operationId: string) {
  return await facta.recoverOperation(operationId, { archive });
}

export async function recoverByos(facta: Facta, archive: InvoiceArchive, operationId: string, destinations: RemoteArtifactDestination[]) {
  return await facta.replicateArchive(operationId, archive, destinations);
}

export async function catalogRequest(facta: Facta, customerId: string, productId: string): Promise<DteRequest> {
  await facta.syncCatalog();
  const [customer, product] = await Promise.all([facta.getCustomer(customerId), facta.getProduct(productId)]);
  if (!customer || !product) throw new Error("Select authorized current catalog entries.");
  return { tipoDte: "01", receptor: { customerId }, items: [{ productId, cantidad: 1 }] };
}

export async function readTicket(facta: Facta, generationCode: string) {
  // This reads an existing document; managed invoice storage covers JSON/PDF.
  return await facta.downloadDocument(generationCode, "ticket", { paperWidthMm: 58 });
}

export async function invalidateDesignatedTest(facta: Facta, archive: InvalidationArchive, generationCode: string, request: InvalidationRequest, operationId: string) {
  // Explicitly designate the test invoice. Invalidation changes fiscal state;
  // its event belongs in the independent encrypted invalidation journal.
  return await facta.invalidateAndArchive(generationCode, request, { archive, operationId, idempotencyKey: operationId });
}

export async function inspectCompatibility(facta: Facta) {
  const diagnostics = await facta.diagnose();
  return { canIssue: diagnostics.canIssue, storageReady: diagnostics.storageReady };
}
