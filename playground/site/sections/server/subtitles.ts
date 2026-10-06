// UI-only one-line subtitles for the recipe rail (the recipe data itself lives in server/recipes/specs.ts).
export const RECIPE_SUBTITLES: Record<string, string> = {
  "issue-idempotent": "Factura o crédito fiscal, y el reintento seguro",
  "prepare-sign": "prepare → sign",
  "status-recovery": "Después de una respuesta incierta",
  "invalidate": "Solo sus documentos de prueba",
  "documents-storage": "PDF, JSON y copias administradas",
  "catalog-refs": "customerId y productId",
  "order-webhook": "Un webhook que devuelve un DTE sellado",
};

// The rail uses short names; the full title stays on the page.
export const RECIPE_SHORT_TITLES: Record<string, string> = {
  "issue-idempotent": "Emitir con idempotencia",
  "prepare-sign": "Preparar, revisar y firmar",
  "status-recovery": "Estado y recuperación",
  "invalidate": "Anular",
  "documents-storage": "Listar y descargar",
  "catalog-refs": "Catálogo",
  "order-webhook": "Pedido entrante",
};

/** The short excerpt the phone shows: the body of the recipe's exported function. */
export function excerptOf(source: string): string {
  const lines = source.trim().split("\n");
  const start = lines.findIndex((l) => /^export (async )?function/.test(l));
  if (start < 0) return lines.filter((l) => l.trim() !== "" && !/^\s*(import|\/\/)/.test(l)).slice(0, 9).join("\n");
  const close = lines.findIndex((l, i) => i > start && l === "}");
  return lines.slice(start, (close < 0 ? start + 9 : Math.min(close + 1, start + 12))).join("\n");
}
