import { FactaCustomerPicker, type CustomerOption } from "../../../../react.ts";
import { Segmented } from "../../components/ui.tsx";
import type { PlaygroundState, SaleDescription, SaleSource } from "../../api.ts";

/** What the visitor chose for the receiver. The browser keeps ids and typed text only. */
export interface ReceptorChoice {
  source: SaleSource;
  demoId: string;
  catalog: CustomerOption | null;
  typed: Record<string, string>;
}

export const EMPTY_CHOICE: ReceptorChoice = { source: "demo", demoId: "", catalog: null, typed: {} };

const ALL_DOCS = [["13", "DUI"], ["36", "NIT"], ["37", "Otro documento"]] as const;
/** Document types each type accepts for a typed receiver (CAT-022 codes the SDK itself labels). */
const DOCS: Record<string, readonly (readonly [string, string])[]> = {
  "01": ALL_DOCS,
  "03": [["36", "NIT"], ["13", "DUI"]],
  "05": [["36", "NIT"], ["13", "DUI"]],
  "06": [["36", "NIT"], ["13", "DUI"]],
  "14": ALL_DOCS,
};
const TAXPAYER = new Set(["03", "05", "06"]);

/** The typed fields as the API wants them: empty strings dropped, the address grouped. */
export function typedReceptor(type: string, f: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["nombre", "tipoDocumento", "numDocumento", "nrc", "codActividad", "descActividad", "nombreComercial", "correo", "telefono", "codPais", "nombrePais", "complemento"]) {
    const value = (f[key] ?? "").trim();
    if (value !== "" && !(key === "complemento" && type !== "11")) out[key] = value;
  }
  if (type === "11" && f.tipoPersona) out.tipoPersona = Number(f.tipoPersona);
  if (type !== "11" && [f.departamento, f.municipio, f.direccion].some((v) => (v ?? "").trim() !== "")) {
    out.direccion = { departamento: (f.departamento ?? "").trim(), municipio: (f.municipio ?? "").trim(), complemento: (f.direccion ?? "").trim() };
  }
  return out;
}

export function receptorForSale(type: string, choice: ReceptorChoice): SaleDescription["receptor"] {
  if (choice.source === "catalog") return choice.catalog === null ? undefined : { source: "catalog", customerId: choice.catalog.id };
  if (choice.source === "demo") return choice.demoId === "" ? undefined : { source: "demo", customerId: choice.demoId };
  return { source: "custom", custom: typedReceptor(type, choice.typed) };
}

function Text({ label, name, f, set, optional, error, type = "text", max = 100, placeholder, hint }: {
  label: string; name: string; f: Record<string, string>; set(name: string, value: string): void;
  optional?: boolean | undefined; error?: string | undefined; type?: "text" | "email" | "tel"; max?: number; placeholder?: string; hint?: string | undefined;
}) {
  const invalid = error === name;
  return (
    <label className={`pg-field${invalid ? " pg-field--invalid" : ""}`}>
      <span>{label}{optional ? " (opcional)" : ""}</span>
      <input type={type} maxLength={max} value={f[name] ?? ""} placeholder={placeholder} aria-invalid={invalid || undefined}
        autoComplete="off" onChange={(event) => set(name, event.target.value)} />
      {hint !== undefined && <small className="pg-hint">{hint}</small>}
    </label>
  );
}

/** The fields a typed receiver needs for each document type (receptor.ts validates the same set). */
function CustomFields({ type, f, set, error }: { type: string; f: Record<string, string>; set(name: string, value: string): void; error?: string | undefined }) {
  const docs = DOCS[type];
  const invalid = (name: string) => error === name || error === `direccion.${name}`;
  const common = { f, set, error };
  const address = (mandatory: boolean) => (
    <>
      <label className={`pg-field${invalid("departamento") ? " pg-field--invalid" : ""}`}>
        <span>Departamento (código){mandatory ? "" : " (opcional)"}</span>
        <input type="text" inputMode="numeric" maxLength={2} value={f.departamento ?? ""} placeholder="06" autoComplete="off" onChange={(event) => set("departamento", event.target.value)} />
      </label>
      <label className={`pg-field${invalid("municipio") ? " pg-field--invalid" : ""}`}>
        <span>Municipio (código){mandatory ? "" : " (opcional)"}</span>
        <input type="text" inputMode="numeric" maxLength={2} value={f.municipio ?? ""} placeholder="20" autoComplete="off" onChange={(event) => set("municipio", event.target.value)} />
      </label>
      <Text label={`Dirección${mandatory ? "" : " (opcional)"}`} name="direccion" f={f} set={set} error={error === "direccion" || error === "direccion.complemento" ? "direccion" : undefined} max={200} placeholder="Calle, colonia, número" />
    </>
  );

  if (type === "11") {
    return (
      <div className="pg-form-grid">
        <Text label="Nombre del receptor" name="nombre" {...common} />
        <Text label="Documento" name="numDocumento" {...common} max={20} placeholder="US-998877" />
        <Text label="Código de país (2 letras)" name="codPais" {...common} max={2} placeholder="US" />
        <Text label="Nombre del país" name="nombrePais" {...common} max={60} placeholder="United States" />
        <Text label="Dirección" name="complemento" {...common} max={200} placeholder="Miami, Florida" />
        <Text label="Actividad económica" name="descActividad" {...common} max={150} />
        <Text label="Correo" name="correo" type="email" {...common} />
        <Text label="Teléfono" name="telefono" type="tel" optional {...common} max={30} />
        <div className="pg-field" style={{ gridColumn: "1 / -1" }}>
          <span>Tipo de persona</span>
          <Segmented label="Tipo de persona" value={(f.tipoPersona ?? "") as "1" | "2"} onChange={(value) => set("tipoPersona", value)} choices={[{ value: "1", label: "Persona natural" }, { value: "2", label: "Persona jurídica" }]} />
        </div>
      </div>
    );
  }

  return (
    <div className="pg-form-grid">
      <Text label={type === "14" ? "Nombre del sujeto excluido" : "Nombre"} name="nombre" {...common} />
      <label className={`pg-field${invalid("tipoDocumento") ? " pg-field--invalid" : ""}`}>
        <span>Tipo de documento{type === "01" ? " (opcional)" : ""}</span>
        <select value={f.tipoDocumento ?? ""} onChange={(event) => set("tipoDocumento", event.target.value)}>
          <option value="">{type === "01" ? "Sin documento" : "Elija el tipo"}</option>
          {docs?.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      <Text label="Número de documento" name="numDocumento" optional={type === "01"} {...common} max={20}
        hint={f.tipoDocumento === "13" ? "DUI: 9 dígitos. El guion se quita al enviar." : f.tipoDocumento === "36" ? "NIT: 14 dígitos." : undefined} />
      {TAXPAYER.has(type) && (
        <>
          <Text label="NRC" name="nrc" {...common} max={10} hint="De 2 a 8 dígitos; no puede ser todo ceros." />
          <Text label="Código de actividad" name="codActividad" {...common} max={6} placeholder="46510" />
          <Text label="Actividad económica" name="descActividad" {...common} max={150} />
          <Text label="Nombre comercial" name="nombreComercial" optional {...common} max={150} />
        </>
      )}
      {address(type !== "01")}
      {type === "14" && <Text label="Código de actividad" name="codActividad" optional {...common} max={6} placeholder="47111" />}
      <Text label="Correo" name="correo" type="email" optional={type === "01" || type === "14"} {...common} />
      <Text label="Teléfono" name="telefono" type="tel" optional {...common} max={30} />
    </div>
  );
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
  const set = (name: string, value: string) => onChange({ ...choice, typed: { ...choice.typed, [name]: value } });
  const source = choice.source === "catalog" && !catalogOk ? "demo" : choice.source;
  const labels: [SaleSource, string][] = [["catalog", "Catálogo de la llave"], ["demo", "Demostración"], ["custom", "Personalizado"]];

  return (
    <div className="pg-sale-receptor" style={{ display: "grid", gap: 12 }}>
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
        <div style={{ display: "grid", gap: 8 }}>
          <FactaCustomerPicker value={choice.catalog} onChange={(customer) => onChange({ ...choice, catalog: customer })} />
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

      {source === "custom" && (
        <div className="pg-subform">
          <h3>Datos del receptor</h3>
          <p className="pg-hint">Solo viajan en la venta que usted prepara; el playground no los guarda. Hacienda decide si son válidos y se le muestra su respuesta.</p>
          <CustomFields type={tipoDte} f={choice.typed} set={set} error={error} />
        </div>
      )}
    </div>
  );
}
