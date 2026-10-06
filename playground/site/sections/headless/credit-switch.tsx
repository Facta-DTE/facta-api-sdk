import { useState } from "react";
import { useFactaIssue } from "../../../../react.ts";
import { createSession } from "../../api.ts";
import { usePlayground } from "../../state.tsx";
import { Outcome } from "./outcome.tsx";

// Example 3: «¿Necesita crédito fiscal?». The switch only chooses what the SERVER
// builds: off is a Factura (01), on is a Comprobante de crédito fiscal (03) for a
// customer with NRC. The browser never writes the fiscal request.
export function CreditSwitch({ disabled }: { disabled: boolean }) {
  const { view } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const taxpayers = state?.demo.customers.filter((c) => c.contributor) ?? [];
  const canCredit = state?.supportedTypes.includes("03") === true && taxpayers.length > 0;
  const [credit, setCredit] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const issue = useFactaIssue(session ?? "", { enabled: session !== null, run: "auto" });

  async function start() {
    setProblem(null);
    try {
      const created = await createSession({
        tipoDte: credit ? "03" : "01",
        ...(credit ? { receptor: { source: "demo" as const, customerId: customerId || taxpayers[0]!.id } } : {}),
        lines: [{ descripcion: "Servicio de consultoría", cantidad: 1, precioUni: 25, tipoItem: 2 }],
      });
      setSession(created.session);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo preparar la venta.");
    }
  }

  return (
    <div className="hl-switch">
      <h3>¿Necesita crédito fiscal?</h3>
      <div className="hl-toggle" role="radiogroup" aria-label="¿Necesita crédito fiscal?">
        {([[false, "No, factura"], [true, "Sí, CCF"]] as const).map(([value, label]) => (
          <button key={label} type="button" role="radio" aria-checked={credit === value} disabled={(value && !canCredit) || session !== null} onClick={() => setCredit(value)}>{label}</button>
        ))}
      </div>
      {!canCredit && <p className="hl-switch-note">Este ambiente no tiene un cliente contribuyente de demostración; solo se emite Factura.</p>}
      {credit && (
        <label className="hl-switch-field">Cliente contribuyente
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={session !== null}>
            {taxpayers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <p className="hl-switch-kind">Se emitirá: <b>{credit ? "Comprobante de crédito fiscal (03)" : "Factura (01)"}</b></p>
      {session === null
        ? <button type="button" className="hl-switch-go" disabled={disabled} onClick={start}>{credit ? "Emitir crédito fiscal" : "Emitir factura"}</button>
        : <><Outcome state={issue.state} skin="switch" onRetry={issue.retry} /><button type="button" className="hl-switch-again" onClick={() => setSession(null)}>Otra venta</button></>}
      {problem && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
