import { useState } from "react";
import departmentsData from "../../catalogs/cat-012-departamento.json";
import municipalitiesData from "../../catalogs/cat-013-municipio.json";
import { titleCase, type CatalogEntry, type MunicipalityEntry } from "../../receptor/catalogs.ts";

// Two tiny catalogs (≈4 KB) imported statically: the field table is not lazy and a code alone says nothing.
const departments: CatalogEntry[] = departmentsData;
const municipalities: MunicipalityEntry[] = municipalitiesData;

// The catalog recipe's records as a field table next to their JSON. The Worker already masked the personal
// data (`server/catalog-mask.ts`); every key is here, so the shape is the real one.

type Row = [label: string, value: string];
type Rec = Record<string, unknown>;

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const price = (value: unknown): string => (typeof value === "number" ? `$${value.toFixed(2)}` : show(value));

/** «06» → «San Salvador (06)», «23» of 06 → «San Salvador Centro (23)»; a code the catalogs do not know stays as it is. */
function placeName(key: string, value: unknown, department: unknown): string {
  const code = typeof value === "string" ? value : "";
  if (key === "departamento") { const d = departments.find((e) => e.code === code); return d === undefined ? show(value) : `${d.value} (${code})`; }
  const m = municipalities.find((e) => e.code === code && e.departamento === department);
  return m === undefined ? show(value) : `${titleCase(m.value)} (${code})`;
}

function addressOf(value: unknown): string {
  if (typeof value !== "object" || value === null) return "—";
  const a = value as Rec;
  const parts = [["departamento", "Departamento"], ["municipio", "Municipio"], ["distrito", "Distrito"], ["pais", "País"], ["complemento", "Complemento"]]
    .filter(([key]) => a[key!] !== undefined)
    .map(([key, label]) => `${label} ${key === "departamento" || key === "municipio" ? placeName(key!, a[key!], a.departamento) : show(a[key!])}`);
  return parts.length === 0 ? "—" : parts.join(" · ");
}

export function customerRows(c: Rec): Row[] {
  return [
    ["Nombre", show(c.name)],
    ["Tipo de documento", show(c.doc_type)],
    ["Número de documento", show(c.doc_number)],
    ["NRC", show(c.nrc)],
    ["Actividad económica", show(c.activity_code)],
    ["Dirección", addressOf(c.address)],
    ["Correo", show(c.email)],
    ["Teléfono", show(c.phone)],
  ];
}

export function productRows(p: Rec): Row[] {
  return [
    ["Código", show(p.code)],
    ["Código de barras", show(p.barcode)],
    ["Descripción", show(p.description)],
    ["Tipo de ítem", show(p.item_type)],
    ["Unidad de medida", show(p.unit_of_measure)],
    ["Precio unitario", price(p.unit_price)],
    ["Precio incluye IVA", show(p.vat_included)],
    ["Tratamiento de IVA", show(p.sale_class)],
    ["Activo", show(p.active)],
  ];
}

function Record({ rec, rows, title, onUse, useLabel }: { rec: Rec; rows: Row[]; title: string; onUse(): void; useLabel: string }) {
  return (
    <div className="srv-record">
      <div className="srv-record-fields">
        <h5>{title}</h5>
        <table className="srv-fields">
          <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
        </table>
        <button type="button" className="pg-btn" onClick={onUse}>{useLabel}</button>
      </div>
      <pre className="srv-record-json" tabIndex={0} aria-label="JSON del registro">{JSON.stringify(rec, null, 2)}</pre>
    </div>
  );
}

function List({ heading, items, rowsOf, titleOf, onUse, useLabel }: { heading: string; items: Rec[]; rowsOf(r: Rec): Row[]; titleOf(r: Rec): string; onUse(id: string): void; useLabel: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <h4>{heading} ({items.length})</h4>
      {items.map((rec) => {
        const id = String(rec.id);
        return (
          <div key={id} className="srv-record-item">
            <button type="button" className="srv-chip" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>{titleOf(rec)}</button>
            {open === id && <Record rec={rec} rows={rowsOf(rec)} title={titleOf(rec)} onUse={() => onUse(id)} useLabel={useLabel} />}
          </div>
        );
      })}
    </div>
  );
}

const records = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter((v): v is Rec => typeof v === "object" && v !== null && "id" in v) : []);

/** Every record the recipe listed, expandable to its field table and its JSON. */
export function CatalogFields({ result, onPick }: { result: { customers?: unknown; products?: unknown }; onPick(name: string, value: string): void }) {
  const customers = records(result.customers);
  const products = records(result.products);
  if (customers.length === 0 && products.length === 0) return null;
  return (
    <div className="srv-catalog">
      <p className="srv-catalog-note">
        Datos del catálogo real de la llave de pruebas. Por privacidad, los datos personales se muestran enmascarados; en su servidor el SDK los entrega completos.
        Pulse un registro para ver todos sus campos. Cada uno es un <a href="https://github.com/Facta-DTE/facta-api-sdk/blob/main/src/types.ts" target="_blank" rel="noreferrer"><code>CatalogCustomer</code> / <code>CatalogProduct</code></a>.
      </p>
      {customers.length > 0 && <List heading="Clientes" items={customers} rowsOf={customerRows} titleOf={(c) => show(c.name) === "—" ? String(c.id) : show(c.name)} onUse={(id) => onPick("customerId", id)} useLabel="Usar este cliente (customerId)" />}
      {products.length > 0 && <List heading="Productos" items={products} rowsOf={productRows} titleOf={(p) => show(p.description) === "—" ? String(p.id) : show(p.description)} onUse={(id) => onPick("productId", id)} useLabel="Usar este producto (productId)" />}
    </div>
  );
}
