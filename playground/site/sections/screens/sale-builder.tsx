import { useMemo, useState } from "react";
import { FactaProductPicker, type ProductOption } from "../../../../react.ts";
import { ApiError, createSession, type CreatedSession, type IssuedDocument, type PlaygroundState, type SaleDescription, type SaleSource } from "../../api.ts";
import { Segmented } from "../../components/ui.tsx";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { EMPTY_EMAIL, EmailChoice, emailReady, type EmailChoiceValue } from "../../components/email-choice.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
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

const SOURCE_LABELS: [SaleSource, string][] = [["catalog", "Catálogo"], ["demo", "Demostración"], ["custom", "Personalizado"]];

/** The six chips: code, name and what the type needs from the sale (shown as a short inline reason). */
export const TYPE_CHIPS: { value: string; name: string; needs: string }[] = [
  { value: "01", name: "Factura", needs: "Consumidor final: el receptor es opcional." },
  { value: "03", name: "Crédito fiscal", needs: "Necesita un receptor contribuyente: NIT o DUI y NRC." },
  { value: "05", name: "Nota de crédito", needs: "Corrige un documento que usted emitió aquí." },
  { value: "06", name: "Nota de débito", needs: "Corrige un documento que usted emitió aquí." },
  { value: "11", name: "Exportación", needs: "Necesita un receptor extranjero con su país." },
  { value: "14", name: "Sujeto excluido", needs: "Necesita un receptor con documento y dirección." },
];

/** What blocks a type right now, in words. `null` when nothing does. */
export function typeBlocker(type: string, issued: IssuedDocument[]): string | null {
  if ((type === "05" || type === "06") && issued.length === 0) return "Primero emita un documento aquí: las notas corrigen uno suyo.";
  return null;
}

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
  const [mail, setMail] = useState<EmailChoiceValue>({ ...EMPTY_EMAIL, address: state.visitor?.email ?? "" });
  const ready = useTurnstileReady();
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
      ...(mail.send ? { sendEmail: true, emailTo: mail.address.trim() } : {}),
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

  const chips = TYPE_CHIPS.filter((chip) => state.supportedTypes.includes(chip.value));
  const blocker = typeBlocker(tipoDte, issued);
  const need = TYPE_CHIPS.find((chip) => chip.value === tipoDte)?.needs ?? "";

  return (
    <div className="pg-sale">
      <div className="pg-sale-head">
        <h2>La venta</h2>
      </div>
      <div role="radiogroup" aria-label="Tipo de documento" className="pg-type-chips">
        {chips.map((chip) => {
          const reason = typeBlocker(chip.value, issued);
          return (
            <button
              key={chip.value}
              type="button"
              role="radio"
              aria-checked={chip.value === tipoDte}
              data-type={chip.value}
              className={`pg-type-chip${reason !== null ? " pg-type-chip--needs" : ""}`}
              onClick={() => changeType(chip.value)}
            >
              <span className="mono">{chip.value}</span> {chip.name}
              {reason !== null && <small>Requiere un documento suyo</small>}
            </button>
          );
        })}
      </div>
      <p className="pg-hint pg-type-need" role="status">{blocker ?? need}</p>
      {isNote && (
        <div className="pg-form-grid">
          <label className="pg-field">
            <span>Documento que corrige</span>
            <select value={relatedCode} onChange={(event) => setRelatedCode(event.target.value)}>
              <option value="">Elija un documento que usted emitió</option>
              {issued.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.numeroControl}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="pg-sale-cols">
        <ReceptorSection state={state} tipoDte={tipoDte} choice={receptor} onChange={setReceptor} error={field} />

        <div className="pg-sale-lines" role="group" aria-label="Líneas de la venta">
          <span className="pg-lbl">Líneas</span>
          <div className="pg-sale-list">
            {lines.map((line, index) => (
              <div className="pg-sale-line" key={line.key}>
                <div className="pg-sale-line-row">
                  <select
                    className={`pg-pill-select pg-pill-select--${line.source}`}
                    value={line.source}
                    aria-label={`Origen de la línea ${index + 1}`}
                    onChange={(event) => update(line.key, { source: event.target.value as SaleSource, productId: "", picked: null })}
                  >
                    {SOURCE_LABELS.map(([value, label]) => <option key={value} value={value} disabled={value === "catalog" && !state.catalog}>{label}{value === "catalog" && !state.catalog ? " (no disponible)" : ""}</option>)}
                  </select>
                  <span className="pg-sale-line-name">
                    {line.source === "catalog" && line.picked !== null && <><b>{line.picked.description ?? line.picked.id}</b>{line.picked.price === null && <small className="pg-hint"> · sin precio</small>}</>}
                    {line.source === "catalog" && line.picked === null && <span className="pg-hint">Elija un producto</span>}
                    {line.source === "demo" && (
                      <select className="pg-inline-select" value={line.productId} onChange={(event) => update(line.key, { productId: event.target.value })} aria-label={`Producto de la línea ${index + 1}`}>
                        <option value="">Elija un producto</option>
                        {demo.products.map((p) => <option key={p.id} value={p.id}>{p.label} · ${p.precioUni.toFixed(2)}</option>)}
                      </select>
                    )}
                    {line.source === "custom" && (
                      <input type="text" className="pg-inline-input" maxLength={100} placeholder="Descripción" value={line.descripcion} onChange={(event) => update(line.key, { descripcion: event.target.value })} aria-label={`Descripción de la línea ${index + 1}`} />
                    )}
                  </span>
                  <label className="pg-qty">
                    <span className="pg-sr">Cantidad de la línea {index + 1}</span>
                    <input type="number" min={1} max={1000} step={1} value={line.cantidad} onChange={(event) => update(line.key, { cantidad: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} />
                    <span aria-hidden>×</span>
                  </label>
                  {line.source === "custom" ? (
                    <label className="pg-price">
                      <span className="pg-sr">Precio unitario de la línea {index + 1}</span>
                      <span aria-hidden>$</span>
                      <input type="number" min={0.01} max={1000} step={0.01} value={line.precioUni} onChange={(event) => update(line.key, { precioUni: Number(event.target.value) })} />
                    </label>
                  ) : (
                    <span className="pg-price pg-price--fixed">${(line.cantidad * linePrice(line)).toFixed(2)}</span>
                  )}
                  <button type="button" className="pg-icon" aria-label={`Quitar la línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}>×</button>
                </div>
                {line.source === "catalog" && (
                  <div className="pg-sale-line-extra">
                    {line.picked === null ? (
                      <FactaProductPicker label={`Producto de la línea ${index + 1}`} onSelect={(product) => update(line.key, { picked: product, productId: product.id })} />
                    ) : (
                      <button type="button" className="pg-link-button" onClick={() => update(line.key, { picked: null, productId: "" })}>Cambiar producto</button>
                    )}
                  </div>
                )}
                {line.source === "custom" && (
                  <div className="pg-sale-line-extra pg-sale-line-extra--custom">
                    <Segmented
                      label={`Tipo de ítem de la línea ${index + 1}`}
                      value={String(line.tipoItem) as "0" | "1" | "2"}
                      onChange={(value) => update(line.key, { tipoItem: Number(value) as 1 | 2 })}
                      choices={[{ value: "1", label: "Bien" }, { value: "2", label: "Servicio" }]}
                    />
                    <label className="pg-field">
                      <span className="pg-sr">Código del producto de la línea {index + 1} (opcional)</span>
                      <input type="text" maxLength={25} value={line.codigo} onChange={(event) => update(line.key, { codigo: event.target.value })} placeholder="Código (opcional)" />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pg-sale-add">
            <button type="button" className="pg-link-button" disabled={lines.length >= 10} onClick={() => setLines((all) => [...all, newLine({ descripcion: "Servicio de prueba" })])}>+ Agregar línea</button>
            <b>Total ${total.toFixed(2)}</b>
          </div>
        </div>
      </div>

      <div className="pg-sale-foot">
        {state.visitor !== null && <EmailChoice value={mail} onChange={setMail} />}
        <p className="pg-hint">
          Subtotal {WITHOUT_VAT.has(tipoDte) ? "(precios sin IVA; Hacienda calcula el IVA al sellar)" : "(Hacienda calcula los totales al sellar)"}: <b>${total.toFixed(2)}</b>
          {unknownPrice && <small> Algún producto del catálogo no trae precio; el API lo resuelve al emitir.</small>}
        </p>
        <TurnstileBox />
        <button type="button" className="pg-primary" disabled={busy || !ready || !emailReady(mail) || (isNote && relatedCode === "") || missing.length > 0 || state.visitor === null || (state.quota !== null && !state.quota.allowed)} onClick={prepare}>
          {busy ? "Preparando…" : "Preparar la venta"}
        </button>
      </div>
      {missing.length > 0 && <p className="pg-hint">Antes de preparar: {missing.join("; ")}.</p>}
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
