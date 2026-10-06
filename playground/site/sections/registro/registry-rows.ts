// Pure helpers of the registry rows (no React): the numbers and labels Inicio, Registro and the receipt
// example show, and which rows still need the API. The hooks live in registry-data.ts.

import type { IssueResult } from "../../../../src/browser/index.ts";
import type { RegistryDocument } from "../../api.ts";

export const TYPE_NAMES: Record<string, string> = { "01": "Factura", "03": "Crédito fiscal", "05": "Nota de crédito", "06": "Nota de débito", "11": "Exportación", "14": "Sujeto excluido" };

/** Document total: the one stored when it was issued, else the API's current view when it was read. */
export function totalOf(d: RegistryDocument): number | null {
  if (typeof d.total === "number") return d.total;
  // The API's projection carries `totalPagar` for every type; `montoTotalOperacion` only for some.
  const totales = (d.current as { totales?: { totalPagar?: unknown; montoTotalOperacion?: unknown } | null } | null)?.totales;
  if (typeof totales?.totalPagar === "number") return totales.totalPagar;
  return typeof totales?.montoTotalOperacion === "number" ? totales.montoTotalOperacion : null;
}

const FINAL = new Set(["sellado", "invalidado", "rechazado"]);

/**
 * Does a row need the API? A row with its total and a final state has nothing left to learn; a pending
 * one (contingencia) or one without a total does. The server still answers from its cache when it can.
 */
export const needsEnrich = (d: RegistryDocument): boolean => d.total === undefined || (d.current === null && !FINAL.has(d.estado));

/** A registry row that lacks the API's view (used for the seal of the newest document). */
/** Hacienda's seal as the API last reported it; null while it is unknown (contingency or not read yet). */
export const sealOf = (d: RegistryDocument): string | null => {
  const seal = (d.current as { selloRecibido?: unknown } | null)?.selloRecibido;
  return typeof seal === "string" && seal !== "" ? seal : null;
};

export const lacksCurrent = (d: RegistryDocument): boolean => d.current === null;

/** Hacienda's literal observations for a document, as the API returned them. */
export function observationsOf(d: RegistryDocument): string[] {
  const list = (d.current as { observaciones?: unknown } | null)?.observaciones;
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === "string" && o !== "") : [];
}

export const money = (value: number) => `$${value.toFixed(2)}`;

/** «…000000000214»: the last digits of a control number. */
export const tail = (numeroControl: string, size = 12) => `…${numeroControl.slice(-size)}`;

/** «Hoy 10:42», «Ayer 17:20», or «5 oct 09:10», in the visitor's own clock. */
export function whenOf(d: RegistryDocument, now = new Date()): string {
  const at = new Date(d.issuedAt);
  if (Number.isNaN(at.getTime())) return "—";
  const time = at.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `Hoy ${time}`;
  if (diff === 1) return `Ayer ${time}`;
  return `${at.toLocaleDateString("es-SV", { day: "numeric", month: "short" })} ${time}`;
}

/**
 * A registry row as the SDK's own `IssueResult`, so `FactaReceipt`, `FactaStatusBadge` and
 * `FactaDownloadButton` can show a document from an earlier visit: what the API said when it was read,
 * else what the ledger stored at issue time. No files travel here: downloads ask the server.
 */
export function resultFromRegistry(d: RegistryDocument): IssueResult {
  const current = d.current as { fecEmi?: string; horEmi?: string | null; selloRecibido?: string | null; observaciones?: string[]; ambiente?: string } | null;
  const total = totalOf(d);
  return {
    estado: d.estado === "contingencia" ? "contingencia" : "sellado",
    codigoGeneracion: d.codigoGeneracion,
    numeroControl: d.numeroControl,
    tipoDte: d.tipoDte as IssueResult["tipoDte"],
    ambiente: current?.ambiente ?? "00",
    fecEmi: current?.fecEmi ?? d.issuedAt.slice(0, 10),
    ...(typeof current?.horEmi === "string" ? { horEmi: current.horEmi } : {}),
    ...(typeof current?.selloRecibido === "string" ? { selloRecibido: current.selloRecibido } : {}),
    ...(current?.observaciones === undefined ? {} : { observaciones: current.observaciones }),
    ...(total === null ? {} : { totales: { totalPagar: total, montoTotalOperacion: total } }),
  };
}
