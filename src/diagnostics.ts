import type { InvoiceArchive } from "./archive.ts";
import type { Status, SyncRevision, DteType } from "./types.ts";

export type DiagnosticState = "ok" | "warning" | "blocked" | "unknown";

export interface DiagnosticCheck {
  id: string;
  state: DiagnosticState;
  message: string;
}

export interface DiagnosticRevisions {
  sign: SyncRevision | null;
  destinations: SyncRevision | null;
  catalog: SyncRevision | null;
}

export interface DiagnosticsReport {
  overall: "ready" | "attention" | "blocked";
  canIssue: boolean;
  canQuery: boolean;
  canDownload: boolean;
  canIssueAndArchive: boolean;
  /** Null when no archive was supplied or its journal could not be read. */
  pendingArchiveOperations: number | null;
  /** Public revision numbers only; no encrypted vault data. */
  revisions: DiagnosticRevisions | null;
  checks: DiagnosticCheck[];
}

export interface DiagnoseOptions {
  /** Check that this archive can write/read before an invoice is attempted. */
  archive?: InvoiceArchive;
  /** Optionally confirm that this key permits one specific DTE type. */
  dteType?: DteType;
  /** Compare the returned key environment with the application configuration. */
  expectedEnvironment?: "00" | "01";
  /** Additional scopes the integration expects the API key to have. */
  requiredScopes?: readonly string[];
}

function add(
  checks: DiagnosticCheck[],
  id: string,
  state: DiagnosticState,
  message: string,
): void {
  checks.push({ id, state, message });
}

function checkRevision(
  checks: DiagnosticCheck[],
  id: string,
  revision: SyncRevision | undefined,
  label: string,
): boolean {
  if (!revision) {
    add(
      checks,
      id,
      "unknown",
      "Could not confirm synchronization for " + label + ".",
    );
    return false;
  }
  if (
    revision.status === "ready" &&
    Number.isInteger(revision.desiredRevision) &&
    revision.publishedRevision === revision.desiredRevision
  ) {
    add(checks, id, "ok", label + " is synchronized.");
    return true;
  }
  if (revision.status === "legacy") {
    add(
      checks,
      id,
      "warning",
      label + " still uses the legacy synchronization state.",
    );
    return true;
  }
  add(
    checks,
    id,
    "blocked",
    label + " has pending or failed synchronization.",
  );
  return false;
}

function checkSigningCertificate(status: Status, checks: DiagnosticCheck[]): boolean {
  const certificate = status.firma?.certificado;
  if (certificate === undefined || certificate === null) {
    add(
      checks,
      "certificate-metadata",
      "unknown",
      "API has not published public certificate metadata; the key retains its current behavior.",
    );
    return true;
  }
  if (!certificate.fingerprint) {
    add(
      checks,
      "certificate-metadata",
      "unknown",
      "Could not confirm the public certificate fingerprint for this key.",
    );
    return true;
  }
  add(
    checks,
    "certificate-metadata",
    "ok",
    "API identified the certificate by its public fingerprint.",
  );

  let identityOk = true;
  if (certificate.nit && status.emisor) {
    identityOk = certificate.nit.replace(/\D/g, "") ===
      status.emisor.nit.replace(/\D/g, "");
    add(
      checks,
      "certificate-identity",
      identityOk ? "ok" : "blocked",
      identityOk
        ? "Certificate NIT matches the issuing company."
        : "Certificate NIT does not match the issuing company; sync the correct certificate from the app.",
    );
  } else {
    add(
      checks,
      "certificate-identity",
      "unknown",
      "There is not enough metadata to compare the certificate NIT.",
    );
  }

  let environmentMatches = true;
  if (certificate.environment !== null) {
    environmentMatches = certificate.environment === status.ambiente;
    add(
      checks,
      "certificate-environment",
      environmentMatches ? "ok" : "warning",
      environmentMatches
        ? "Certificate is registered for the key environment."
        : "Certificate is registered for a different environment; confirm the selection in the app.",
    );
  } else {
    add(
      checks,
      "certificate-environment",
      "unknown",
      "Could not confirm the environment for which the certificate was registered.",
    );
  }

  const now = Date.now();
  const validFrom = certificate.validFrom === null
    ? Number.NaN
    : Date.parse(certificate.validFrom);
  const validTo = certificate.validTo === null
    ? Number.NaN
    : Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) {
    add(
      checks,
      "certificate-validity",
      "unknown",
      "Could not confirm certificate validity.",
    );
  } else if (validFrom > now) {
    add(
      checks,
      "certificate-validity",
      "blocked",
      "Certificate is not yet valid.",
    );
    return false;
  } else if (validTo <= now) {
    add(
      checks,
      "certificate-validity",
      "blocked",
      "Certificate has expired; renew it and sync the key from the app.",
    );
    return false;
  } else if (validTo - now < 30 * 24 * 60 * 60 * 1000) {
    add(
      checks,
      "certificate-validity",
      "warning",
      "Certificate expires within the next 30 days.",
    );
  } else {
    add(checks, "certificate-validity", "ok", "Certificate is valid.");
  }
  // The certificate registry records its environment as upload context only;
  // the public key verifier intentionally accepts a company's cert in either
  // slot. A mismatch is actionable information, not enough to veto issuance.
  return identityOk;
}

/** Evaluate only the public status contract; this never opens or returns a vault. */
export async function diagnoseStatus(
  status: Status,
  options: DiagnoseOptions = {},
): Promise<DiagnosticsReport> {
  const checks: DiagnosticCheck[] = [];
  const apiOk = status.ok === true;
  add(
    checks,
    "api",
    apiOk ? "ok" : "blocked",
    apiOk ? "API responded." : "API reported an unhealthy status.",
  );

  const issuerOk = status.emisor !== null;
  add(
    checks,
    "issuer",
    issuerOk ? "ok" : "blocked",
    issuerOk
      ? "Key has an issuing company."
      : "Key has no issuing company configured.",
  );
  const environmentMatches = status.emisor === null ||
    status.emisor.ambiente === status.ambiente;
  add(
    checks,
    "issuer-environment",
    environmentMatches ? "ok" : "blocked",
    environmentMatches
      ? "Company and key use the same environment."
      : "Key environment does not match the company environment.",
  );

  const scopes = new Set(status.llave.alcances);
  let expectedScopesOk = true;
  for (const scope of options.requiredScopes ?? []) {
    const hasScope = scopes.has(scope);
    expectedScopesOk = expectedScopesOk && hasScope;
    add(checks, "configured-scope-" + scope, hasScope ? "ok" : "blocked",
      hasScope ? "Key has the configured scope " + scope + "." : "Configured scope is missing: " + scope + ".");
  }
  const canQuery = apiOk && scopes.has("query");
  const canDownload = apiOk && scopes.has("download");
  add(
    checks,
    "scope-query",
    scopes.has("query") ? "ok" : "blocked",
    scopes.has("query")
      ? "Key has the query scope."
      : "Query scope is missing.",
  );
  add(
    checks,
    "scope-download",
    scopes.has("download") ? "ok" : "blocked",
    scopes.has("download")
      ? "Key has the download scope."
      : "Download scope is missing.",
  );
  const issueScope = scopes.has("issue");
  add(
    checks,
    "scope-issue",
    issueScope ? "ok" : "blocked",
    issueScope ? "Key has the issue scope." : "Issue scope is missing.",
  );
  const windows = [status.limites.hora, status.limites.dia];
  const quotaKnown = windows.every((window) =>
    window !== null && typeof window.remaining === "number"
  );
  const quotaAvailable = quotaKnown &&
    windows.every((window) => window!.remaining > 0);
  const isLow = (window: typeof status.limites.hora) =>
    window !== null && window !== undefined &&
    window.limit > 0 && window.remaining / window.limit < 0.1;
  const quotaLow = isLow(status.limites.hora) || isLow(status.limites.dia);
  const quotaState = !quotaKnown
    ? "unknown"
    : !quotaAvailable
    ? "blocked"
    : quotaLow
    ? "warning"
    : "ok";
  add(
    checks,
    "issue-quota",
    quotaState,
    !quotaKnown
      ? "Could not confirm issuance limits."
      : !quotaAvailable
      ? "Key has reached its hourly or daily limit."
      : quotaLow
      ? "Less than 10% remains in an issuance limit."
      : "Key has issuance capacity remaining.",
  );

  let keyNotExpired = true;
  const expiration = status.llave.venceEl;
  if (expiration !== null) {
    const expiresAt = Date.parse(expiration);
    keyNotExpired = Number.isFinite(expiresAt) && expiresAt > Date.now();
    if (!keyNotExpired) {
      add(
        checks,
        "key-expiry",
        "blocked",
        "Key has expired or its expiration date is invalid.",
      );
    } else if (expiresAt - Date.now() < 72 * 60 * 60 * 1000) {
      add(
        checks,
        "key-expiry",
        "warning",
        "Key expires within the next 72 hours.",
      );
    } else {
      add(checks, "key-expiry", "ok", "Key is not near expiration.");
    }
  } else {
    add(checks, "key-expiry", "ok", "Key has no expiration date.");
  }

  const signingCertificateOk = checkSigningCertificate(status, checks);

  let typeOk = true;
  if (options.dteType !== undefined) {
    typeOk = status.llave.tiposDte.includes(options.dteType);
    add(
      checks,
      "dte-type",
      typeOk ? "ok" : "blocked",
      typeOk
        ? "Key allows DTE " + options.dteType + "."
        : "Key does not allow DTE " + options.dteType + ".",
    );
  }

  let signingOk = false;
  if (!status.firma) {
    add(
      checks,
      "signing",
      "unknown",
      "API has not published signing-vault status.",
    );
  } else if (
    status.firma.origenDeLaFirma === "vault" && status.firma.vaultDeFirma
  ) {
    signingOk = true;
    add(checks, "signing", "ok", "Signing vault is provisioned.");
  } else if (status.firma.origenDeLaFirma === "plataforma") {
    signingOk = true;
    add(
      checks,
      "signing",
      "warning",
      "Key still uses Facta’s legacy signing mechanism.",
    );
  } else {
    add(
      checks,
      "signing",
      "blocked",
      "Key has no signing vault provisioned.",
    );
  }

  const sync = status.sincronizacion;
  // The original public status response did not expose revision metadata.
  // Only a wholly absent block identifies that contract; null or incomplete
  // modern metadata must still fail closed through checkRevision.
  const legacySyncContract = sync === undefined;
  if (legacySyncContract) {
    add(checks, "sign-sync", "warning", "API does not publish synchronization revisions; signing provisioning is checked using the legacy status contract.");
    add(checks, "destinations-sync", "warning", "API does not publish destination revisions; legacy status compatibility applies.");
  }
  const signingSyncOk = legacySyncContract || checkRevision(
    checks,
    "sign-sync",
    sync?.sign,
    "Signing vault",
  );
  const destinationsOk = legacySyncContract || checkRevision(
    checks,
    "destinations-sync",
    sync?.destinations,
    "Storage destinations",
  );
  const catalog: SyncRevision | undefined = sync?.catalog;
  if (
    catalog?.status === "ready" && Number.isInteger(catalog.desiredRevision) &&
    catalog.publishedRevision === catalog.desiredRevision
  ) {
    add(
      checks,
      "catalog-sync",
      "ok",
      "Catalog is synchronized for customerId/productId references.",
    );
  } else if (catalog?.status === "pending" || catalog?.status === "error") {
    add(
      checks,
      "catalog-sync",
      "warning",
      "Catalog is out of date; use inline data until synchronization completes.",
    );
  } else if (catalog?.status === "legacy" || !catalog) {
    add(
      checks,
      "catalog-sync",
      "warning",
      "A current catalog snapshot was not confirmed; inline data is still available.",
    );
  } else {
    add(
      checks,
      "catalog-sync",
      "warning",
      "Could not confirm the published catalog revision.",
    );
  }

  let archiveOk = false;
  let pendingArchiveOperations: number | null = null;
  if (options.archive) {
    try {
      await options.archive.assertReady();
      pendingArchiveOperations = (await options.archive.pending()).length;
      archiveOk = true;
      add(
        checks,
        "archive",
        "ok",
        "Archive can read and write before issuance; pending local or remote operations: " +
          pendingArchiveOperations + ".",
      );
      add(
        checks,
        "archive-pending",
        pendingArchiveOperations === 0 ? "ok" : "warning",
        pendingArchiveOperations === 0
          ? "There are no pending local archive tasks or remote copies."
          : "There are " + pendingArchiveOperations +
            " archive operations or remote copies awaiting completion or reconciliation.",
      );
    } catch {
      add(
        checks,
        "archive",
        "blocked",
        "Archive is unavailable or its key cannot read it.",
      );
    }
  } else {
    add(
      checks,
      "archive-pending",
      "unknown",
      "No archive is configured to inspect pending operations.",
    );
    add(
      checks,
      "archive",
      "unknown",
      "No durable archive is configured for the SDK.",
    );
  }

  if (status.ambiente === "00") {
    add(checks, "environment", "ok", "Key targets the test environment.");
  } else {add(
      checks,
      "environment",
      "warning",
      "Key targets the production environment.",
    );}

  const configuredEnvironmentOk = options.expectedEnvironment === undefined || options.expectedEnvironment === status.ambiente;
  if (options.expectedEnvironment !== undefined) {
    add(checks, "configured-environment", configuredEnvironmentOk ? "ok" : "blocked",
      configuredEnvironmentOk
        ? "Key matches the configured environment."
        : "Key does not match the configured environment; review configuration before proceeding.");
  }

  const canIssue = apiOk && issuerOk && environmentMatches && configuredEnvironmentOk && expectedScopesOk && issueScope &&
    keyNotExpired && quotaAvailable && signingCertificateOk &&
    typeOk && signingOk && signingSyncOk && destinationsOk;
  const issueCheckIds = new Set([
    "api",
    "issuer",
    "issuer-environment",
    "scope-issue",
    "issue-quota",
    "key-expiry",
    "dte-type",
    "signing",
    "sign-sync",
    "destinations-sync",
  ]);
  const blockingIssue = !canIssue;
  const anyWarning = checks.some((check) =>
    check.state === "warning" || check.state === "unknown" ||
    (issueCheckIds.has(check.id) && check.state === "blocked")
  );
  return {
    overall: blockingIssue ? "blocked" : anyWarning ? "attention" : "ready",
    canIssue,
    canQuery,
    canDownload,
    canIssueAndArchive: canIssue && archiveOk,
    pendingArchiveOperations,
    revisions: sync
      ? {
        sign: sync.sign ?? null,
        destinations: sync.destinations ?? null,
        catalog: sync.catalog ?? null,
      }
      : null,
    checks,
  };
}
