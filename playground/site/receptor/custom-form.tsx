import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Segmented } from "../components/ui.tsx";
import { loadCatalogs, municipalitiesOf, searchCatalog, titleCase, type Catalogs } from "./catalogs.ts";
import { checkDocument, checkNrc, DOC } from "./identity.ts";
import { defaultDocType, DOCS, docTypeOf, missingText, previewLines, receptorChecklist, TAXPAYER, typedReceptor, type Typed } from "./model.ts";
import { presetsFor, PRESET_CAPTION } from "./presets.ts";
import { Typeahead } from "./typeahead.tsx";
import "./receptor.css";

/** The catalogs, downloaded the first time «Personalizado» is opened. */
function useCatalogs(): { catalogs: Catalogs | null; failed: boolean } {
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadCatalogs().then((loaded) => alive && setCatalogs(loaded), () => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  return { catalogs, failed };
}

interface Api { f: Typed; set(patch: Typed): void; error: string | undefined }

function Field({ label, optional, hint, bad, good, invalid, wide, children, htmlFor }: {
  label: string; optional?: boolean | undefined; hint?: ReactNode; bad?: string | null; good?: string | null; invalid?: boolean | undefined; wide?: boolean | undefined; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className={`pg-field${invalid ? " pg-field--invalid" : ""}${wide ? " rcp-wide" : ""}`}>
      {htmlFor === undefined ? <span>{label}{optional && <span className="rcp-opt"> opcional</span>}</span> : <label htmlFor={htmlFor}>{label}{optional && <span className="rcp-opt"> opcional</span>}</label>}
      {children}
      {bad ? <small className="rcp-bad" role="alert">{bad}</small> : good ? <small className="rcp-good">{good}</small> : hint !== undefined ? <small className="pg-hint">{hint}</small> : null}
    </div>
  );
}

function TextField({ name, label, api, optional, hint, max = 100, type = "text", placeholder, wide, mono }: {
  name: string; label: string; api: Api; optional?: boolean; hint?: ReactNode; max?: number; type?: "text" | "email" | "tel"; placeholder?: string; wide?: boolean; mono?: boolean;
}) {
  const id = useId();
  const value = api.f[name] ?? "";
  const invalid = api.error === name || api.error === `direccion.${name}`;
  return (
    <Field label={label} optional={optional} hint={hint} invalid={invalid} wide={wide} htmlFor={id}>
      <input id={id} type={type} className={mono ? "mono" : undefined} maxLength={max} value={value} placeholder={placeholder} autoComplete="off" aria-invalid={invalid || undefined} onChange={(event) => api.set({ [name]: event.target.value })} />
    </Field>
  );
}

/** A number field with a live verdict: the tick, the red reason or the green «cómo viaja» line. */
function ValidatedField({ id, label, value, onChange, verdict, hint, optional, placeholder, max, invalid, disabled }: {
  id: string; label: string; value: string; onChange(value: string): void;
  verdict: { valid: boolean; problem: string | null; note: string | null };
  hint?: ReactNode; optional?: boolean; placeholder?: string; max: number; invalid?: boolean; disabled?: boolean;
}) {
  const [blurred, setBlurred] = useState(false);
  const bad = value.trim() !== "" && verdict.problem !== null && (blurred || /verificador/.test(verdict.problem)) ? verdict.problem : null;
  return (
    <Field label={label} optional={optional} bad={bad} good={verdict.valid ? verdict.note : null} hint={hint} invalid={invalid || bad !== null} htmlFor={id}>
      <div className="rcp-wrap">
        <input id={id} type="text" inputMode="text" className={`mono${verdict.valid ? " rcp-ok" : ""}`} maxLength={max} value={value} placeholder={placeholder} disabled={disabled} autoComplete="off" spellCheck={false}
          aria-invalid={bad !== null || invalid || undefined} onBlur={() => setBlurred(true)} onChange={(event) => onChange(event.target.value)} />
        {verdict.valid && <span className="rcp-tick" aria-hidden>✓</span>}
      </div>
    </Field>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rcp-section">
      <h4>{title}</h4>
      <div className="rcp-grid">{children}</div>
    </section>
  );
}

function CountryField({ api, catalogs, failed }: { api: Api; catalogs: Catalogs | null; failed: boolean }) {
  const search = useCallback((query: string) => (catalogs === null ? [] : searchCatalog(catalogs.countries, query)), [catalogs]);
  const picked = (api.f.codPais ?? "") !== "" && (api.f.nombrePais ?? "") !== "" ? { code: api.f.codPais!, value: api.f.nombrePais! } : null;
  return (
    <div className="rcp-wide">
      <Typeahead label="País" value={picked} search={search} placeholder="Escriba el país o su código (US, GT…)" footer="Catálogo oficial CAT-020 · países"
        invalid={api.error === "codPais" || api.error === "nombrePais"}
        disabledReason={failed ? "No se pudo cargar el catálogo. Recargue la página." : catalogs === null ? "Cargando el catálogo…" : null}
        onPick={(entry) => api.set(entry === null ? { codPais: "", nombrePais: "" } : { codPais: entry.code, nombrePais: entry.value })} />
    </div>
  );
}

function CustomFields({ type, api, catalogs, failed }: { type: string; api: Api; catalogs: Catalogs | null; failed: boolean }) {
  const { f, set, error } = api;
  const docId = useId();
  const nrcId = useId();
  const docs = DOCS[type];
  const docType = docTypeOf(type, f);
  const doc = checkDocument(docType, (f.numDocumento ?? "").trim());
  const nrc = checkNrc(f.nrc ?? "");
  const department = f.departamento ?? "";
  const activities = useCallback((query: string) => (catalogs === null ? [] : searchCatalog(catalogs.activities, query)), [catalogs]);
  const municipalities = useMemo(() => (catalogs === null ? [] : municipalitiesOf(catalogs.municipalities, department)), [catalogs, department]);
  const departments = catalogs === null ? [] : catalogs.departments.filter((d) => d.code !== "00");
  const departmentName = departments.find((d) => d.code === department)?.value;
  const activityPicked = (f.codActividad ?? "") !== "" && (f.descActividad ?? "") !== "" ? { code: f.codActividad!, value: f.descActividad! } : null;
  const activityReason = failed ? "No se pudo cargar el catálogo. Recargue la página." : catalogs === null ? "Cargando el catálogo…" : null;
  const invalid = (name: string) => error === name || error === `direccion.${name}`;
  const typeLabel = type === "14" ? "Nombre del sujeto excluido" : type === "01" ? "Nombre" : TAXPAYER.has(type) ? "Nombre o razón social" : "Nombre del receptor";
  const docTypeName = docs?.find(([code]) => code === docType)?.[1] ?? "documento";

  return (
    <>
      <Section title="Quién compra">
        <TextField name="nombre" label={typeLabel} api={api} wide optional={false} />
        {type === "11" ? (
          <>
            <TextField name="numDocumento" label="Documento" api={api} max={20} mono placeholder="US-998877" hint="Entre 3 y 20 letras, números o guiones." />
            <div className="pg-field">
              <span>Tipo de persona</span>
              <Segmented label="Tipo de persona" block value={(f.tipoPersona ?? "") as "1" | "2"} onChange={(value) => set({ tipoPersona: value })} choices={[{ value: "1", label: "Natural" }, { value: "2", label: "Jurídica" }]} />
            </div>
            <TextField name="descActividad" label="Actividad económica" api={api} max={150} wide placeholder="A qué se dedica el receptor" />
          </>
        ) : (
          <>
            <div className="pg-field">
              <span>Documento{type === "01" ? <span className="rcp-opt"> opcional</span> : null}</span>
              <Segmented
                label="Tipo de documento"
                block
                value={(f.tipoDocumento ?? "") !== "" ? f.tipoDocumento! : defaultDocType(type)}
                onChange={(value) => set({ tipoDocumento: value, ...(value === "" ? { numDocumento: "" } : {}) })}
                choices={[...(type === "01" ? [{ value: "", label: "Ninguno" }] : []), ...(docs ?? []).map(([value, label]) => ({ value, label: value === DOC.OTHER ? "Otro" : label }))]}
              />
            </div>
            <ValidatedField
              id={docId}
              label={`Número de ${docTypeName === "Otro documento" ? "documento" : docTypeName}`}
              value={f.numDocumento ?? ""}
              onChange={(value) => set({ numDocumento: value })}
              verdict={doc}
              disabled={docType === ""}
              placeholder={docType === "" ? "Elija el tipo de documento" : docType === DOC.DUI ? "01234567-8" : docType === DOC.NIT ? "0614-170892-101-1" : "Pasaporte, carnet…"}
              max={20}
              invalid={invalid("numDocumento") || invalid("tipoDocumento")}
              optional={type === "01"}
              hint={docType === DOC.OTHER ? "Entre 3 y 20 letras, números o guiones." : docType === "" ? undefined : docType === DOC.DUI ? "9 dígitos con su dígito verificador; el guion es opcional." : "14 dígitos (o 9 si es el DUI homologado); los guiones son opcionales."}
            />
            {TAXPAYER.has(type) && (
              <>
                <ValidatedField id={nrcId} label="NRC" value={f.nrc ?? ""} onChange={(value) => set({ nrc: value })} verdict={{ ...nrc, note: null }} max={10} invalid={invalid("nrc")}
                  hint="De 2 a 8 dígitos. El guion se quita al enviar." />
                <TextField name="nombreComercial" label="Nombre comercial" api={api} optional max={150} />
              </>
            )}
            {(TAXPAYER.has(type) || type === "14") && (
              <div className="rcp-wide">
                <Typeahead label="Actividad económica" optional={type === "14"} value={activityPicked} search={activities} placeholder="Escriba una palabra (pan, ferretería…) o el código" footer="Catálogo oficial CAT-019 · 774 actividades"
                  invalid={invalid("codActividad") || invalid("descActividad")} disabledReason={activityReason}
                  onPick={(entry) => set(entry === null ? { codActividad: "", descActividad: "" } : { codActividad: entry.code, descActividad: entry.value })} />
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Dónde está">
        {type === "11" ? (
          <>
            <CountryField api={api} catalogs={catalogs} failed={failed} />
            <TextField name="complemento" label="Dirección en el extranjero" api={api} max={200} wide placeholder="Calle, ciudad, estado o provincia, código postal" />
          </>
        ) : (
          <>
            <Field label="Departamento" optional={type === "01"} invalid={invalid("departamento")}>
              <select aria-label="Departamento" value={department} disabled={catalogs === null} onChange={(event) => set({ departamento: event.target.value, municipio: "" })}>
                <option value="">{catalogs === null ? "Cargando…" : "Elija el departamento"}</option>
                {departments.map((d) => <option key={d.code} value={d.code}>{d.value}</option>)}
              </select>
            </Field>
            <Field label="Municipio" optional={type === "01"} invalid={invalid("municipio")} hint={departmentName === undefined ? "Elija primero el departamento." : `Solo los de ${departmentName}, con la división de 2024.`}>
              <select aria-label="Municipio" value={f.municipio ?? ""} disabled={municipalities.length === 0} onChange={(event) => set({ municipio: event.target.value })}>
                <option value="">Elija el municipio</option>
                {municipalities.map((m) => <option key={m.code} value={m.code}>{titleCase(m.value)}</option>)}
              </select>
            </Field>
            <TextField name="direccion" label="Dirección" api={api} optional={type === "01"} max={200} wide placeholder="Calle, colonia, número" />
          </>
        )}
      </Section>

      <Section title="Contacto">
        <TextField name="correo" label="Correo" api={api} type="email" optional={type === "01" || type === "14"} hint="Va en el documento. El correo de entrega se elige aparte, más abajo." />
        <TextField name="telefono" label="Teléfono" api={api} type="tel" optional max={30} mono />
      </Section>
    </>
  );
}

function Preview({ type, f }: { type: string; f: Typed }) {
  const lines = previewLines(type, f);
  const note = lines.length === 1 && lines[0]!.key === null ? lines[0]!.comment : undefined;
  return (
    <div className="rcp-code">
      <div className="rcp-code-head">
        <b>Lo que su servidor manda en <code>receptor</code></b>
        <span className="mono">se actualiza al escribir</span>
      </div>
      <pre className="mono" aria-label="Vista previa del receptor" data-testid="receptor-preview">
        {note !== undefined ? <span className="c">{note}</span> : (
          <>
            {"{\n"}
            {lines.map((line, index) => {
              const pad = "  ".repeat(line.indent);
              if (line.brace === "}") return <span key={index}>{pad}{"}"}{line.comma ? "," : ""}{"\n"}</span>;
              return (
                <span key={index}>
                  {pad}<span className="k">"{line.key}"</span>:{" "}
                  {line.brace === "{" ? "{" : line.comment !== undefined ? <span className="c">{line.comment}</span> : <span className="s">{line.value}</span>}
                  {line.comma ? "," : ""}
                  {"\n"}
                </span>
              );
            })}
            {"}"}
          </>
        )}
      </pre>
    </div>
  );
}

/** «Lo que pide un crédito fiscal»: the checklist and the note about what is missing. */
function Readiness({ type, f }: { type: string; f: Typed }) {
  const list = receptorChecklist(type, f);
  return (
    <div className="rcp-card" data-testid="receptor-checklist">
      <h4>Lo que pide {list.title}</h4>
      <ul>
        {list.items.map((item) => (
          <li key={item.id} className={item.ok ? "is-ok" : "is-pending"}>
            <span className="rcp-dot" aria-hidden>{item.ok ? "✓" : "•"}</span>
            <span>
              {item.label}{!item.ok && item.hint !== undefined && <span className="rcp-faint"> — {item.hint}</span>}
              <span className="pg-sr">{item.ok ? " (listo)" : " (falta)"}</span>
            </span>
          </li>
        ))}
      </ul>
      {list.consumerFinal && <p className="rcp-note rcp-note--info">Sin datos, el documento sale a nombre de «Consumidor final».</p>}
      {list.missing > 0 && <p className="rcp-note" role="status">{missingText(list.missing)} «Preparar la venta» se activa cuando la lista esté completa.</p>}
      {list.missing === 0 && <p className="rcp-note rcp-note--ok" role="status">La lista está completa.</p>}
    </div>
  );
}

/** The whole «Personalizado» receiver: examples, form, checklist and the JSON that travels. */
export function CustomReceptor({ type, typed, onChange, error }: { type: string; typed: Typed; onChange(next: Typed): void; error: string | undefined }) {
  const { catalogs, failed } = useCatalogs();
  const [active, setActive] = useState<string | null>(null);
  const presets = presetsFor(type);
  useEffect(() => setActive(null), [type]);
  const api: Api = { f: typed, set: (patch) => onChange({ ...typed, ...patch }), error };

  return (
    <div className="rcp" data-testid="custom-receptor">
      <div className="rcp-main">
        <p className="pg-hint">Solo viajan en la venta que usted prepara; el playground no los guarda. Hacienda decide si son válidos y se le muestra su respuesta.</p>
        <div className="rcp-start">
          <b>Empiece con un ejemplo y cambie lo que quiera</b>
          <p className="pg-hint">Datos ficticios que cumplen el formato de Hacienda para {PRESET_CAPTION[type] ?? "este documento"}. Puede editar cada campo.</p>
          <div className="rcp-chips">
            {presets.map((preset) => (
              <button key={preset.id} type="button" className={`rcp-chip${active === preset.id ? " is-on" : ""}`} aria-pressed={active === preset.id} onClick={() => { setActive(preset.id); onChange({ ...preset.fields }); }}>
                <span aria-hidden>{preset.icon}</span> {preset.label}
              </button>
            ))}
            <button type="button" className="rcp-chip rcp-chip--plain" onClick={() => { setActive(null); onChange({}); }}>Vaciar el formulario</button>
          </div>
        </div>
        <CustomFields type={type} api={api} catalogs={catalogs} failed={failed} />
      </div>
      <aside className="rcp-side" aria-label="Estado del receptor">
        <Readiness type={type} f={typed} />
        <Preview type={type} f={typed} />
        <div className="rcp-card rcp-card--plain">
          <h4>En otros tipos de documento</h4>
          <p><b>Factura:</b> todo es opcional; sin datos sale a «Consumidor final».</p>
          <p><b>Exportación:</b> país con buscador (CAT-020), tipo de persona y dirección libre en el extranjero.</p>
          <p><b>Sujeto excluido:</b> DUI u otro documento; actividad opcional.</p>
          <p><b>Notas:</b> el receptor del crédito fiscal relacionado.</p>
        </div>
      </aside>
    </div>
  );
}

export { typedReceptor };
