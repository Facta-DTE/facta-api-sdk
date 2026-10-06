import { useState } from "react";
import { FactaCustomerPicker, FactaProductPicker, type CustomerOption, type ProductOption } from "../../../../../react.ts";
import type { PlaygroundState } from "../../../api.ts";
import { CATALOG_SEARCH } from "../../../catalog-search.ts";

// Two comboboxes over the account's catalog. The browser only gets the catalog `id`;
// your server builds the sale with `customerId` / `productId`. They need a key with a
// readable catalog; without one the playground shows its demo lists instead.
export function PickersExample({ state }: { state: PlaygroundState }) {
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  if (!state.catalog) {
    return (
      <div className="pg-callout">
        <p><b>El catálogo no está disponible en este playground</b> (la llave no lo lee). Los selectores del SDK necesitan una llave con catálogo legible; mientras tanto, estos son los datos de demostración que usa el constructor de ventas.</p>
        <ul className="pg-links">
          {state.demo.customers.map((c) => <li key={c.id}>{c.label}</li>)}
          {state.demo.products.map((p) => <li key={p.id}>{p.label} · ${p.precioUni.toFixed(2)}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 520 }}>
      <FactaCustomerPicker {...CATALOG_SEARCH} value={customer} onChange={setCustomer} />
      <FactaProductPicker {...CATALOG_SEARCH} onSelect={(product) => setProducts((list) => [...list, product])} />
      <p className="pg-note">
        Id del cliente: <code>{customer?.id ?? "—"}</code> · ids de productos: <code>{products.map((p) => p.id).join(", ") || "—"}</code>
      </p>
    </div>
  );
}
