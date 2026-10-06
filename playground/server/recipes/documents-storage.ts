// Recipe 5 · List and download documents, read managed copies and storage status.
//
// Reading never issues anything. `listDocuments` pages with a cursor (`siguiente`);
// this recipe returns the first page without the receiver, which most screens do not need.
//
// DISPONIBLE DESDE LA PRÓXIMA VERSIÓN DEL SDK (todavía no corre con la versión publicada):
//   the JSON download will return the Archivo DTE by default (document + firmaElectronica + selloRecibido),
//   and the stored original is asked for with the `raw` flag:
//     const dte = await facta.downloadDocument(code, { kind: "json" });
//     const original = await facta.downloadDocument(code, { kind: "json", raw: true });
//   Today the playground builds the Archivo DTE from document + jws + selloRecibido; see shared/archivo-dte.ts.
import { FactaError, type Facta, type ListedDte } from "../../../mod.ts";

export interface Input {
  /** Download this document too (and list its managed copies). */
  codigoGeneracion?: string;
  kind: "pdf" | "json";
  limit: number;
  /** Keep only these generation codes (the playground lists just the visitor's own). */
  onlyCodes?: string[];
}

/** A failed part is data, not an exception: one missing capability must not hide the rest. */
async function attempt<T>(read: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await read();
  } catch (error) {
    return { error: error instanceof FactaError ? error.code : "error" };
  }
}

export async function run(facta: Facta, input: Input) {
  // `listDocuments` pages with a cursor (`siguiente`). Receivers are dropped: most screens do not need them.
  const wanted = input.onlyCodes === undefined ? null : new Set(input.onlyCodes.map((code) => code.toUpperCase()));
  const documents: Array<Omit<ListedDte, "receptor">> = [];
  let cursor: string | undefined;
  let next: string | null = null;
  for (let pages = 0; pages < (wanted === null ? 1 : 4) && documents.length < input.limit; pages++) {
    const page = await facta.listDocuments({ limit: wanted === null ? input.limit : 50, ...(cursor === undefined ? {} : { cursor }) });
    for (const { receptor: _receiver, ...rest } of page.documentos) {
      if (wanted === null || wanted.has(rest.codigoGeneracion.toUpperCase())) documents.push(rest);
    }
    next = page.siguiente;
    if (next === null) break;
    cursor = next;
  }
  documents.length = Math.min(documents.length, input.limit);
  const storage = await attempt(() => facta.getStorageStatus());
  const code = input.codigoGeneracion;
  if (code === undefined) return { documents, next, storage };

  const copies = await attempt(() => facta.getDocumentCopies({ generationCode: code }));
  // `bytes` is a Uint8Array: write it to disk or stream it to your user.
  const file = await facta.downloadDocument(code, input.kind);
  // The stored JSON has no seal of its own; Hacienda's seal comes from the document's status. The playground
  // joins both into the Archivo DTE, the JSON a person should see; the stored bytes stay as the raw file.
  const status = input.kind === "json" ? await attempt(() => facta.getDocumentStatus(code)) : undefined;
  const selloRecibido = status !== undefined && "selloRecibido" in status ? status.selloRecibido : undefined;
  return { documents, next, storage, copies, file, ...(selloRecibido ? { selloRecibido } : {}) };
}

export const sample: Input = { kind: "pdf", limit: 10 };
