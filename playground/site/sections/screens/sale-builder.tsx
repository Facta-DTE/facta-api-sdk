import { useMemo, useState } from "react";
import { ApiError, createSession, type CreatedSession, type IssuedDocument, type PlaygroundState, type SaleDescription } from "../../api.ts";

export const TYPE_LABELS: Record<string, string> = {
  "01": "Factura (01)",
  "03": "Comprobante de crédito fiscal (03)",
  "05": "Nota de crédito (05)",
  "06": "Nota de débito (06)",
  "11": "Factura de exportación (11)",
  "14": "Factura de sujeto excluido (14)",
};

const NEEDS_CUSTOMER = new Set(["03", "05", "06", "11", "14"]);
const WITHOUT_VAT = new Set(["03", "05", "06"]);

interface Line {
  key: number;
  productId: string; // "" means a free line
  descripcion: string;
  cantidad: number;
  precioUni: number;
}

let nextKey = 1;

/**
 * The sale description. The browser sends only this small object; the server validates it,
 * builds the fiscal request and answers a session token (`POST /api/session`).
 */
export function SaleBuilder({ state, issued, onPrepared }: {
  state: PlaygroundState;
  issued: IssuedDocument[];
  onPrepared(prepared: CreatedSession & { tipoDte: string }): void;
}) {
  const [tipoDte, setTipoDte] = useState("01");
  const [customerId, setCustomerId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [relatedCode, setRelatedCode] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [{ key: nextKey++, productId: "", descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5 }]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { demo } = state;
  const customers = useMemo(() => demo.customers.filter((c) => c.fits.includes(tipoDte)), [demo.customers, tipoDte]);
  const builtIn = demo.builtInReceivers.includes(tipoDte);
  const isNote = tipoDte === "05" || tipoDte === "06";
  const total = lines.reduce((sum, l) => {
    const price = l.productId === "" ? l.precioUni : demo.products.find((p) => p.id === l.productId)?.precioUni ?? 0;
    return sum + l.cantidad * price;
  }, 0);

  const update = (key: number, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function changeType(next: string) {
    setTipoDte(next);
    setCustomerId("");
    setProblem(null);
  }

  async function prepare() {
    setBusy(true);
    setProblem(null);
    const sale: SaleDescription = {
      tipoDte,
      lines: lines.map((l) => l.productId === ""
        ? { descripcion: l.descripcion, cantidad: l.cantidad, precioUni: l.precioUni }
        : { productId: l.productId, cantidad: l.cantidad }),
      sendEmail,
      ...(customerId !== "" ? { customerId } : {}),
      ...(tipoDte === "01" && customerId === "" && typedName.trim() !== "" ? { receptorNombre: typedName.trim() } : {}),
      ...(isNote && relatedCode !== "" ? { relatedCode } : {}),
    };
    try {
      onPrepared({ ...(await createSession(sale)), tipoDte });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "No se pudo preparar la venta.");
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

        <label className="pg-field">
          <span>Cliente de demostración{NEEDS_CUSTOMER.has(tipoDte) && !builtIn ? "" : " (opcional)"}</span>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">{tipoDte === "01" ? "Consumidor final" : builtIn ? "Receptor de demostración incluido" : "Elija un cliente"}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>

        {tipoDte === "01" && customerId === "" && (
          <label className="pg-field">
            <span>O escriba un nombre (opcional)</span>
            <input type="text" maxLength={80} value={typedName} onChange={(event) => setTypedName(event.target.value)} placeholder="María Prueba" />
          </label>
        )}

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
      {NEEDS_CUSTOMER.has(tipoDte) && customers.length === 0 && !builtIn && (
        <p className="pg-note">Este playground no tiene un cliente de demostración para este tipo de documento.</p>
      )}

      <div className="pg-sale-lines" role="group" aria-label="Líneas de la venta">
        {lines.map((line, index) => (
          <div className="pg-sale-line" key={line.key}>
            <label className="pg-field">
              <span>Línea {index + 1}</span>
              <select
                value={line.productId}
                onChange={(event) => update(line.key, { productId: event.target.value })}
                aria-label={`Producto de la línea ${index + 1}`}
              >
                <option value="">Escribir descripción</option>
                {demo.products.map((p) => <option key={p.id} value={p.id}>{p.label} · ${p.precioUni.toFixed(2)}</option>)}
              </select>
            </label>
            <label className="pg-field">
              <span>Cantidad</span>
              <input type="number" min={1} max={1000} step={1} value={line.cantidad} onChange={(event) => update(line.key, { cantidad: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} />
            </label>
            {line.productId === "" ? (
              <label className="pg-field">
                <span>Precio</span>
                <input type="number" min={0.01} max={1000} step={0.01} value={line.precioUni} onChange={(event) => update(line.key, { precioUni: Number(event.target.value) })} />
              </label>
            ) : <span />}
            <button type="button" className="pg-icon" aria-label={`Quitar la línea ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}>×</button>
            {line.productId === "" && (
              <label className="pg-field" style={{ gridColumn: "1 / -1" }}>
                <span className="pg-sr">Descripción de la línea {index + 1}</span>
                <input type="text" maxLength={100} value={line.descripcion} onChange={(event) => update(line.key, { descripcion: event.target.value })} aria-label={`Descripción de la línea ${index + 1}`} />
              </label>
            )}
          </div>
        ))}
        <button type="button" className="pg-secondary" disabled={lines.length >= 10} onClick={() => setLines((all) => [...all, { key: nextKey++, productId: "", descripcion: "Servicio de prueba", cantidad: 1, precioUni: 5 }])}>
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
        </span>
        <button type="button" className="pg-primary" disabled={busy || state.visitor === null || (state.quota !== null && !state.quota.allowed)} onClick={prepare}>
          {busy ? "Preparando…" : "Preparar la venta"}
        </button>
      </div>
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
