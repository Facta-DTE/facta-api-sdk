import { useState, type ReactNode } from "react";
import { FactaInvoiceDialog } from "../../../../react.ts";
import { ApiError, createSession } from "../../api.ts";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { EMPTY_EMAIL, EmailChoice, emailReady, type EmailChoiceValue } from "../../components/email-choice.tsx";
import { useTurnstileReady } from "../../turnstile.ts";
import { Busy } from "../../components/busy.tsx";
import { OrderLine, useOrderNumber } from "../../components/order-line.tsx";
import { IssueInsight, TimingsToggle } from "../../components/timings.tsx";

// Real component of the playground, shown on the page as-is.
//
// 1. The browser describes the sale (small, validated on the server).
// 2. The server builds the fiscal request and answers a session token.
// 3. FactaInvoiceDialog gets the token and talks to /api/facta; the browser
//    never holds a credential and never authors the document.
export function LiveInvoice({ defaultAddress, signedIn, disabled, onIssued, secondary }: { defaultAddress: string; signedIn: boolean; disabled: boolean; onIssued: () => void; /** The second call to action, kept on the same row as the primary one. */ secondary?: ReactNode }) {
  const [session, setSession] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mail, setMail] = useState<EmailChoiceValue>({ ...EMPTY_EMAIL, address: defaultAddress });
  const ready = useTurnstileReady();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { orderNumber, renew } = useOrderNumber();

  async function start() {
    setBusy(true);
    setProblem(null);
    try {
      const created = await createSession({
        tipoDte: "01",
        lines: [{ descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5, tipoItem: 1 }],
        // The order number is the idempotency key: «Emitir» twice on the same order is one invoice.
        orderNumber,
        ...(mail.send ? { sendEmail: true, emailTo: mail.address.trim() } : {}),
      });
      setSession(created.session);
      setOpen(true);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "No se pudo preparar la factura.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home-live">
      {/* Row 1: both calls to action. Row 2: the optional e-mail, right under its checkbox. Row 3: the verification. */}
      <div className="home-live-actions">
        <button type="button" className="pg-primary home-live-cta" disabled={disabled || busy || !ready || !emailReady(mail)} onClick={start}>
          {busy ? <Busy>Preparando…</Busy> : "Emitir una factura ahora"}
        </button>
        {secondary}
      </div>
      {signedIn && <OrderLine orderNumber={orderNumber} onRenew={renew} />}
      {signedIn && <EmailChoice value={mail} onChange={setMail} />}
      <TimingsToggle />
      <TurnstileBox className="home-live-turnstile" />
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
      <IssueInsight />
      {session !== null && (
        <FactaInvoiceDialog
          session={session}
          run="auto"
          open={open}
          onOpenChange={setOpen}
          onIssued={onIssued}
        />
      )}
    </div>
  );
}
