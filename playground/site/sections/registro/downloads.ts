import { useState } from "react";
import { base64ToBytes, createFactaClient, saveBlob } from "../../../../browser.ts";

// Files go through the SDK handler, which only serves codes this visitor issued.
const client = createFactaClient({ endpoint: "/api/facta" });

export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  async function download(code: string, kind: "pdf" | "json") {
    setBusy(`${code}.${kind}`);
    setProblem(null);
    try {
      const file = await client.downloadDocument(code, kind);
      saveBlob(new Blob([base64ToBytes(file.base64)], { type: file.contentType }), file.filename);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo descargar el archivo.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, problem, download };
}
