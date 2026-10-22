// The playground's one place that knows how to make an «Archivo DTE».
//
// The Archivo DTE is what a receiver gets: the signed document, then `firmaElectronica`
// (the compact JWS, byte for byte) and `selloRecibido` (Hacienda's seal), pretty-printed with
// two spaces. It is what a person should see, so every view and every «JSON DTE» download
// shows it; the stored original («raw») is offered only when asked for.
//
// Until the API returns it itself (`archivoDte` in the sealed response and the default of
// `downloadDocument(code, { kind: "json" })`, with `{ raw: true }` for the stored bytes), the
// playground builds it here from `documento` + `jws` + `selloRecibido`. THE SWITCH LATER lives in
// this file: `archivoDteOf` already prefers a server-provided `archivoDte`, and
// `archivoDteFromStored` is the function to delete once the download returns the Archivo DTE.
//
// The serialization mirrors `receiverFile` / `archivoDteBytes` in the monorepo's
// `packages/storage/src/archive.ts`, so the same document gives the same bytes there and here.

export type DteDocument = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The JWS payload as an object, or null when the middle segment is not a JSON object. */
export function jwsPayload(jws: string): DteDocument | null {
  const segment = jws.split(".")[1];
  if (segment === undefined || segment === "") return null;
  try {
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The document, then `firmaElectronica`, then `selloRecibido`: the exact text a receiver gets. */
export function archivoDteText(document: DteDocument, firma: string | null, sello: string | null): string {
  return JSON.stringify({ ...document, firmaElectronica: firma, selloRecibido: sello }, null, 2);
}

/** The same text as bytes (what `receiverFile` returns). */
export const archivoDteBytes = (document: DteDocument, firma: string | null, sello: string | null): Uint8Array => new TextEncoder().encode(archivoDteText(document, firma, sello));

function build(documento: unknown, jws: unknown, sello: unknown): string | null {
  if (!nonEmpty(sello)) return null;
  const signed = typeof jws === "string" && jws.split(".").length === 3;
  const document = signed ? (jwsPayload(jws) ?? (isRecord(documento) ? documento : null)) : isRecord(documento) ? documento : null;
  if (document === null) return null;
  return archivoDteText(document, signed ? jws : null, sello);
}

export interface SealedResultLike {
  documento?: unknown;
  jws?: unknown;
  selloRecibido?: unknown;
  /** Present once the API returns it (SDK next version). */
  archivoDte?: unknown;
}

/**
 * The Archivo DTE of a sealed result, or null while it has no seal (contingency).
 * Mirrors the SDK helper `archivoDteOf(result)`; a server-provided `archivoDte` wins.
 */
export function archivoDteOf(result: SealedResultLike): string | null {
  if (nonEmpty(result.archivoDte)) return result.archivoDte;
  return build(result.documento, result.jws, result.selloRecibido);
}

/**
 * The Archivo DTE from a stored file in any of the three shapes the API has written: the holding
 * `{ codigoGeneracion, ambiente, jws }`, the app's archived record `{ firma, documento, respuestaMh }`
 * and a receiver file that already carries `firmaElectronica`. The seal comes from the file or from `seal`
 * (the registry's `selloRecibido`). Null when the shape is unknown or no seal is known.
 */
export function archivoDteFromStored(stored: string, seal: string | null = null): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const mh = isRecord(parsed.respuestaMh) ? parsed.respuestaMh : {};
  const sello = [parsed.selloRecibido, mh.selloRecibido, seal].find(nonEmpty) ?? null;
  if (nonEmpty(parsed.firma) && isRecord(parsed.documento)) return build(parsed.documento, parsed.firma, sello);
  if (nonEmpty(parsed.firmaElectronica) && isRecord(parsed.identificacion)) return build(parsed, parsed.firmaElectronica, sello);
  if (nonEmpty(parsed.jws)) return build({}, parsed.jws, sello);
  return null;
}

export interface ArchivoDteParts {
  document: DteDocument;
  firma: string | null;
  sello: string | null;
}

/** An Archivo DTE text split back into the document, the signature and the seal. Null when it is not one. */
export function parseArchivoDte(text: string): ArchivoDteParts | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    const { firmaElectronica, selloRecibido, ...document } = parsed;
    return { document, firma: nonEmpty(firmaElectronica) ? firmaElectronica : null, sello: nonEmpty(selloRecibido) ? selloRecibido : null };
  } catch {
    return null;
  }
}

/** File names a document travels under: `<codigoGeneracion>.json` (the DTE) and `<codigoGeneracion>.raw.json`. */
export const dteFileName = (code: string): string => `${code.toUpperCase()}.json`;
export const rawFileName = (code: string): string => `${code.toUpperCase()}.raw.json`;
