// Pure rules of «Las tres formas del documento» (DocumentForms): the roll width, when a ticket cannot be
// drawn, how a failed download is explained, and whether this browser can show a PDF inline.

export const MIN_ROLL_MM = 40;
export const MAX_ROLL_MM = 120;
export const DEFAULT_ROLL_MM = 80;
/** The common thermal rolls; anything else is «Otro» (40–120). */
export const ROLL_PRESETS = [58, 80] as const;

/** The width the API accepts: an integer from 40 through 120. Null for anything else. */
export function parseRollWidth(input: string | number): number | null {
  const text = String(input).trim();
  if (!/^\d{2,3}$/.test(text)) return null;
  const value = Number(text);
  return value >= MIN_ROLL_MM && value <= MAX_ROLL_MM ? value : null;
}

export type DocumentFormsKind = "document" | "return-event";

/**
 * Why a ticket cannot be offered, or null when it can. A return event has no ticket; a contingency
 * document has no Hacienda seal yet and the ticket is drawn from the sealed document.
 */
export function ticketUnavailable(input: { kind?: DocumentFormsKind | undefined; estado?: string | undefined }): string | null {
  if (input.kind === "return-event") return "Un evento de retorno no tiene ticket: se emite como evento, no como venta. Use su PDF o su JSON.";
  if (input.estado === "contingencia") return "Este documento está en contingencia y todavía no tiene el sello de Hacienda. El ticket se dibuja desde el documento sellado: estará disponible cuando Hacienda lo confirme.";
  return null;
}

/** What to say, in place of the preview, when a download failed. */
export function downloadProblem(error: { code?: string; status?: number } | null | undefined, what: "ticket" | "pdf" | "json"): string {
  const code = error?.code;
  const status = error?.status;
  if (code === "return_pdf_unavailable" && what === "ticket") return "Un evento de retorno no tiene ticket.";
  if (code === "not_sealed" || status === 409) return what === "json"
    ? "Este documento aún no tiene el sello de Hacienda: descargue el JSON original desde el Registro."
    : "Este documento aún no tiene el sello de Hacienda: el archivo se dibuja desde el documento sellado.";
  if (code === "document_not_yours" || status === 403) return "Solo puede ver los documentos que usted emitió en este playground.";
  if (status === 404) return "El API no encontró este documento o su archivo todavía no está disponible. Intente de nuevo en unos segundos.";
  if (status === 429 || code === "rate_limited") return "El API pidió esperar un momento. Intente de nuevo en unos segundos.";
  return "No se pudo preparar el archivo. Intente de nuevo.";
}

/** True when an `<iframe>` of a PDF blob will actually render: desktop browsers with their own viewer. */
export function canShowPdfInline(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number; pdfViewerEnabled?: boolean }): boolean {
  const ua = nav.userAgent ?? "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  if (ios || /Android/.test(ua)) return false;
  return nav.pdfViewerEnabled !== false;
}

export const ticketLabel = (width: number): string => `Ticket ${width} mm`;
