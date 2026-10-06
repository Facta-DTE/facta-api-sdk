import { useState } from "react";
import { formatMoney } from "../../../../browser.ts";
import { useFactaIssue } from "../../../../react.ts";
import { createSession } from "../../api.ts";
import { Outcome } from "./outcome.tsx";

// Example 2: a point-of-sale keypad. Our own buttons and display; the SDK only
// contributes the hook that issues and reports each state.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

export function PosKeypad({ disabled }: { disabled: boolean }) {
  const [cents, setCents] = useState(0);
  const [session, setSession] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // `run: "auto"` issues as soon as there is a session: no review step at the counter.
  const issue = useFactaIssue(session ?? "", { enabled: session !== null, run: "auto" });

  const press = (key: string) =>
    setCents((c) => (key === "⌫" ? Math.floor(c / 10) : Math.min(50_000, c * 10 ** key.length + Number(key))));

  async function charge() {
    setProblem(null);
    try {
      const created = await createSession({
        tipoDte: "01",
        lines: [{ descripcion: "Venta de mostrador", cantidad: 1, precioUni: cents / 100, tipoItem: 1 }],
      });
      setSession(created.session);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo preparar la venta.");
    }
  }

  const done = () => { setSession(null); setCents(0); };
  if (session !== null) {
    return (
      <div className="hl-pos">
        <Outcome state={issue.state} skin="pos" onRetry={issue.retry} />
        <button type="button" className="hl-pos-new" onClick={done}>Nueva venta</button>
      </div>
    );
  }
  return (
    <div className="hl-pos">
      <output className="hl-pos-display" aria-label="Total">{formatMoney(cents / 100)}</output>
      <div className="hl-pos-keys">
        {KEYS.map((k) => <button key={k} type="button" onClick={() => press(k)} aria-label={k === "⌫" ? "Borrar" : k}>{k}</button>)}
      </div>
      <button type="button" className="hl-pos-charge" disabled={disabled || cents < 1} onClick={charge}>Cobrar</button>
      {cents < 1 && !disabled && <p className="hl-pos-hint">Escriba el monto para cobrar.</p>}
      {problem && <p role="alert" className="pg-error">{problem}</p>}
    </div>
  );
}
