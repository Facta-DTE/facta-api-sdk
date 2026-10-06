import { useState } from "react";
import { FactaInvoiceDialog, FactaReceipt, type DeliveryView, type IssueResult } from "../../../../../react.ts";
import { ApiError, createSession, resendEmail, type PlaygroundState, type ResendOutcome } from "../../../api.ts";
import { EMPTY_EMAIL, EmailChoice, emailReady, type EmailChoiceValue } from "../../../components/email-choice.tsx";
import { TurnstileBox } from "../../../components/turnstile.tsx";
import { useTurnstileReady } from "../../../turnstile.ts";

// Delivery by e-mail and WhatsApp. Your server marks the channels when it creates the session
// (here `POST /api/session` -> `deliver: { email }`, see server/delivery.ts); the window only follows
// the state through `onDelivery` and never waits for it to close. WhatsApp is never marked here.

/** A sealed document to hang the WhatsApp demonstration on (no network call). */
const SAMPLE: IssueResult = {
  estado: "sellado",
  codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34",
  numeroControl: "DTE-01-M001P001-000000000000042",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-06",
  horEmi: "10:42:00",
  selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD",
  totales: { totalPagar: 8.5 },
};

const WHATSAPP_DEMO: DeliveryView = { canales: { whatsapp: { estado: "sin_credito", motivo: "wallet_empty" } }, settled: true };

export function DeliveryExample({ state, onIssued }: { state: PlaygroundState; onIssued(result: IssueResult): void }) {
  const ready = useTurnstileReady();
  const [mail, setMail] = useState<EmailChoiceValue>({ send: true, address: state.visitor?.email ?? "" });
  const [session, setSession] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [last, setLast] = useState<IssueResult | null>(null);
  const [delivery, setDelivery] = useState<DeliveryView | null>(null);
  const [demo, setDemo] = useState(false);
  const [resent, setResent] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const signedIn = state.visitor !== null;

  async function start() {
    setBusy(true);
    setProblem(null);
    setResent(null);
    setDelivery(null);
    try {
      const created = await createSession({
        tipoDte: "01",
        lines: [{ descripcion: "Café de altura, bolsa de 1 lb", cantidad: 1, precioUni: 8.5, tipoItem: 1 }],
        sendEmail: true,
        emailTo: mail.address.trim(),
      });
      setSession(created.session);
      setOpen(true);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "No se pudo preparar la factura.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (last === null) return;
    setBusy(true);
    setResent(null);
    try {
      const out: ResendOutcome = await resendEmail(last.codigoGeneracion);
      setResent({ tone: "ok", text: out.estado === "enviado" ? `Correo enviado a ${out.destino}.` : `Estado del correo: ${out.estado}.` });
    } catch (error) {
      setResent({ tone: "bad", text: error instanceof ApiError ? error.message : "No se pudo reenviar el correo." });
    } finally {
      setBusy(false);
    }
  }

  const live: IssueResult | null = last === null ? null : { ...last, ...(delivery === null ? {} : { delivery }) };
  const mailLeft = state.mail ?? null;

  return (
    <div className="dl">
      <section className="dl-card" aria-labelledby="dl-channels">
        <h2 id="dl-channels">Canales de esta venta</h2>

        <div className="dl-channel dl-channel--on">
          <EmailChoice value={mail} onChange={setMail} disabled={!signedIn} />
          <p className="pg-hint">Puede ser cualquier dirección. Facta DTE verifica que no sea un robot y limita los envíos para que nadie lo use contra un tercero.</p>
        </div>

        <div className="dl-channel dl-channel--off">
          <label className="pg-check">
            <input type="checkbox" disabled checked={false} readOnly />
            <b>WhatsApp</b>
          </label>
          <p>Desactivado en el playground: no tiene saldo de mensajes, para que nadie lo use para enviar a terceros.</p>
          <button type="button" className="pg-link-button" aria-expanded={demo} onClick={() => setDemo((v) => !v)}>
            {demo ? "Ocultar el estado «Sin saldo de WhatsApp»" : "Ver cómo se ve el estado «Sin saldo de WhatsApp»"}
          </button>
        </div>

        <div className="dl-rules">
          <b>Cómo se evita el abuso</b>
          <ul>
            <li>Verificación de Cloudflare Turnstile en cada envío y cada reenvío.</li>
            <li>5 correos por hora y 20 por día, por visitante y por conexión, aparte del cupo de facturas.</li>
            <li>Como máximo 2 correos al día a una misma dirección, entre todos los visitantes.</li>
            <li>Un reenvío por documento cada 10 minutos, y solo de documentos que usted emitió aquí.</li>
            <li>El correo es siempre el documento de prueba estándar de Facta DTE: no admite texto suyo.</li>
            <li>El navegador no puede agregar ni cambiar canales: van firmados dentro de la sesión.</li>
          </ul>
        </div>

        <div className="dl-actions">
          <TurnstileBox />
          <button type="button" className="pg-primary" disabled={busy || !signedIn || !ready || !mail.send || !emailReady(mail) || mail.address.trim() === "" || (state.quota !== null && !state.quota.allowed)} onClick={() => void start()}>
            {busy ? "Preparando…" : "Emitir y enviar por correo"}
          </button>
          {mailLeft !== null && <span className="pg-hint" data-testid="mail-quota">Correos: {mailLeft.remainingHour} de 5 esta hora · {mailLeft.remainingDay} de 20 hoy</span>}
        </div>
        {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
      </section>

      <section className="dl-card" aria-labelledby="dl-view">
        <h2 id="dl-view">Lo que ve su cliente en la ventana</h2>
        {live === null ? (
          <p className="pg-note">Emita una factura de prueba y verá aquí, en vivo, la fila «Entrega por correo»: enviando, enviado o el motivo del fallo.</p>
        ) : (
          <FactaReceipt result={live} environment="00" reference="Playground" />
        )}
        {demo && (
          <div className="dl-demo">
            <span className="dl-demo-tag">demostración</span>
            <FactaReceipt result={{ ...SAMPLE, delivery: WHATSAPP_DEMO }} environment="00" reference="Demostración" />
          </div>
        )}
        {last !== null && (
          <div className="dl-resend">
            <TurnstileBox />
            <button type="button" className="pg-secondary" disabled={busy || !ready} onClick={() => void resend()}>Reenviar por correo</button>
            <p className="pg-hint">Va a la dirección marcada al emitir. El API envía una vez por canal y el permiso dura cinco minutos desde la emisión.</p>
            {resent !== null && <p role="status" className={resent.tone === "bad" ? "pg-error" : "pg-note"}>{resent.text}</p>}
          </div>
        )}
      </section>

      {session !== null && (
        <FactaInvoiceDialog
          session={session}
          run="auto"
          open={open}
          onOpenChange={setOpen}
          onIssued={(result) => { setLast(result); onIssued(result); }}
          onDelivery={(view) => setDelivery(view)}
        />
      )}
    </div>
  );
}
