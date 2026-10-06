import { formatMoney, truncateMiddle, type FlowState } from "../../../../browser.ts";

// Shared by the three examples: draws every state of the issuance flow with plain
// markup. Each example gives it its own look through the `skin` class (headless.css).
// Nothing here comes from the SDK's React components.
const WAITING: Record<string, string> = {
  loading: "Preparando la venta…",
  review: "Lista para emitir.",
  issuing: "Emitiendo: firmando y enviando a Hacienda…",
  verifying: "Sin respuesta clara. Verificando sin duplicar el documento…",
};

export function Outcome({ state, skin, onRetry }: { state: FlowState; skin: string; onRetry?: () => void }) {
  const { step, result, error } = state;
  const tone = step === "sealed" ? "ok" : step === "contingency" ? "warn" : error ? "bad" : "busy";
  return (
    <div className={`hl-outcome hl-skin-${skin} hl-${tone}`} data-step={step} role="status" aria-live="polite">
      <strong>
        {step === "sealed" && "Sellada por Hacienda"}
        {step === "contingency" && "En contingencia"}
        {step === "rejected" && "Hacienda la rechazó"}
        {step === "failed" && "No se pudo emitir"}
        {step === "expired" && "La sesión venció"}
        {WAITING[step]}
      </strong>
      {result && (
        <dl>
          <dt>Número de control</dt><dd>{truncateMiddle(result.numeroControl, 12, 8)}</dd>
          {result.selloRecibido && <><dt>Sello</dt><dd>{truncateMiddle(result.selloRecibido)}</dd></>}
          {(result.totales?.totalPagar ?? result.totales?.montoTotalOperacion) !== undefined && <><dt>Total</dt><dd>{formatMoney((result.totales?.totalPagar ?? result.totales?.montoTotalOperacion)!)}</dd></>}
        </dl>
      )}
      {step === "contingency" && <p>El documento ya tiene número; se enviará cuando Hacienda vuelva a responder.</p>}
      {error && <p>{step === "expired" ? "Prepare la venta de nuevo para obtener otra sesión." : error.explanation}</p>}
      {error && error.observaciones.length > 0 && <ul>{error.observaciones.map((o) => <li key={o}>{o}</li>)}</ul>}
      {error?.spent && <p>Se gastó el número {error.spent.numeroControl ?? "de control"}; no se reutiliza.</p>}
      {error?.canRetry && onRetry && <button type="button" onClick={onRetry}>Intentar de nuevo</button>}
    </div>
  );
}
