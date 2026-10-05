// Turns a machine path («cuerpoDocumento[2].precioUni», «receptor.nrc») into
// words a person can act on («Precio de la línea 3», «NRC del receptor»).
// Line indexes on the wire are zero-based; the label is one-based.

import { fill, type FactaMessages } from "./messages.es.ts";
import type { WireFieldIssue } from "./wire.ts";

export interface FieldIssue {
  path: string;
  message: string;
  /** Readable name, or the raw path when nothing matches. */
  label: string;
}

const LINE_ROOTS = new Set(["cuerpoDocumento", "items", "lineas", "cuerpo"]);

export function describeFieldPath(path: string, messages: FactaMessages): string {
  const parts = path
    .replace(/^#?\/?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(/[./]/)
    .filter(Boolean);
  if (parts.length === 0) return path;
  const key = [...parts].reverse().find((p) => !/^\d+$/.test(p)) ?? "";
  const base = messages.fieldLabels[key];
  if (!base) return path;
  const root = parts[0]!;
  if (LINE_ROOTS.has(root)) {
    const idx = parts.slice(1).find((p) => /^\d+$/.test(p));
    if (idx !== undefined) return fill(messages.fieldScopes.line, { label: base, n: Number(idx) + 1 });
    return fill(messages.fieldScopes.document, { label: base });
  }
  if (root === "receptor") return fill(messages.fieldScopes.receptor, { label: base });
  if (root === "emisor") return fill(messages.fieldScopes.issuer, { label: base });
  return fill(messages.fieldScopes.document, { label: base });
}

export function describeFields(fields: WireFieldIssue[] | undefined, messages: FactaMessages): FieldIssue[] {
  return (fields ?? []).map((f) => ({
    path: f.path,
    message: f.message,
    label: describeFieldPath(f.path, messages),
  }));
}
