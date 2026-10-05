/// <reference lib="dom" />
// Browser-side file hand-off for the sealed screen: the PDF arrives as base64
// and the JSON as text; both become a Blob download without any server trip.

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadPdf(base64: string, codigoGeneracion: string): void {
  saveBlob(new Blob([base64ToBytes(base64)], { type: "application/pdf" }), `${codigoGeneracion}.pdf`);
}

export function downloadJson(json: string, codigoGeneracion: string): void {
  saveBlob(new Blob([json], { type: "application/json" }), `${codigoGeneracion}.json`);
}
