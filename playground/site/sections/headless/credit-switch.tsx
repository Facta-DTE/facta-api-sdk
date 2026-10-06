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
        ...(credit ? { customerId: customerId || taxpayers[0]!.id } : {}),
        lines: [{ descripcion: "Servicio de consultoría", cantidad: 1, precioUni: 25 }],
      });
      setSession(created.session);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo preparar la venta.");
    }
  }

  return (
    <div className="hl-switch">
      <label className="hl-toggle">
        <input type="checkbox" role="switch" checked={credit} disabled={!canCredit || session !== null} onChange={(e) => setCredit(e.target.checked)} />
        <span>¿Necesita crédito fiscal?</span>
      </label>
      {!canCredit && <p className="pg-note">Este ambiente no tiene un cliente contribuyente de demostración; solo se emite Factura.</p>}
      {credit && (
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Cliente contribuyente" disabled={session !== null}>
          {taxpayers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
      <p className="hl-switch-kind">Se emitirá: <b>{credit ? "Comprobante de crédito fiscal (03)" : "Factura (01)"}</b></p>
      {session === null
        ? <button type="button" disabled={disabled} onClick={start}>Emitir</button>
        : <><Outcome state={issue.state} skin="switch" onRetry={issue.retry} /><button type="button" onClick={() => setSession(null)}>Otra venta</button></>}
      {problem && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
