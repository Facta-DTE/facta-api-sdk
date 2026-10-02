import type { DownloadedDocument } from "./types.ts";

export type PrintJobState = "submitted" | "unknown";

/** The caller owns the Node/Deno/browser printer integration. */
export interface PrintTransport {
  /** Stable, non-secret identifier used in caller logs. */
  id: string;
  submit(job: PrintJob, options?: { signal?: AbortSignal }): Promise<PrintTransportResponse>;
}

export interface PrintJob {
  codigoGeneracion: string;
  kind: "pdf" | "ticket";
  filename: string;
  contentType: "application/pdf";
  bytes: Uint8Array;
  paperWidthMm?: number;
}

/** `submitted` means accepted by the adapter; `unknown` means reconcile before retrying. */
export interface PrintTransportResponse {
  state: PrintJobState;
  jobId?: string;
}

export interface PrintResult {
  state: PrintJobState;
  transportId: string;
  jobId: string | null;
}

/**
 * Submit downloaded PDF bytes once to a caller-supplied printer adapter.
 * The SDK does not retry printing and never claims that paper was printed.
 */
export async function submitPrintJob(
  document: DownloadedDocument,
  transport: PrintTransport,
  options: { signal?: AbortSignal } = {},
): Promise<PrintResult> {
  if (document.kind !== "pdf" && document.kind !== "ticket") {
    throw new TypeError("Only PDF artifacts can be submitted to a printer.");
  }
  if (document.contentType.split(";")[0].trim().toLowerCase() !== "application/pdf") {
    throw new TypeError("Artifact does not have content-type application/pdf.");
  }
  if (document.bytes.byteLength === 0) {
    throw new TypeError("An empty PDF cannot be submitted to a printer.");
  }
  if (!transport.id.trim()) {
    throw new TypeError("PrintTransport.id must not be empty.");
  }
  if (document.kind === "ticket" && (
    !Number.isInteger(document.paperWidthMm) ||
    document.paperWidthMm! < 40 || document.paperWidthMm! > 120
  )) {
    throw new TypeError("Ticket must include an integer paper width from 40 through 120 mm.");
  }

  const response = await transport.submit({
    codigoGeneracion: document.codigoGeneracion,
    kind: document.kind,
    filename: document.filename ?? `${document.codigoGeneracion}${document.kind === "ticket" ? "-ticket" : ""}.pdf`,
    contentType: "application/pdf",
    bytes: document.bytes.slice(),
    ...(document.paperWidthMm === undefined ? {} : { paperWidthMm: document.paperWidthMm }),
  }, options);
  if (response.state !== "submitted" && response.state !== "unknown") {
    throw new TypeError("PrintTransport returned an unknown state.");
  }
  return {
    state: response.state,
    transportId: transport.id,
    jobId: typeof response.jobId === "string" ? response.jobId : null,
  };
}
