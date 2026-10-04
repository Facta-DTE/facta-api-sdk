const FIXTURE_TYPES = Object.freeze(["03", "05", "06", "11", "14"]);
const SUPPORTED_TYPES = Object.freeze(["01", ...FIXTURE_TYPES]);
const TEST_DESCRIPTION = "Facta API SDK integration test";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_RUN_AGE_MS = 22 * 60 * 60 * 1000;

/** Block reruns before API access when the server's idempotency claim may have expired. */
export function assertLiveRunWithinIdempotencyWindow(createdAt, now = Date.now()) {
  const timestamp = Date.parse(createdAt ?? "");
  if (!Number.isFinite(timestamp) || now < timestamp || now - timestamp >= SAFE_RUN_AGE_MS) {
    throw codedError("idempotency_window_expired");
  }
}

/** Parse the optional Actions secret without ever returning its contents to logs. */
export function parseLiveDteFixtures(raw) {
  if (!raw) return Object.freeze({});
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw codedError("fixture_invalid");
  }
  if (!isRecord(value) || Object.keys(value).some((type) => !FIXTURE_TYPES.includes(type))) {
    throw codedError("fixture_invalid");
  }

  const fixtures = {};
  for (const type of FIXTURE_TYPES) {
    if (value[type] === undefined) continue;
    const request = value[type];
    validateFixtureRequest(type, request);
    fixtures[type] = request;
  }
  return Object.freeze(fixtures);
}

/** Return fixed, report-safe states; never include fixture payloads or missing scope names. */
export function assessLiveDteFixtureMatrix(status, fixtures) {
  const scopes = new Set(status?.llave?.alcances ?? []);
  const allowedTypes = new Set(status?.llave?.tiposDte ?? []);
  return Object.fromEntries(SUPPORTED_TYPES.map((type) => {
    if (!scopes.has("issue") || !allowedTypes.has(type)) {
      return [type, "Blocked (permission unavailable)"];
    }
    if (type === "01") return [type, "Ready (baseline test only)"];
    return [type, fixtures[type] ? "Ready (fixture configured)" : "Not run (fixture missing)"];
  }));
}

/** Require complete permission and fixture coverage before any matrix DTE is issued. */
export function requireCompleteLiveDteFixtureMatrix(matrix) {
  for (const type of FIXTURE_TYPES) {
    if (matrix[type] !== "Ready (fixture configured)") {
      throw codedError(matrix[type] === "Blocked (permission unavailable)" ? "permission_missing" : "fixture_required");
    }
  }
}

/** Extract only test-environment related document UUIDs for a read-only status preflight. */
export function relatedGenerationCodes(fixtures) {
  return [...new Set(["05", "06"].flatMap((type) =>
    (fixtures[type]?.documentosRelacionados ?? []).map((document) => document.codigoGeneracion)
  ))];
}

export function assertRelatedTestDocuments(fixtures, statuses) {
  const related = relatedGenerationCodes(fixtures);
  if (related.length !== statuses.length) throw codedError("related_document_invalid");
  const verified = new Set();
  for (const status of statuses) {
    if (status?.ambiente !== "00" || status?.estado !== "sellado") {
      throw codedError("related_document_invalid");
    }
    if (typeof status.codigoGeneracion !== "string") throw codedError("related_document_invalid");
    verified.add(status.codigoGeneracion.toUpperCase());
  }
  if (related.some((code) => !verified.has(code.toUpperCase()))) throw codedError("related_document_invalid");
}

export const LIVE_DTE_FIXTURE_TYPES = FIXTURE_TYPES;
export const LIVE_DTE_SUPPORTED_TYPES = SUPPORTED_TYPES;

function validateFixtureRequest(type, request) {
  if (!isRecord(request) || request.tipoDte !== type || !Array.isArray(request.items) || request.items.length !== 1) {
    throw codedError("fixture_invalid");
  }
  const [item] = request.items;
  if (!isRecord(item) || item.descripcion !== TEST_DESCRIPTION || item.cantidad !== 1 || item.precioUni !== 0.01 || item.productId !== undefined) {
    throw codedError("fixture_invalid");
  }
  if ((type === "05" || type === "06") &&
    (!Array.isArray(request.documentosRelacionados) || request.documentosRelacionados.length !== 1 ||
      !UUID.test(request.documentosRelacionados[0]?.codigoGeneracion ?? ""))) {
    throw codedError("fixture_invalid");
  }
  if (type === "03" && !validBusinessRecipient(request.receptor)) throw codedError("fixture_invalid");
  if (type === "11" && (!isRecord(request.receptor) || !isRecord(request.exportacion) ||
    !["nombre", "numDocumento", "codPais", "nombrePais", "complemento", "descActividad", "correo"]
      .every((key) => typeof request.receptor[key] === "string" && request.receptor[key].trim().length > 0) ||
    !["tipoItemExpor"].every((key) => request.exportacion[key] !== undefined))) throw codedError("fixture_invalid");
  if (type === "14" && (!isRecord(request.receptor) ||
    !["nombre", "numDocumento"].every((key) => typeof request.receptor[key] === "string" && request.receptor[key].trim().length > 0) ||
    !isRecord(request.receptor.direccion) ||
    !["departamento", "municipio", "complemento"].every((key) => typeof request.receptor.direccion[key] === "string" && request.receptor.direccion[key].trim().length > 0))) {
    throw codedError("fixture_invalid");
  }
}

function validBusinessRecipient(value) {
  return isRecord(value) && ["nombre", "tipoDocumento", "numDocumento", "nrc", "codActividad", "descActividad"]
    .every((key) => typeof value[key] === "string" && value[key].trim().length > 0) &&
    isRecord(value.direccion) && ["departamento", "municipio", "complemento"]
      .every((key) => typeof value.direccion[key] === "string" && value.direccion[key].trim().length > 0);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codedError(code) {
  return Object.assign(new Error("Live DTE fixture preflight did not pass."), { code });
}
