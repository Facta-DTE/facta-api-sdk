// Masks a catalog record before it leaves the Worker.
//
// The playground reads a REAL catalog, so a customer is personal data. The visitor must still see the whole
// SHAPE of the record: every key survives and only the values are masked, so nobody concludes that the API
// returns just a name. Products are business data and pass whole. Absent or null fields appear as «—».
import { maskAddress } from "./delivery.ts";

const DOT = "•";
export const EMPTY = "—";
export const HIDDEN_ADDRESS = "•••• (oculta)";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const dots = (n: number): string => DOT.repeat(Math.max(1, n));

/** «Pablo La Esquina» → «Pa••• La E•••••»: two characters of each word. */
export function maskName(value: string): string {
  return value.split(/(\s+)/).map((part) => (/^\s*$/.test(part) ? part : part.length <= 2 ? part : part.slice(0, 2) + dots(part.length - 2))).join("");
}

/** Keeps the last `keep` letters or digits and masks the rest, separators kept where they were. */
export function maskTail(value: string, keep: number): string {
  const total = (value.match(/[0-9A-Za-z]/g) ?? []).length;
  let seen = 0;
  return value.replace(/[0-9A-Za-z]/g, (ch) => (++seen > total - keep ? ch : DOT));
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** A value of an unknown customer field: anything we cannot name is masked, never shown. */
function maskUnknown(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "string") return maskName(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return dots(String(value).length);
  if (Array.isArray(value)) return value.map(maskUnknown);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskUnknown(v)]));
  return DOT;
}

/** The address with every key, the codes whole and the street hidden. */
function maskAddressRecord(value: unknown): Record<string, unknown> {
  const a = isRecord(value) ? value : {};
  const out: Record<string, unknown> = {};
  for (const key of ["departamento", "municipio", "distrito", "pais"]) out[key] = text(a[key]) ?? EMPTY;
  out.complemento = text(a.complemento) === null ? EMPTY : HIDDEN_ADDRESS;
  for (const [key, v] of Object.entries(a)) if (!(key in out)) out[key] = maskUnknown(v);
  return out;
}

const KNOWN_CUSTOMER = new Set(["id", "name", "doc_type", "doc_number", "nrc", "activity_code", "address", "phone", "email"]);

export function maskCustomer(c: Record<string, unknown>): Record<string, unknown> {
  const name = text(c.name);
  const doc = text(c.doc_number);
  const nrc = text(c.nrc);
  const phone = text(c.phone);
  const email = text(c.email);
  const out: Record<string, unknown> = {
    id: c.id ?? EMPTY,
    name: name === null ? EMPTY : maskName(name),
    doc_type: text(c.doc_type) ?? EMPTY,
    doc_number: doc === null ? EMPTY : maskTail(doc, 3),
    nrc: nrc === null ? EMPTY : maskTail(nrc, 2),
    activity_code: text(c.activity_code) ?? EMPTY,
    address: maskAddressRecord(c.address),
    phone: phone === null ? EMPTY : maskTail(phone, 2),
    email: email === null ? EMPTY : maskAddress(email),
  };
  for (const [key, v] of Object.entries(c)) if (!KNOWN_CUSTOMER.has(key)) out[key] = maskUnknown(v);
  return out;
}

const PRODUCT_KEYS = ["id", "code", "barcode", "description", "item_type", "unit_of_measure", "unit_price", "vat_included", "active", "sale_class"] as const;

/** Products are business data: every field whole; only the missing ones show «—». */
export function maskProduct(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PRODUCT_KEYS) out[key] = p[key] === undefined || p[key] === null || p[key] === "" ? EMPTY : p[key];
  for (const [key, v] of Object.entries(p)) if (!(key in out)) out[key] = v;
  return out;
}
