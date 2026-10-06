import { useState } from "react";
import { FactaWindowError, useFactaActions } from "../../../../../react.ts";
import { requestInvalidation, type IssuedDocument } from "../../../api.ts";
import { TurnstileBox } from "../../../components/turnstile.tsx";
import { useTurnstileReady } from "../../../turnstile.ts";

// Invalidation never starts in the browser: your server seals an invalidation session
// (here `POST /api/invalidation`, only for documents this visitor issued, with the people
// named on the event taken from the server's fixtures), and the dialog only asks for
// confirmation and shows Hacienda's answer.
export function InvalidateExample({ issued, canInvalidate, onInvalidated }: { issued: IssuedDocument[]; canInvalidate: boolean; onInvalidated: () => void }) {
  const actions = useFactaActions();
  const [code, setCode] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const ready = useTurnstileReady();
  const chosen = code !== "" ? code : issued[0]?.codigoGeneracion ?? "";

  async function invalidate() {
    setBusy(true);
    setMessage(null);
    try {
      const token = await requestInvalidation(chosen, motivo.trim() === "" ? {} : { tipoAnulacion: 3, motivo: motivo.trim() });
      const outcome = await actions.invalidate(token);
      setMessage({ tone: "ok", text: outcome.yaEstabaInvalidado ? "El documento ya estaba anulado." : `Anulado. Sello del evento: ${outcome.evento?.selloRecibido.slice(0, 14) ?? "—"}…` });
      onInvalidated();
    } catch (error) {
      if (!(error instanceof FactaWindowError)) setMessage({ tone: "bad", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  if (issued.length === 0) return <p className="pg-note">Aún no emitió documentos aquí. Emita uno y podrá anularlo.</p>;
  return (
    <div style={{ display: "grid", gap: 12, width: "100%", maxWidth: 520 }}>
      <label className="pg-field">
        <span>Documento que usted emitió</span>
        <select value={chosen} onChange={(event) => setCode(event.target.value)}>
          {issued.map((d) => <option key={d.codigoGeneracion} value={d.codigoGeneracion}>{d.numeroControl ?? d.codigoGeneracion}</option>)}
        </select>
      </label>
      <label className="pg-field">
        <span>Motivo (opcional; con motivo se anula por «otro motivo»)</span>
        <input type="text" maxLength={200} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Error de captura" />
      </label>
      <TurnstileBox />
      <button type="button" className="pg-primary" disabled={busy || !canInvalidate || !ready} onClick={invalidate}>
        {busy ? "Preparando…" : "Anular documento"}
      </button>
      {!canInvalidate && <p className="pg-note">Este playground no tiene responsables de demostración configurados, así que no puede anular.</p>}
      {message !== null && <p role="status" className={message.tone === "bad" ? "pg-error" : "pg-note"}>{message.text}</p>}
    </div>
  );
}
