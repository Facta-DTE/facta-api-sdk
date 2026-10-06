import { useEffect, useRef, useState } from "react";
import { FactaWindowError, useFactaActions } from "../../../../react.ts";
import { requestInvalidation, type RegistryDocument } from "../../api.ts";
import { TYPE_NAMES, tail } from "./registry-data.ts";

// «Anular» from the registry. Invalidation never starts in the browser: the server checks the
// document is this visitor's, names the responsible people itself and answers a session token;
// the SDK's `invalidate` only submits it.
export function InvalidateDialog({ doc, onClose, onDone }: { doc: RegistryDocument; onClose(): void; onDone(): void }) {
  const actions = useFactaActions();
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    try {
      const token = await requestInvalidation(doc.codigoGeneracion, motivo.trim() === "" ? {} : { tipoAnulacion: 3, motivo: motivo.trim() });
      await actions.invalidate(token);
      onDone();
      onClose();
    } catch (error) {
      if (!(error instanceof FactaWindowError)) setProblem(error instanceof Error ? error.message : "No se pudo anular el documento.");
      else setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reg-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="reg-dialog" role="dialog" aria-modal="true" aria-labelledby="reg-inv-title">
        <h2 id="reg-inv-title">¿Anular este documento?</h2>
        <p>{TYPE_NAMES[doc.tipoDte] ?? doc.tipoDte} <span className="mono">{tail(doc.numeroControl)}</span>. Es irreversible, incluso en el ambiente de pruebas.</p>
        <label className="pg-field">
          <span>Motivo (opcional; con motivo se anula por «otro motivo»)</span>
          <input type="text" maxLength={200} value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Error de captura" />
        </label>
        {problem !== null && <p role="alert" className="pg-error">{problem}</p>}
        <div className="reg-dialog-actions">
          <button type="button" ref={cancel} className="pg-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" className="pg-primary reg-danger" disabled={busy} onClick={() => void confirm()}>{busy ? "Anulando…" : "Anular documento"}</button>
        </div>
      </div>
    </div>
  );
}
