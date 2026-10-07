// «Registro» detail: the receiver, the concept and the Archivo DTE of the visitor's OWN documents, read in
// one listing call with `include: ["dte"]` instead of one call per document.
//
// The playground key lists EVERY visitor's documents, so this module keeps a row only when its code is in
// the set the caller passes (the visitor's own ledger), and nothing else leaves it: another visitor's
// receiver can never reach the response, which is why nothing here needs masking. Nothing is cached (the
// ledger deliberately holds no receiver data, and the cache is no place to start).

import type { DteResumen } from "../../src/archivo-dte-summary.ts";
import type { DtePage, ListDocumentsFilters, ListedDte } from "../../src/types.ts";

export interface DetailEntry {
  codigoGeneracion: string;
  resumen: DteResumen | null;
  archivoDte: string | null;
  dteError: { code: string; message: string } | null;
}

export interface DetailResult {
  /** False when the API ignored the flag (a server that predates it): the page then falls back. */
  supported: boolean;
  documents: DetailEntry[];
}

/** Pages to walk looking for the visitor's rows: each is one API call of at most 25 documents. */
export const DETAIL_MAX_PAGES = 3;

const dayBefore = (iso: string): string | null => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
};

/**
 * `wanted` maps each own code (upper case) to the time it was issued. Walks the newest-first listing from
 * the top, bounded by the oldest wanted day, until every wanted row was seen.
 */
export async function findDetails(
  list: (filters: ListDocumentsFilters) => Promise<DtePage>,
  wanted: Map<string, string>,
  maxPages = DETAIL_MAX_PAGES,
): Promise<DetailResult> {
  if (wanted.size === 0) return { supported: true, documents: [] };
  const oldest = [...wanted.values()].sort()[0]!;
  const desde = dayBefore(oldest);
  const found = new Map<string, DetailEntry>();
  let cursor: string | undefined;
  let sawRows = false;
  let sawFlag = false;
  for (let page = 0; page < maxPages && found.size < wanted.size; page += 1) {
    const result = await list({ include: ["dte"], limit: 25, ...(desde === null ? {} : { desde }), ...(cursor === undefined ? {} : { cursor }) });
    for (const row of result.documentos as ListedDte[]) {
      sawRows = true;
      if (row.archivoDte !== undefined || row.dteError !== undefined) sawFlag = true;
      const code = row.codigoGeneracion.toUpperCase();
      if (!wanted.has(code)) continue;
      found.set(code, {
        codigoGeneracion: code,
        resumen: row.resumen ?? null,
        archivoDte: row.archivoDte ?? null,
        dteError: row.dteError === undefined ? null : { code: row.dteError.code, message: row.dteError.message },
      });
    }
    if (result.siguiente === null || result.siguiente === undefined) break;
    cursor = result.siguiente;
  }
  // Rows came back but none carries the flag's fields: the API ignored `include`.
  if (sawRows && !sawFlag) return { supported: false, documents: [] };
  return { supported: true, documents: [...found.values()] };
}
