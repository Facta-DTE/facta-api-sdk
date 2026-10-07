import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFactaClient, createIssueFlow, formatMoney, initialFlowState, type FlowState, type IssueFlow } from "../../../../browser.ts";
import { createSession } from "../../api.ts";
import { EMPTY_EMAIL, EmailChoice, emailReady, looksLikeAddress, type EmailChoiceValue } from "../../components/email-choice.tsx";
import { Outcome } from "./outcome.tsx";
import { OrderField, RepeatBanner, RepeatCard } from "../../components/order-field.tsx";
import { newOrderNumber, ORDER_NUMBER } from "../../order-number.ts";
import { SALE_SCOPE } from "../../order-session.ts";

// Example 1: a checkout form on the browser client alone. No provider, no hook:
// createIssueFlow is the state machine, subscribe() feeds our own state.
const client = createFactaClient({ endpoint: "/api/facta" });

export function CheckoutForm({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<FlowState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [qty, setQty] = useState(2);
  const [price, setPrice] = useState(8.5);
  // «Quiero mi factura por correo» needs an address: the visitor types it, any address, and the server limits the sends.
  const [mail, setMail] = useState<EmailChoiceValue>(EMPTY_EMAIL);
  const [order, setOrder] = useState(newOrderNumber);
  const orderValid = ORDER_NUMBER.test(order.trim());
  const flow = useRef<IssueFlow | null>(null);
  useEffect(() => () => flow.current?.destroy(), []);

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setProblem(null);
    if (mail.send && !looksLikeAddress(mail.address)) {
      setProblem("Escriba un correo válido para recibir su factura.");
      return;
    }
    try {
      // The server builds the fiscal request from this small description.
      const { session } = await createSession({
        tipoDte: "01",
        orderNumber: order.trim(),
        lines: [{ descripcion: String(data.get("item")), cantidad: qty, precioUni: price, tipoItem: 1 }],
        ...(mail.send ? { sendEmail: true, emailTo: mail.address.trim() } : {}),
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
      <h3>Café Las Brumas</h3>
      <label>Producto<input name="item" defaultValue="Café de altura, 1 lb" required maxLength={100} /></label>
      <div className="hl-form-pair">
        <label>Cantidad<input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} required /></label>
        <label>Precio<input type="number" min={0.01} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} required /></label>
      </div>
      <p className="hl-form-total"><span>Total</span><b>{formatMoney(qty * price)}</b></p>
      <RepeatBanner scope={SALE_SCOPE} order={order} />
      <OrderField scope={SALE_SCOPE} value={order} onChange={setOrder} make={newOrderNumber} valid={orderValid} label="Número de orden" />
      <EmailChoice className="hl-form-check" value={mail} onChange={setMail} label="Quiero mi factura por correo" />
      <button type="submit" disabled={disabled || !emailReady(mail) || !orderValid}>Pagar y facturar</button>
      {problem && <p role="alert" className="pg-error">{problem}</p>}
      <RepeatCard />
      {state && <Outcome state={state} skin="form" onRetry={() => void flow.current?.retry()} />}
    </form>
  );
}
