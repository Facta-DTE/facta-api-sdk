import type { FactaWarningHeader, IssueResult, UnknownFieldWarning } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The `campo_desconocido` warnings of a sealed response or error `details.advertencias`: request fields
 * Facta DTE does not know. They were ignored and are not part of the document (a `descuento` instead of
 * `montoDescu` is a discount the document does not carry). Accepts the result, or the `advertencias` array.
 */
export function unknownFieldWarnings(source: unknown): UnknownFieldWarning[] {
  const list = Array.isArray(source) ? source : isRecord(source) ? source.advertencias : undefined;
  if (!Array.isArray(list)) return [];
  const out: UnknownFieldWarning[] = [];
  for (const item of list) {
    if (!isRecord(item) || (item.codigo ?? item.code) !== "campo_desconocido" || typeof item.campo !== "string") continue;
    out.push({
      codigo: "campo_desconocido",
      campo: item.campo,
      mensaje: typeof item.mensaje === "string" ? item.mensaje : "",
      ...(typeof item.sugerencia === "string" ? { sugerencia: item.sugerencia } : {}),
    });
  }
  return out;
}

/** Parse a `Facta-Warning` header value such as `campo_desconocido; campos=2`. `null` for an empty value. */
export function parseFactaWarning(value: string | null | undefined): FactaWarningHeader | null {
  if (typeof value !== "string") return null;
  const [head, ...params] = value.split(";").map((part) => part.trim());
  if (!head) return null;
  let count: number | null = null;
  for (const param of params) {
    const match = /^campos\s*=\s*(\d+)$/i.exec(param);
    if (match) count = Number(match[1]);
  }
  return { code: head, count };
}

/** Attach `unknownFields` and `factaWarning` to an issue result; the result is returned untouched when there are none. */
export function withWarnings<T extends IssueResult>(result: T, header: string | null): T {
  const unknownFields = unknownFieldWarnings(result);
  const factaWarning = parseFactaWarning(header);
  if (unknownFields.length === 0 && factaWarning === null) return result;
  return {
    ...result,
    ...(unknownFields.length > 0 ? { unknownFields } : {}),
    ...(factaWarning !== null ? { factaWarning } : {}),
  };
}
