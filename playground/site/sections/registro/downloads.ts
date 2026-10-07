import { useState } from "react";
import { base64ToBytes, createFactaClient, saveBlob } from "../../../../browser.ts";
import { playgroundFetch } from "../../api.ts";
import { archivoDteFromStored, dteFileName, rawFileName } from "../../../shared/archivo-dte.ts";

// Files go through the SDK handler, which only serves codes this visitor issued.
const client = createFactaClient({ endpoint: "/api/facta", fetch: (input, init) => playgroundFetch(input, init) });

/**
 * `json` is the Archivo DTE (what a person should see) and `raw` the stored original.
 * The SDK handler serves the stored file, so the Archivo DTE is built here from it plus Hacienda's seal
 * (`seal`, the registry's `selloRecibido`). When the API returns the Archivo DTE by default, `json` becomes
 * `client.downloadDocument(code, { kind: "json" })` and `raw` the same call with `{ raw: true }`.
 */
export type DownloadKind = "pdf" | "json" | "raw" | "ticket";

export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  async function download(code: string, kind: DownloadKind, seal: string | null = null) {
    setBusy(`${code}.${kind}`);
    setProblem(null);
    try {
      // The ticket is the 80 mm roll; it never travels in a list, only per document on request.
      const file = kind === "ticket" ? await client.downloadDocument(code, "ticket", { paperWidthMm: 80 }) : await client.downloadDocument(code, kind === "pdf" ? "pdf" : "json");
      const bytes = base64ToBytes(file.base64);
      if (kind === "pdf" || kind === "ticket") return saveBlob(new Blob([bytes], { type: file.contentType }), file.filename);
      if (kind === "raw") return saveBlob(new Blob([bytes], { type: file.contentType }), rawFileName(code));
      const dte = archivoDteFromStored(new TextDecoder().decode(bytes), seal);
      if (dte === null) throw new Error("Todavía no se conoce el sello de Hacienda de este documento. Descargue el JSON original (raw).");
      saveBlob(new Blob([dte], { type: "application/json" }), dteFileName(code));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo descargar el archivo.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, problem, download };
}
