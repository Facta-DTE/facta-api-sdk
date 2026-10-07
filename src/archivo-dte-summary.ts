// `summarizeArchivoDte`: the one-line story of a document, read from the
// Archivo DTE (the legal document) and nothing else.
//
// The receiver comes from the document itself, never from the `dte_index`
// receiver blob: that blob is encrypted when the company keeps its catalog in
// private mode, and a summary that changed shape with a company setting would
// be a trap. The legal document says the same thing in both modes.
//
// Pure and dependency-free; runs in Deno, Node and the browser.

export interface DteResumenReceptor {
  nombre: string | null;
  tipoDocumento: string | null;
  numDocumento: string | null;
}

export interface DteResumen {
  /** Null for a consumer-final document that names nobody. */
  receptor: DteResumenReceptor | null;
  /** Number of lines in `cuerpoDocumento`. */
  lineas: number;
  primeraDescripcion: string | null;
  totalIva: number | null;
  totalPagar: number | null;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Receiver-like block by document type: receptor, sujetoExcluido (FSE), donatario (CD). */
function receptorOf(document: Dict): DteResumenReceptor | null {
  const block = [document["receptor"], document["sujetoExcluido"], document["donatario"]].find(isDict);
  if (block === undefined) return null;
  const nombre = str(block["nombre"]);
  // A CCF's receiver has `nit` and no tipoDocumento: the NIT is document type 36.
  const nit = str(block["nit"]);
  const numDocumento = str(block["numDocumento"]) ?? nit;
  const tipoDocumento = str(block["tipoDocumento"]) ?? (nit !== null ? "36" : null);
  if (nombre === null && numDocumento === null) return null;
  return { nombre, tipoDocumento, numDocumento };
}

/** CCF-style documents carry their IVA as tributo 20 instead of `totalIva`. */
function ivaOf(summary: Dict): number | null {
  const direct = num(summary["totalIva"]);
  if (direct !== null) return direct;
  const tributos = summary["tributos"];
  if (!Array.isArray(tributos)) return null;
  const iva = tributos.filter(isDict).filter((t) => t["codigo"] === "20");
  if (iva.length === 0) return null;
  return Math.round(iva.reduce((sum, t) => sum + (num(t["valor"]) ?? 0), 0) * 1e8) / 1e8;
}

/**
 * Summarize an Archivo DTE (its JSON text, or the parsed object). Returns
 * `null` when the input is not a readable DTE document, never throws.
 */
export function summarizeArchivoDte(archivoDte: string | Record<string, unknown>): DteResumen | null {
  let document: unknown = archivoDte;
  if (typeof archivoDte === "string") {
    try {
      document = JSON.parse(archivoDte);
    } catch {
      return null;
    }
  }
  if (!isDict(document) || !isDict(document["identificacion"])) return null;
  const body = Array.isArray(document["cuerpoDocumento"]) ? document["cuerpoDocumento"] : [];
  const first = body.find(isDict);
  const summary = isDict(document["resumen"]) ? document["resumen"] : {};
  return {
    receptor: receptorOf(document),
    lineas: body.length,
    primeraDescripcion: first === undefined ? null : str(first["descripcion"]),
    totalIva: ivaOf(summary),
    totalPagar: num(summary["totalPagar"]) ?? num(summary["montoTotalOperacion"]) ??
      num(summary["valorTotal"]) ?? num(summary["totalSujetoRetencion"]),
  };
}
