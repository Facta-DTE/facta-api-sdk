// The graphical-representation choice of a sale: which letter / ticket template to ask for and which per-sale values
// (`representacion.datos`) to send. Pure, shared by the page and the Worker.
//
// The field catalogue below mirrors the API's whitelist (the app's `rg-representation.ts`). The API is the authority: it
// validates every value and refuses a free-row label that imitates a fiscal field. The playground only keeps the shape sane
// (known keys, lengths) so the page cannot send an arbitrary object.

import type { DteType, RepresentationTemplate } from "../../src/types.ts";

export type DataKind = "text" | "int" | "last4" | "money" | "sections";

export interface DataField {
  key: string;
  label: string;
  kind: DataKind;
  /** Text length, or the maximum number / amount for `int` and `money`. */
  max: number;
  hint?: string;
}

export const DATA_FIELDS: readonly DataField[] = [
  { key: "mesa", label: "Mesa", kind: "text", max: 10 },
  { key: "mesero", label: "Mesero", kind: "text", max: 30 },
  { key: "comensales", label: "Comensales", kind: "int", max: 999, hint: "De 1 a 999." },
  { key: "cajero", label: "Cajero", kind: "text", max: 40 },
  { key: "pedido", label: "Pedido", kind: "text", max: 30 },
  { key: "bomba", label: "Bomba", kind: "text", max: 20 },
  { key: "placa", label: "Placa", kind: "text", max: 12 },
  { key: "kilometraje", label: "Kilometraje", kind: "int", max: 9_999_999 },
  { key: "puntos", label: "Puntos", kind: "int", max: 999_999_999 },
  { key: "tarjetaUltimos4", label: "Tarjeta (últimos 4)", kind: "last4", max: 4, hint: "Solo los últimos 4 dígitos." },
  { key: "propinaSugerida", label: "Propina sugerida", kind: "money", max: 99_999.99, hint: "Monto con hasta 2 decimales." },
  { key: "paciente", label: "Paciente", kind: "text", max: 60 },
  { key: "expediente", label: "Expediente", kind: "text", max: 20 },
  { key: "proximaCita", label: "Próxima cita", kind: "text", max: 40 },
  { key: "medico", label: "Médico", kind: "text", max: 60 },
  { key: "registroProfesional", label: "Registro profesional", kind: "text", max: 20 },
  { key: "ordenTrabajo", label: "Orden de trabajo", kind: "text", max: 20 },
  { key: "entrega", label: "Entrega", kind: "text", max: 60 },
  { key: "evento", label: "Evento", kind: "text", max: 60 },
  { key: "fechaEvento", label: "Fecha del evento", kind: "text", max: 30 },
  { key: "comentario", label: "Comentario", kind: "text", max: 60 },
  { key: "proyecto", label: "Proyecto", kind: "text", max: 60 },
  { key: "entregable", label: "Entregable", kind: "text", max: 40 },
  { key: "periodo", label: "Período", kind: "text", max: 40 },
  { key: "secciones", label: "Secciones", kind: "sections", max: 400, hint: "Nombre:desde-hasta separado por «;», sobre el número de línea (ej.: Alimentos:1-2;Bebidas:3-3)." },
];

const FIELD_BY_KEY = new Map(DATA_FIELDS.map((f) => [f.key, f]));
export const fieldOf = (key: string): DataField | undefined => FIELD_BY_KEY.get(key);

export const MAX_FILAS = 10;
export const FILA_LABEL_MAX = 30;
export const FILA_VALUE_MAX = 80;

export const PLAN_REASON = "Requiere plan Lite o Pro";
export const TYPE_REASON = "No es compatible con este tipo de documento";

/** Why a template cannot be chosen right now (shown beside the disabled option), or null when it can. */
export function templateDisabledReason(template: RepresentationTemplate, tipoDte: string): string | null {
  if (!template.permitida) return PLAN_REASON;
  if (template.tiposDte !== undefined && !template.tiposDte.includes(tipoDte as DteType)) return TYPE_REASON;
  return null;
}

/** The `datos` keys the chosen templates print, in the catalogue's order, known keys only. */
export function keysForChoice(templates: readonly RepresentationTemplate[], chosen: readonly (string | null)[]): string[] {
  const wanted = new Set<string>();
  for (const id of chosen) {
    if (id === null) continue;
    for (const key of templates.find((t) => t.id === id)?.clavesDatos ?? []) wanted.add(key);
  }
  return DATA_FIELDS.filter((f) => wanted.has(f.key)).map((f) => f.key);
}

export interface RepresentationForm {
  /** Template id, or null to leave the company's own. */
  carta: string | null;
  ticket: string | null;
  values: Record<string, string>;
  filas: { etiqueta: string; valor: string }[];
}

export const EMPTY_REPRESENTATION: RepresentationForm = { carta: null, ticket: null, values: {}, filas: [] };

/** What the sale description carries as `representacion` (the wire shape of the API). */
export interface RepresentationInput {
  plantilla?: { carta?: string; ticket?: string };
  datos?: Record<string, unknown> & { filas?: { etiqueta: string; valor: string }[] };
}

/**
 * The form as the API wants it. Only the keys in `shown` are sent (a value typed for a template that was then replaced is
 * dropped), empty values are omitted, whole-number fields go as numbers. Undefined when nothing is chosen.
 */
export function buildRepresentation(form: RepresentationForm, shown: readonly string[]): RepresentationInput | undefined {
  const out: RepresentationInput = {};
  const plantilla: { carta?: string; ticket?: string } = {};
  if (form.carta !== null) plantilla.carta = form.carta;
  if (form.ticket !== null) plantilla.ticket = form.ticket;
  if (Object.keys(plantilla).length > 0) out.plantilla = plantilla;

  const datos: NonNullable<RepresentationInput["datos"]> = {};
  for (const key of shown) {
    const field = fieldOf(key);
    const raw = (form.values[key] ?? "").trim();
    if (field === undefined || raw === "") continue;
    datos[key] = field.kind === "int" && /^[0-9]+$/.test(raw) ? Number(raw) : raw;
  }
  const filas = form.filas
    .map((f) => ({ etiqueta: f.etiqueta.trim(), valor: f.valor.trim() }))
    .filter((f) => f.etiqueta !== "" && f.valor !== "")
    .slice(0, MAX_FILAS);
  if (filas.length > 0) datos.filas = filas;
  if (Object.keys(datos).length > 0) out.datos = datos;
  return out.plantilla === undefined && out.datos === undefined ? undefined : out;
}

const TEMPLATE_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
const hasControl = (text: string) => /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text);

export type RepresentationVerdict = { ok: true; value: RepresentationInput | undefined } | { ok: false; message: string };

/** Shape check for what the browser sent (Worker side). The API does the fiscal validation of the values. */
export function checkRepresentation(raw: unknown): RepresentationVerdict {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const bad = (message: string): RepresentationVerdict => ({ ok: false, message });
  if (typeof raw !== "object" || Array.isArray(raw)) return bad("La representación gráfica no es válida.");
  const top = raw as Record<string, unknown>;
  for (const key of Object.keys(top)) if (key !== "plantilla" && key !== "datos") return bad(`«${key}» no es parte de la representación gráfica.`);
  const out: RepresentationInput = {};
  if (top.plantilla !== undefined) {
    const p = top.plantilla;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return bad("La plantilla elegida no es válida.");
    const plantilla: { carta?: string; ticket?: string } = {};
    for (const [key, id] of Object.entries(p as Record<string, unknown>)) {
      if (key !== "carta" && key !== "ticket") return bad(`«${key}» no es una plantilla: use carta o ticket.`);
      if (typeof id !== "string" || !TEMPLATE_ID.test(id)) return bad(`La plantilla de ${key} no es válida.`);
      plantilla[key] = id;
    }
    if (Object.keys(plantilla).length > 0) out.plantilla = plantilla;
  }
  if (top.datos !== undefined) {
    const d = top.datos;
    if (typeof d !== "object" || d === null || Array.isArray(d)) return bad("Los datos de la representación no son válidos.");
    const datos: NonNullable<RepresentationInput["datos"]> = {};
    for (const [key, value] of Object.entries(d as Record<string, unknown>)) {
      if (key === "filas") {
        if (!Array.isArray(value) || value.length > MAX_FILAS) return bad(`Las filas libres admiten hasta ${MAX_FILAS}.`);
        const filas: { etiqueta: string; valor: string }[] = [];
        for (const row of value) {
          const r = row as { etiqueta?: unknown; valor?: unknown } | null;
          if (r === null || typeof r !== "object" || typeof r.etiqueta !== "string" || typeof r.valor !== "string") return bad("Cada fila libre lleva una etiqueta y un valor.");
          if (r.etiqueta.length > FILA_LABEL_MAX || r.valor.length > FILA_VALUE_MAX || hasControl(r.etiqueta) || hasControl(r.valor)) {
            return bad(`Una fila libre admite etiqueta de hasta ${FILA_LABEL_MAX} y valor de hasta ${FILA_VALUE_MAX} caracteres, en una sola línea.`);
          }
          filas.push({ etiqueta: r.etiqueta, valor: r.valor });
        }
        if (filas.length > 0) datos.filas = filas;
        continue;
      }
      const field = fieldOf(key);
      if (field === undefined) return bad(`«${key}» no es un dato de la representación; use las filas libres.`);
      if (typeof value === "number" && field.kind === "int" && Number.isFinite(value)) { datos[key] = value; continue; }
      if (typeof value !== "string" || hasControl(value) || value.length > (field.kind === "text" || field.kind === "sections" ? field.max : 20)) {
        return bad(`«${field.label}» no es válido (hasta ${field.max} caracteres, en una sola línea).`);
      }
      datos[key] = value;
    }
    if (Object.keys(datos).length > 0) out.datos = datos;
  }
  return { ok: true, value: out.plantilla === undefined && out.datos === undefined ? undefined : out };
}
