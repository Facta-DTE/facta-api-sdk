import { useEffect, useMemo, useState } from "react";
import type { RepresentationTemplate } from "../../../../src/types.ts";
import { loadTemplates, type TemplateCatalog } from "../../api.ts";
import {
  fieldOf, FILA_LABEL_MAX, FILA_VALUE_MAX, keysForChoice, MAX_FILAS, templateDisabledReason, type RepresentationForm,
} from "../../../shared/representation.ts";

// «Representación gráfica» of the sale builder: which letter and ticket template to ask for (from the list the API
// offers the key's company, for this DTE type), the per-sale values those templates print, and free rows. Everything
// here travels as `representacion` with the issuance; the API falls back to the company's own template, with a
// `plantilla_no_aplicada` warning, when it cannot honour a choice.

export type TemplatesView =
  | { status: "loading" }
  | { status: "ready"; catalog: TemplateCatalog }
  | { status: "failed"; message: string };

/** Loads the template list for a DTE type; reloads when the type changes. */
export function useTemplates(tipoDte: string): TemplatesView {
  const [view, setView] = useState<TemplatesView>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setView({ status: "loading" });
    loadTemplates(tipoDte).then(
      (catalog) => { if (alive) setView({ status: "ready", catalog }); },
      (error: unknown) => { if (alive) setView({ status: "failed", message: error instanceof Error ? error.message : "No se pudieron leer las plantillas." }); },
    );
    return () => { alive = false; };
  }, [tipoDte]);
  return view;
}

/** The templates of one kind, in the API's order. */
export const templatesOf = (view: TemplatesView, tipo: "carta" | "ticket"): RepresentationTemplate[] =>
  view.status === "ready" && view.catalog.available ? view.catalog.plantillas.filter((t) => t.tipo === tipo) : [];

/** The `datos` keys the current choice prints (the inputs to show). */
export function shownKeysOf(view: TemplatesView, form: RepresentationForm): string[] {
  if (view.status !== "ready" || !view.catalog.available) return [];
  return keysForChoice(view.catalog.plantillas, [form.carta, form.ticket]);
}

function TemplateSelect({ tipo, label, tipoDte, templates, predeterminada, value, onChange }: {
  tipo: "carta" | "ticket";
  label: string;
  tipoDte: string;
  templates: RepresentationTemplate[];
  predeterminada: string | null;
  value: string | null;
  onChange(id: string | null): void;
}) {
  const defaultName = templates.find((t) => t.id === predeterminada)?.nombre ?? predeterminada;
  return (
    <label className="pg-field">
      <span>{label}</span>
      <select data-testid={`repr-${tipo}`} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}>
        <option value="">Plantilla de la empresa{defaultName ? ` (${defaultName})` : ""}</option>
        {templates.map((t) => {
          const reason = templateDisabledReason(t, tipoDte);
          return (
            <option key={t.id} value={t.id} disabled={reason !== null}>
              {t.nombre}{t.origen === "propia" ? " · propia" : ""}{reason !== null ? ` — ${reason}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function SaleRepresentation({ tipoDte, view, form, onChange }: {
  tipoDte: string;
  view: TemplatesView;
  form: RepresentationForm;
  onChange(next: RepresentationForm): void;
}) {
  const shown = useMemo(() => shownKeysOf(view, form), [view, form]);
  const available = view.status === "ready" && view.catalog.available ? view.catalog : null;
  const cartas = templatesOf(view, "carta");
  const tickets = templatesOf(view, "ticket");

  return (
    <section className="pg-repr" aria-label="Representación gráfica" data-testid="repr-section">
      <div className="pg-sale-head"><h3>Representación gráfica</h3></div>
      {view.status === "loading" && <p className="pg-hint" role="status">Leyendo las plantillas disponibles…</p>}
      {view.status === "failed" && <p className="pg-hint" role="status" data-testid="repr-failed">{view.message} Puede emitir igual: se usará la plantilla de la empresa.</p>}
      {view.status === "ready" && !view.catalog.available && (
        <p className="pg-hint" role="status" data-testid="repr-unavailable">
          El API todavía no ofrece elegir la plantilla por documento, así que la lista no se muestra. El documento saldrá con la plantilla de la empresa.
        </p>
      )}
      {available !== null && (
        <>
          <p className="pg-hint">Elija la plantilla de la hoja carta y la del ticket para esta venta. Con el plan gratuito solo se pueden elegir las gratuitas; si el API no puede usar la elegida, emite con la de la empresa y se lo avisa.</p>
          <div className="pg-form-grid">
            <TemplateSelect tipo="carta" label="Hoja carta (PDF)" tipoDte={tipoDte} templates={cartas} predeterminada={available.predeterminada.carta} value={form.carta} onChange={(carta) => onChange({ ...form, carta })} />
            <TemplateSelect tipo="ticket" label="Ticket 80 mm" tipoDte={tipoDte} templates={tickets} predeterminada={available.predeterminada.ticket} value={form.ticket} onChange={(ticket) => onChange({ ...form, ticket })} />
          </div>
          {shown.length > 0 && (
            <div className="pg-form-grid" data-testid="repr-datos">
              {shown.map((key) => {
                const field = fieldOf(key)!;
                return (
                  <label className="pg-field" key={key}>
                    <span>{field.label}</span>
                    <input
                      type="text"
                      data-testid={`repr-dato-${key}`}
                      maxLength={field.kind === "text" || field.kind === "sections" ? field.max : 20}
                      inputMode={field.kind === "int" || field.kind === "last4" ? "numeric" : field.kind === "money" ? "decimal" : undefined}
                      value={form.values[key] ?? ""}
                      onChange={(event) => onChange({ ...form, values: { ...form.values, [key]: event.target.value } })}
                    />
                    {field.hint !== undefined && <small className="pg-hint">{field.hint}</small>}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className="pg-repr-rows" role="group" aria-label="Filas libres">
        <span className="pg-lbl">Filas libres (opcional, hasta {MAX_FILAS})</span>
        {form.filas.map((fila, index) => (
          <div className="pg-repr-row" key={index}>
            <input type="text" aria-label={`Etiqueta de la fila ${index + 1}`} placeholder="Etiqueta" maxLength={FILA_LABEL_MAX} value={fila.etiqueta}
              onChange={(event) => onChange({ ...form, filas: form.filas.map((f, i) => (i === index ? { ...f, etiqueta: event.target.value } : f)) })} />
            <input type="text" aria-label={`Valor de la fila ${index + 1}`} placeholder="Valor" maxLength={FILA_VALUE_MAX} value={fila.valor}
              onChange={(event) => onChange({ ...form, filas: form.filas.map((f, i) => (i === index ? { ...f, valor: event.target.value } : f)) })} />
            <button type="button" className="pg-icon" aria-label={`Quitar la fila ${index + 1}`} onClick={() => onChange({ ...form, filas: form.filas.filter((_, i) => i !== index) })}>×</button>
          </div>
        ))}
        <button type="button" className="pg-link-button" disabled={form.filas.length >= MAX_FILAS} onClick={() => onChange({ ...form, filas: [...form.filas, { etiqueta: "", valor: "" }] })}>+ Agregar fila</button>
        <small className="pg-hint">El API no acepta como etiqueta un nombre de campo fiscal («Total a pagar», «IVA», «Sello»…).</small>
      </div>
    </section>
  );
}
