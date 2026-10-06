import { useCallback, useEffect, useState } from "react";
import { ApiError, loadRegistry, type RegistryDocument } from "../../api.ts";
import { usePlayground } from "../../state.tsx";

// Shared by Inicio («Sus últimas facturas») and Registro: the visitor's own documents and
// what the API says about each one. Nothing here is invented: a value the server did not
// send reads «—».

export const TYPE_NAMES: Record<string, string> = { "01": "Factura", "03": "Crédito fiscal", "05": "Nota de crédito", "06": "Nota de débito", "11": "Exportación", "14": "Sujeto excluido" };

/** Document total from the API's current view, when the server could read it (the newest 25). */
export function totalOf(d: RegistryDocument): number | null {
  const totales = (d.current as { totales?: { montoTotalOperacion?: unknown } | null } | null)?.totales;
  return typeof totales?.montoTotalOperacion === "number" ? totales.montoTotalOperacion : null;
}

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

export type Registry = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; documents: RegistryDocument[] };

/** Loads the registry once the visitor is signed in. `reload` re-reads it. */
export function useRegistry(): { registry: Registry; reload(): Promise<void>; signedIn: boolean } {
  const { view } = usePlayground();
  const signedIn = view.status === "ready" && view.state.visitor !== null;
  const [registry, setRegistry] = useState<Registry>({ status: "loading" });
  const reload = useCallback(async () => {
    try {
      setRegistry({ status: "ready", documents: await loadRegistry() });
    } catch (error) {
      setRegistry({ status: "error", message: error instanceof ApiError ? error.message : "No se pudo leer su registro." });
    }
  }, []);
  useEffect(() => { if (signedIn) void reload(); }, [signedIn, reload]);
  return { registry, reload, signedIn };
}
