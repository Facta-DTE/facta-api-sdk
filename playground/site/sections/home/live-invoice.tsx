import { useState } from "react";
import { FactaInvoiceDialog } from "../../../../react.ts";
import { ApiError, createSession } from "../../api.ts";
import { TurnstileBox } from "../../components/turnstile.tsx";
import { EMPTY_EMAIL, EmailChoice, emailReady, type EmailChoiceValue } from "../../components/email-choice.tsx";
import { useTurnstileReady } from "../../turnstile.ts";

// Real component of the playground, shown on the page as-is.
//
// 1. The browser describes the sale (small, validated on the server).
// 2. The server builds the fiscal request and answers a session token.
// 3. FactaInvoiceDialog gets the token and talks to /api/facta; the browser
//    never holds a credential and never authors the document.
export function LiveInvoice({ defaultAddress, signedIn, disabled, onIssued }: { defaultAddress: string; signedIn: boolean; disabled: boolean; onIssued: () => void }) {
  const [session, setSession] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mail, setMail] = useState<EmailChoiceValue>({ ...EMPTY_EMAIL, address: defaultAddress });
  const ready = useTurnstileReady();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setProblem(null);
    try {
      const created = await createSession({
        tipoDte: "01",
        lines: [{ descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5, tipoItem: 1 }],
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
      <button type="button" className="pg-primary home-live-cta" disabled={disabled || busy || !ready || !emailReady(mail)} onClick={start}>
        {busy ? "Preparando…" : "Emitir una factura ahora"}
      </button>
      {signedIn && <EmailChoice value={mail} onChange={setMail} />}
      <TurnstileBox />
      {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
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
