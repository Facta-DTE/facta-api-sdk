// Display formatting. No fiscal arithmetic lives here: amounts are shown as
// the server (or the implementer) gave them.

/** `1234.5` -> `$1,234.50`. Locale-independent on purpose. */
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const negative = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".") as [string, string];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${dec}`;
}

/** Quantity as given; trims trailing zeros of a decimal. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/** `2026-10-05` + `14:32:10` -> `05/10/2026 14:32`. Falls back to the raw text. */
export function formatDateTime(fecEmi?: string, horEmi?: string | null): string {
  if (!fecEmi) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecEmi);
  const date = m ? `${m[3]}/${m[2]}/${m[1]}` : fecEmi;
  const t = horEmi ? /^(\d{2}):(\d{2})/.exec(horEmi) : null;
  return t ? `${date} ${t[1]}:${t[2]}` : date;
}

/** `ABCD…WXYZ` for long identifiers. */
export function truncateMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Quantity times unit price, rounded to cents, for the draft's line amounts. */
export function lineAmount(cantidad: number, precioUni: number | undefined): number | null {
  if (precioUni === undefined || !Number.isFinite(precioUni) || !Number.isFinite(cantidad)) return null;
  return Math.round(cantidad * precioUni * 100) / 100;
}
