// The «Archivo DTE»: the file a receiver expects, built from the sealed
// response. It is the signed document, plus `firmaElectronica` (the JWS,
// byte-for-byte) and `selloRecibido` (Hacienda's seal).
//
// The API returns it ready-made as `archivoDte`. This helper builds the same
// bytes for an API that has not deployed that field yet, mirroring the
// server's serialization exactly: the document's own keys in order, then
// `firmaElectronica`, then `selloRecibido`, pretty-printed with two spaces.
// Pure and dependency-free so it runs in Deno, Node and the browser.

/** The fields of a sealed response `archivoDteOf` reads. */
export interface ArchivoDteSource {
  archivoDte?: string | undefined;
  documento?: Record<string, unknown> | undefined;
  jws?: string | undefined;
  selloRecibido?: string | null | undefined;
}

function payloadObject(jws: string): Record<string, unknown> | null {
  const parts = jws.split(".");
  if (parts.length !== 3 || parts[1] === "") return null;
  try {
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * The Archivo DTE of a sealed result as UTF-8 text, or `null` when there is
 * none to give (contingency: no seal yet; or the response carries neither
 * `archivoDte` nor the signed document and its seal).
 *
 * The server's `archivoDte` wins whenever it is present. Otherwise the file is
 * built from `jws` + `selloRecibido`, taking the document from the JWS payload
 * (what Hacienda validated) and falling back to `documento`.
 */
export function archivoDteOf(result: ArchivoDteSource): string | null {
  if (typeof result.archivoDte === "string" && result.archivoDte !== "") return result.archivoDte;
  const { jws, selloRecibido } = result;
  if (typeof jws !== "string" || jws === "" || typeof selloRecibido !== "string" || selloRecibido === "") return null;
  const signed = jws.split(".").length === 3;
  const document = signed ? (payloadObject(jws) ?? result.documento) : result.documento;
  if (document === undefined || document === null) return null;
  return JSON.stringify({ ...document, firmaElectronica: signed ? jws : null, selloRecibido }, null, 2);
}

/** The fields of a successful invalidation response `invalidationEventFileOf` reads. */
export interface InvalidationEventSource {
  archivoEvento?: { nombre: string; ruta: string; contenido: string } | null | undefined;
}

/**
 * The sealed invalidation event, ready to file as `<CODIGO>.invalidacion.json`
 * beside the original document (which is never rewritten), or `null` when the
 * response has none: a sparse «already invalidated» answer, a server that
 * predates the field, or an event the server could not build. Unlike
 * `archivoDteOf` there is no fallback to build it: the file's name and `ruta`
 * come from the server.
 */
export function invalidationEventFileOf(
  result: InvalidationEventSource,
): { nombre: string; ruta: string; contenido: string } | null {
  const file = result.archivoEvento;
  if (file === null || file === undefined) return null;
  if (typeof file.nombre !== "string" || file.nombre === "" || typeof file.ruta !== "string" || file.ruta === "") return null;
  if (typeof file.contenido !== "string" || file.contenido === "") return null;
  return { nombre: file.nombre, ruta: file.ruta, contenido: file.contenido };
}
