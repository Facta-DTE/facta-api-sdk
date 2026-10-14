import type { TemplateNotAppliedWarning } from "../../../src/types.ts";

const WHY: Record<TemplateNotAppliedWarning["motivo"], string> = {
  plan: "su plan no incluye esa plantilla (requiere plan Lite o Pro)",
  no_existe: "esa plantilla no existe o no es de la empresa",
  incompatible: "esa plantilla no es compatible con este tipo de documento",
};

const WHERE: Record<string, string> = {
  "representacion.plantilla.carta": "la hoja carta",
  "representacion.plantilla.ticket": "el ticket",
};

/**
 * What the API did with the template choice of the sale: each `plantilla_no_aplicada` warning (the document was issued
 * with the company's own template), or, when the sale asked for templates and nothing was refused, a line saying so.
 */
export function TemplateWarnings({ warnings, requested }: { warnings: readonly TemplateNotAppliedWarning[] | undefined; requested?: { carta?: string; ticket?: string } | undefined }) {
  const list = warnings ?? [];
  const asked = requested !== undefined && (requested.carta !== undefined || requested.ticket !== undefined);
  if (list.length === 0 && !asked) return null;
  return (
    <div className="pg-tplwarn" data-testid="template-warnings" role="status">
      {list.map((w) => (
        <p key={w.campo} className="pg-tplwarn-item" data-testid="template-warning">
          <b>No se usó la plantilla de {WHERE[w.campo] ?? w.campo}:</b> {WHY[w.motivo]}. El documento se emitió con la plantilla de la empresa.
          {w.mensaje !== "" && <small className="pg-hint"> El API dijo: «{w.mensaje}»</small>}
        </p>
      ))}
      {list.length === 0 && asked && (
        <p className="pg-hint" data-testid="template-applied">
          Pidió {requested.carta !== undefined ? `la hoja carta «${requested.carta}»` : ""}{requested.carta !== undefined && requested.ticket !== undefined ? " y " : ""}{requested.ticket !== undefined ? `el ticket «${requested.ticket}»` : ""}; el API no avisó de ningún problema, así que las usó.
        </p>
      )}
    </div>
  );
}
