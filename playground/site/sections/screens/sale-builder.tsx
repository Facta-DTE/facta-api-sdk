import { useMemo, useState } from "react";
import { FactaProductPicker, type ProductOption } from "../../../../react.ts";
import { ApiError, createSession, type CreatedSession, type IssuedDocument, type PlaygroundState, type SaleDescription, type SaleSource } from "../../api.ts";
import { EMPTY_CHOICE, ReceptorSection, receptorForSale, type ReceptorChoice } from "./sale-receptor.tsx";

export const TYPE_LABELS: Record<string, string> = {
  "01": "Factura (01)",
  "03": "Comprobante de crédito fiscal (03)",
  "05": "Nota de crédito (05)",
  "06": "Nota de débito (06)",
  "11": "Factura de exportación (11)",
  "14": "Factura de sujeto excluido (14)",
};

const WITHOUT_VAT = new Set(["03", "05", "06"]);

interface Line {
  key: number;
  source: SaleSource;
  /** Demo product id or catalog id, by source. */
  productId: string;
  /** What the catalog picker returned: label and price for the preview only. */
  picked: ProductOption | null;
  descripcion: string;
  cantidad: number;
  precioUni: number;
  /** 0 = not chosen yet. The visitor must pick bien or servicio. */
  tipoItem: 0 | 1 | 2;
  codigo: string;
}

let nextKey = 1;
const newLine = (patch: Partial<Line> = {}): Line => ({ key: nextKey++, source: "custom", productId: "", picked: null, descripcion: "", cantidad: 1, precioUni: 5, tipoItem: 0, codigo: "", ...patch });

const SOURCE_LABELS: [SaleSource, string][] = [["catalog", "Catálogo de la llave"], ["demo", "Demostración"], ["custom", "Personalizado"]];

/**
 * The sale description. The browser sends only this small object; the server validates it,
 * confirms any catalog id, builds the fiscal request and answers a session token
 * (`POST /api/session`). Receiver and lines each come from the key's catalog, the demo data
 * or what the visitor types.
 */
export function SaleBuilder({ state, issued, onPrepared }: {
  state: PlaygroundState;
  issued: IssuedDocument[];
  onPrepared(prepared: CreatedSession & { tipoDte: string }): void;
}) {
  const [tipoDte, setTipoDte] = useState("01");
  const [receptor, setReceptor] = useState<ReceptorChoice>(EMPTY_CHOICE);
  const [relatedCode, setRelatedCode] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [newLine({ descripcion: "Café de altura, bolsa de 1 lb", precioUni: 8.5 })]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>(undefined);

  const { demo } = state;
  const isNote = tipoDte === "05" || tipoDte === "06";
  const linePrice = (l: Line) => l.source === "custom" ? l.precioUni : l.source === "demo" ? demo.products.find((p) => p.id === l.productId)?.precioUni ?? 0 : l.picked?.price ?? 0;
  const total = lines.reduce((sum, l) => sum + l.cantidad * linePrice(l), 0);
  const unknownPrice = lines.some((l) => l.source === "catalog" && l.picked !== null && l.picked.price === null);

  // What still stands between the visitor and «Preparar la venta».
  const missing = useMemo(() => {
    const list: string[] = [];
    if (receptor.source === "catalog" && receptor.catalog === null && state.catalog && (state.catalogReceiverTypes ?? ["01", "03", "05", "06"]).includes(tipoDte)) list.push("elija el cliente del catálogo");
    lines.forEach((l, i) => {
      if (l.source === "catalog" && l.picked === null) list.push(`elija el producto de la línea ${i + 1}`);
      if (l.source === "demo" && l.productId === "") list.push(`elija el producto de la línea ${i + 1}`);
      if (l.source === "custom" && l.tipoItem === 0) list.push(`indique si la línea ${i + 1} es un bien o un servicio`);
      if (l.source === "custom" && l.descripcion.trim() === "") list.push(`escriba la descripción de la línea ${i + 1}`);
    });
    return list;
  }, [lines, receptor, state.catalog, state.catalogReceiverTypes, tipoDte]);

  const update = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function changeType(next: string) {
    setTipoDte(next);
    setReceptor((current) => ({ ...current, demoId: "", ...(current.source === "catalog" && !(state.catalogReceiverTypes ?? ["01", "03", "05", "06"]).includes(next) ? { source: "demo" as const } : {}) }));
    setProblem(null);
    setField(undefined);
  }

  async function prepare() {
    setBusy(true);
    setProblem(null);
    setField(undefined);
    const sale: SaleDescription = {
      tipoDte,
      lines: lines.map((l) => {
        if (l.source === "catalog" || l.source === "demo") return { source: l.source, productId: l.source === "catalog" ? l.picked!.id : l.productId, cantidad: l.cantidad };
        return {
          source: "custom" as const,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precioUni: l.precioUni,
          ...(l.tipoItem === 0 ? {} : { tipoItem: l.tipoItem }),
          ...(l.codigo.trim() === "" ? {} : { codigo: l.codigo.trim() }),
        };
      }),
      sendEmail,
      ...(receptorForSale(tipoDte, receptor) === undefined ? {} : { receptor: receptorForSale(tipoDte, receptor)! }),
      ...(isNote && relatedCode !== "" ? { relatedCode } : {}),
    };
    try {
      onPrepared({ ...(await createSession(sale)), tipoDte });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "No se pudo preparar la venta.");
      if (error instanceof ApiError) setField(error.field);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pg-sale">
      <div className="pg-form-grid">
        <label className="pg-field">
          <span>Tipo de documento</span>
          <select value={tipoDte} onChange={(event) => changeType(event.target.value)}>
            {state.supportedTypes.map((type) => <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>)}
          </select>
        </label>
        {isNote && (
          <label className="pg-field">
            <span>Documento que corrige</span>
            <select value={relatedCode} onChange={(event) => setRelatedCode(event.target.value)}>
              <option value="">Elija un documento que usted emitió</option>
              {issued.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.numeroControl}</option>)}
            </select>
          </label>
        )}
      </div>

      <ReceptorSection state={state} tipoDte={tipoDte} choice={receptor} onChange={setReceptor} error={field} />

      <div className="pg-sale-lines" role="group" aria-label="Líneas de la venta">
        {lines.map((line, index) => (
          <div className="pg-sale-line" key={line.key}>
            <div className="pg-sale-line-head">
              <label className="pg-field">
                <span>Línea {index + 1} · origen</span>
                <select
                  value={line.source}
                  aria-label={`Origen de la línea ${index + 1}`}
                  onChange={(event) => update(line.key, { source: event.target.value as SaleSource, productId: "", picked: null })}
                >
                  {SOURCE_LABELS.map(([value, label]) => <option key={value} value={value} disabled={value === "catalog" && !state.catalog}>{label}{value === "catalog" && !state.catalog ? " (no disponible)" : ""}</option>)}
                </select>
              </label>
              <button type="button" className="pg-icon" aria-label={`Quitar la línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}>×</button>
            </div>

            <div className="pg-sale-line-body">
              {line.source === "catalog" && (
                <div className="pg-wide">
                  {line.picked === null ? (
                    <FactaProductPicker label={`Producto de la línea ${index + 1}`} onSelect={(product) => update(line.key, { picked: product, productId: product.id })} />
                  ) : (
                    <div className="pg-picked">
                      <span><b>{line.picked.description ?? line.picked.id}</b>{line.picked.price !== null ? ` · $${line.picked.price.toFixed(2)}` : " · sin precio"}</span>
                      <button type="button" onClick={() => update(line.key, { picked: null, productId: "" })}>Cambiar</button>
                    </div>
                  )}
                </div>
              )}
              {line.source === "demo" && (
                <label className="pg-field pg-wide">
                  <span>Producto de demostración</span>
                  <select value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value })} aria-label={`Producto de la línea ${index + 1}`}>
                    <option value="">Elija un producto</option>
                    {demo.products.map((p) => <option key={p.id} value={p.id}>{p.label} · ${p.precioUni.toFixed(2)}</option>)}
                  </select>
                </label>
              )}

              <label className="pg-field">
                <span>Cantidad</span>
                <input type="number" min={1} max={1000} step={1} value={line.cantidad} onChange={(event) => update(line.key, { cantidad: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} />
              </label>

              {line.source === "custom" && (
                <>
                  <label className="pg-field">
                    <span>Descripción</span>
                    <input type="text" maxLength={100} value={line.descripcion} onChange={(event) => update(line.key, { descripcion: event.target.value })} aria-label={`Descripción de la línea ${index + 1}`} />
                  </label>
                  <label className="pg-field">
                    <span>Precio unitario</span>
                    <input type="number" min={0.01} max={1000} step={0.01} value={line.precioUni} onChange={(event) => update(line.key, { precioUni: Number(event.target.value) })} />
                  </label>
                  <fieldset className="pg-source pg-wide">
                    <legend>Tipo de ítem</legend>
                    <div className="pg-seg pg-seg--compact">
                      {([[1, "Bien"], [2, "Servicio"]] as const).map(([value, label]) => (
                        <label key={value}>
                          <input type="radio" name={`item-${line.key}`} checked={line.tipoItem === value} onChange={() => update(line.key, { tipoItem: value })} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="pg-field pg-wide">
                    <span>Código del producto (opcional)</span>
                    <input type="text" maxLength={25} value={line.codigo} onChange={(event) => update(line.key, { codigo: event.target.value })} placeholder="SKU-001" />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
        <button type="button" className="pg-secondary" disabled={lines.length >= 10} onClick={() => setLines((all) => [...all, newLine({ descripcion: "Servicio de prueba" })])}>
          Agregar línea
        </button>
      </div>

      {state.visitor !== null && (
        <label className="pg-check">
          <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} />
          Enviarme el documento por correo a {state.visitor.email}
        </label>
      )}

      <div className="pg-sale-total">
        <span>
          Subtotal {WITHOUT_VAT.has(tipoDte) ? "(precios sin IVA; Hacienda calcula el IVA al sellar)" : "(Hacienda calcula los totales al sellar)"}: <b>${total.toFixed(2)}</b>
          {unknownPrice && <small className="pg-hint"> Algún producto del catálogo no trae precio; el API lo resuelve al emitir.</small>}
        </span>
        <button type="button" className="pg-primary" disabled={busy || missing.length > 0 || state.visitor === null || (state.quota !== null && !state.quota.allowed)} onClick={prepare}>
          {busy ? "Preparando…" : "Preparar la venta"}
        </button>
      </div>
      {missing.length > 0 && <p className="pg-hint">Antes de preparar: {missing.join("; ")}.</p>}
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
