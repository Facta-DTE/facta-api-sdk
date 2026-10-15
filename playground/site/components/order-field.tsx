import { useId } from "react";
import { money } from "../sections/registro/registry-rows.ts";
import { typeName, typeShort, useOrders, type RepeatOutcome, type UsedOrder } from "../order-session.ts";
import "./order-field.css";

const seconds = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);
const shortCode = (code: string | null) => (code === null ? "—" : `${code.slice(0, 4)}…${code.slice(-4)}`);

/** «Factura de $11.30», or just «Factura» when the total is unknown. */
export const usedLabel = (u: UsedOrder): string => (u.total === null ? typeName(u.type) : `${typeName(u.type)} de ${money(u.total)}`);

/**
 * «Número de orden»: the field, its «nuevo / repetido» pill, «↻ Otro número» and the orders already used in this
 * session as chips that refill it. Surfaces that key a repeat by order AND type (the recipes) pass `type`, and a
 * chip then hands its type back through `onPickType`.
 */
export function OrderField({ scope, label = "Número de orden", value, onChange, make, type, onPickType, valid = true, hint }: {
  scope: string;
  label?: string;
  value: string;
  onChange(value: string): void;
  make(): string;
  type?: string;
  onPickType?(type: string): void;
  valid?: boolean;
  hint?: string;
}) {
  const store = useOrders();
  const id = useId();
  const list = store.list(scope);
  const repeated = value.trim() !== "" && store.find(scope, value, type) !== null;
  return (
    <div className="ord">
      <label className="pg-field" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="ord-row">
        <div className={`ord-box${repeated ? " is-repeat" : ""}${valid ? "" : " is-bad"}`}>
          <input id={id} type="text" className="mono" maxLength={64} value={value} spellCheck={false} autoComplete="off" aria-invalid={!valid || undefined} aria-describedby={`${id}-pill`} onChange={(event) => onChange(event.target.value)} />
          <span id={`${id}-pill`} className={`ord-pill ${repeated ? "ord-pill--repeat" : "ord-pill--new"}`} data-testid="order-pill">{repeated ? "repetido" : "nuevo"}</span>
        </div>
        <button type="button" className="pg-secondary ord-other" onClick={() => onChange(store.fresh(scope, make))}>↻ Otro número</button>
      </div>
      {hint !== undefined && <p className="pg-hint">{hint}</p>}
      {list.length > 0 && (
        <div className="ord-used" role="group" aria-label="Números de orden usados en esta sesión">
          <span>Usados en esta sesión:</span>
          {list.map((u) => (
            <button key={`${u.order}-${u.type}`} type="button" className={`ord-chip${u.order === value.trim() && (type === undefined || u.type === type) ? " is-on" : ""}`} onClick={() => { onChange(u.order); onPickType?.(u.type); }}>
              <span className="mono">{u.order}</span> · {typeShort(u.type)}{u.total === null ? "" : ` ${money(u.total)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The notice that appears the moment the number matches one already used, before anything is sent.
 * `detailed` (the recipe view) names the order, the type and the total, and says nothing new is issued.
 */
export function RepeatBanner({ scope, order, type, detailed }: { scope: string; order: string; type?: string; detailed?: boolean }) {
  const store = useOrders();
  const used = order.trim() === "" ? null : store.find(scope, order, type);
  if (used === null) return null;
  return (
    <div className="ord-banner" role="status" data-testid="repeat-banner">
      <span className="ord-banner-ic" aria-hidden>i</span>
      <div>
        <b>Esta petición simula una doble solicitud para la misma factura,</b> por lo tanto se le devolverá la misma
        {detailed ? <> (<span className="mono">{used.order}</span>, {usedLabel(used)}). No se emite nada nuevo ni se gasta un correlativo.</> : "."}
      </div>
    </div>
  );
}

/** «Se devolvió la misma factura.»: the first request and its repeat, side by side. */
export function RepeatCard({ outcome }: { outcome?: RepeatOutcome | null }) {
  const store = useOrders();
  const repeat = outcome === undefined ? store.lastRepeat() : outcome;
  if (repeat === null) return null;
  const { first, again, order } = repeat;
  const known = first.code !== null;
  const same = known && again.code !== null && again.code === first.code;
  return (
    <section className="ord-result" data-testid="repeat-card" aria-label="Resultado de la repetición">
      {known && !same ? (
        <div className="ord-banner ord-banner--warn" role="status"><span className="ord-banner-ic" aria-hidden>!</span><div><b>Se emitió otra factura.</b> El código de generación no coincide con el de la primera vez.</div></div>
      ) : (
        <div className="ord-banner ord-banner--ok" role="status">
          <span className="ord-banner-ic" aria-hidden>✓</span>
          <div><b>Se devolvió la misma factura.</b>{known ? " El código de generación y el número de control son idénticos a la primera vez." : ` Hacienda ya conocía la orden ${order}; este es el documento original.`}</div>
        </div>
      )}
      {known && (
        <dl className="ord-rows">
          <div><dt>Primera petición</dt><dd className="mono">{shortCode(first.code)}</dd><dd><span className="ord-tag ord-tag--ok">emitida · {seconds(first.ms)}</span></dd></div>
          <div><dt>Repetición</dt><dd className="mono">{shortCode(again.code)}</dd><dd><span className="ord-tag ord-tag--same">{same ? "la misma" : "distinta"} · {seconds(again.ms)}</span></dd></div>
          {again.control !== null && <div><dt>Número de control</dt><dd className="mono">{again.control}</dd></div>}
        </dl>
      )}
      <pre className="mono ord-code">{"await facta.issue(sale, {\n  "}<span className="k">idempotencyKey</span>{": "}<span className="s">"{order}"</span>{"  "}<span className="c">// la orden de su tienda</span>{"\n});"}</pre>
    </section>
  );
}
