import { FactaCustomerPicker, type CustomerOption } from "../../../../react.ts";
import { Segmented } from "../../components/ui.tsx";
import type { PlaygroundState, SaleDescription, SaleSource } from "../../api.ts";
import { CATALOG_SEARCH } from "../../catalog-search.ts";
import { CustomReceptor } from "../../receptor/custom-form.tsx";
import { isEmptyForm, receptorChecklist, typedReceptor } from "../../receptor/model.ts";

/** What the visitor chose for the receiver. The browser keeps ids and typed text only. */
export interface ReceptorChoice {
  source: SaleSource;
  demoId: string;
  catalog: CustomerOption | null;
  typed: Record<string, string>;
}

export const EMPTY_CHOICE: ReceptorChoice = { source: "demo", demoId: "", catalog: null, typed: {} };

export { typedReceptor };

export function receptorForSale(type: string, choice: ReceptorChoice): SaleDescription["receptor"] {
  if (choice.source === "catalog") return choice.catalog === null ? undefined : { source: "catalog", customerId: choice.catalog.id };
  if (choice.source === "demo") return choice.demoId === "" ? undefined : { source: "demo", customerId: choice.demoId };
  // A Factura with nothing typed is a Consumidor final: no receiver at all, as the board says.
  if (type === "01" && isEmptyForm(type, choice.typed)) return undefined;
  return { source: "custom", custom: typedReceptor(type, choice.typed) };
}

/** How many data the typed receiver still lacks (0 for the other sources). Gates «Preparar la venta». */
export function receptorMissing(type: string, choice: ReceptorChoice, source: SaleSource = choice.source): number {
  return source === "custom" ? receptorChecklist(type, choice.typed).missing : 0;
}

/** Receiver source (catalog · demo · typed) and the matching control. */
export function ReceptorSection({ state, tipoDte, choice, onChange, error }: {
  state: PlaygroundState;
  tipoDte: string;
  choice: ReceptorChoice;
  onChange(next: ReceptorChoice): void;
  error?: string | undefined;
}) {
  const catalogTypes = state.catalogReceiverTypes ?? ["01", "03", "05", "06"];
  const catalogOk = state.catalog && catalogTypes.includes(tipoDte);
  const catalogWhy = !state.catalog
    ? "Este playground no tiene acceso al catálogo de la llave."
    : !catalogTypes.includes(tipoDte) ? "En este tipo de documento el API no acepta un cliente del catálogo." : null;
  const demo = state.demo;
  const builtIn = demo.builtInReceivers.includes(tipoDte);
  const customers = demo.customers.filter((c) => c.fits.includes(tipoDte));
  const source = choice.source === "catalog" && !catalogOk ? "demo" : choice.source;
  const labels: [SaleSource, string][] = [["catalog", "Catálogo de la llave"], ["demo", "Demostración"], ["custom", "Personalizado"]];

  return (
    <div className="pg-sale-receptor" style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0 }}>
      <div className="pg-field">
        <span>Receptor</span>
        <Segmented
          label="Origen del receptor"
          value={source}
          onChange={(value) => onChange({ ...choice, source: value })}
          choices={labels.map(([value, label]) => ({ value, label, disabled: value === "catalog" && !catalogOk }))}
          block
        />
        {source === "catalog" || catalogWhy === null ? null : <p className="pg-hint">{catalogWhy}</p>}
      </div>

      {source === "catalog" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0 }}>
          <FactaCustomerPicker {...CATALOG_SEARCH} value={choice.catalog} onChange={(customer) => onChange({ ...choice, catalog: customer })} />
          <p className="pg-hint">El navegador solo recibe el identificador. Su servidor confirma que existe en el catálogo y el API completa los datos al emitir.</p>
        </div>
      )}

      {source === "demo" && (
        <label className="pg-field">
          <span>Cliente de demostración{tipoDte === "01" || builtIn ? " (opcional)" : ""}</span>
          <select value={choice.demoId} onChange={(event) => onChange({ ...choice, demoId: event.target.value })}>
            <option value="">{tipoDte === "01" ? "Consumidor final" : builtIn ? "Receptor de demostración incluido" : "Elija un cliente"}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {tipoDte !== "01" && customers.length === 0 && !builtIn && <small className="pg-hint">Este playground no tiene un cliente de demostración para este tipo de documento. Use «Personalizado».</small>}
        </label>
      )}

      {source === "custom" && <CustomReceptor type={tipoDte} typed={choice.typed} error={error} onChange={(typed) => onChange({ ...choice, typed })} />}
    </div>
  );
}
