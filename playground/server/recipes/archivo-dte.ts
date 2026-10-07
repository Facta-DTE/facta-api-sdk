// Recipe 9 · The two JSON files of a document: the Archivo DTE and the stored original.
//
// A receiver (your customer, an accountant, Hacienda's tools) expects the ARCHIVO DTE: the signed
// document, then `firmaElectronica` (the compact JWS, byte for byte) and `selloRecibido` (Hacienda's
// seal). That is what `downloadDocument(code, "json")` returns, and what a sealed `issue` result carries
// as `archivoDte`. The stored ORIGINAL (`{ codigoGeneracion, ambiente, jws }`) is what you ask for with
// `{ raw: true }`, and the only JSON a document in contingency has (it has no seal yet).
//
// `archivoDteOf(source)` builds the same text locally from `documento` (or the JWS payload) + `jws` +
// `selloRecibido`, so you can check what the server sent byte for byte.
import { archivoDteOf, FactaError, type Facta } from "../../../mod.ts";

export interface Input {
  codigoGeneracion: string;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export async function run(facta: Facta, input: Input) {
  const code = input.codigoGeneracion;
  const status = await facta.getDocumentStatus(code);

  // 1. The default JSON is the Archivo DTE. A document without a seal answers `not_sealed` (HTTP 409).
  let archivoDte: string | null = null;
  let jsonFormat: string | null = null;
  let notSealed = false;
  try {
    const file = await facta.downloadDocument(code, "json");
    archivoDte = text(file.bytes);
    jsonFormat = file.jsonFormat ?? null; // "archivo-dte"; absent on API servers that predate the header
  } catch (error) {
    if (!(error instanceof FactaError) || error.code !== "not_sealed") throw error;
    notSealed = true;
  }

  // 2. `raw: true` asks for the stored original instead.
  const rawFile = await facta.downloadDocument(code, "json", { raw: true });
  const archivoJson = text(rawFile.bytes);

  // 3. Rebuild the Archivo DTE from the original and the seal, and compare.
  let rebuiltMatches: boolean | null = null;
  if (archivoDte !== null && status.estado === "sellado") {
    const stored = JSON.parse(archivoJson) as { jws?: string };
    const rebuilt = archivoDteOf({ jws: stored.jws ?? "", selloRecibido: status.selloRecibido ?? "" });
    rebuiltMatches = rebuilt === archivoDte;
  }

  // The strings become two files on the page: `<code>.json` (Archivo DTE) and `<code>.raw.json` (original).
  return {
    codigoGeneracion: code,
    estado: status.estado,
    notSealed,
    jsonFormat,
    rawFormat: rawFile.jsonFormat ?? null,
    archivoDteBytes: archivoDte === null ? null : archivoDte.length,
    archivoJsonBytes: archivoJson.length,
    rebuiltMatches,
    ...(archivoDte === null ? {} : { archivoDte }),
    archivoJson,
    ...(status.selloRecibido ? { selloRecibido: status.selloRecibido } : {}),
  };
}

export const sample: Input = { codigoGeneracion: "00000000-0000-4000-8000-000000000000" };
