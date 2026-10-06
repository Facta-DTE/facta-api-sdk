import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFactaClient, createIssueFlow, initialFlowState, type FlowState, type IssueFlow } from "../../../../browser.ts";
import { createSession } from "../../api.ts";
import { Outcome } from "./outcome.tsx";

// Example 1: a checkout form on the browser client alone. No provider, no hook:
// createIssueFlow is the state machine, subscribe() feeds our own state.
const client = createFactaClient({ endpoint: "/api/facta" });

export function CheckoutForm({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<FlowState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const flow = useRef<IssueFlow | null>(null);
  useEffect(() => () => flow.current?.destroy(), []);

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setProblem(null);
    try {
      // The server builds the fiscal request from this small description.
      const { session } = await createSession({
        tipoDte: "01",
        lines: [{ descripcion: String(data.get("item")), cantidad: Number(data.get("qty")), precioUni: Number(data.get("price")) }],
      });
      flow.current?.destroy();
      flow.current = createIssueFlow({ client, session, run: "auto" });
      flow.current.subscribe(setState);
      setState(initialFlowState());
      await flow.current.start();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "No se pudo preparar la venta.");
    }
  }

  return (
    <form className="hl-form" onSubmit={pay}>
      <label>Producto<input name="item" defaultValue="Café de altura, 1 lb" required maxLength={100} /></label>
      <label>Cantidad<input name="qty" type="number" min={1} defaultValue={2} required /></label>
      <label>Precio<input name="price" type="number" min={0.01} step="0.01" defaultValue={8.5} required /></label>
      <button type="submit" disabled={disabled}>Pagar</button>
      {problem && <p role="alert" className="pg-error">{problem}</p>}
      {state && <Outcome state={state} skin="form" onRetry={() => void flow.current?.retry()} />}
    </form>
  );
}
