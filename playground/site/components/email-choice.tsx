import { useId } from "react";

export interface EmailChoiceValue {
  send: boolean;
  address: string;
}

export const EMPTY_EMAIL: EmailChoiceValue = { send: false, address: "" };

/** Mirrors the server's `parseAddress` closely enough to gate the button; the server decides. */
export function looksLikeAddress(address: string): boolean {
  const trimmed = address.trim();
  return trimmed.length <= 254 && /^[^\s@,;<>()[\]\\"]{1,64}@[^\s@,;<>()[\]\\"]+\.[^\s@,;<>()[\]\\"]+$/.test(trimmed);
}

/** What the sale needs from an «enviar por correo» choice: nothing, or a valid address. */
export const emailReady = (value: EmailChoiceValue) => !value.send || looksLikeAddress(value.address);

/**
 * «Enviar el documento por correo» with the address the visitor types. Any address is allowed; the
 * server verifies the visitor is not a bot and limits the sends, so the field only explains the rules.
 */
export function EmailChoice({ value, onChange, disabled }: { value: EmailChoiceValue; onChange(value: EmailChoiceValue): void; disabled?: boolean }) {
  const id = useId();
  const invalid = value.send && value.address.trim() !== "" && !looksLikeAddress(value.address);
  return (
    <div className="pg-email-choice">
      <label className="pg-check">
        <input type="checkbox" checked={value.send} disabled={disabled} onChange={(event) => onChange({ ...value, send: event.target.checked })} />
        Enviar el documento por correo
      </label>
      {value.send && (
        <div className={`pg-field${invalid ? " pg-field--invalid" : ""}`}>
          <label htmlFor={id}>Correo del cliente</label>
          <input id={id} type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="cliente@ejemplo.com" value={value.address} aria-invalid={invalid} aria-describedby={`${id}-hint`} onChange={(event) => onChange({ ...value, address: event.target.value })} />
          <small id={`${id}-hint`} className="pg-hint">Se envía el documento de prueba estándar de Facta DTE, sin texto suyo. Límite: 5 por hora y 20 por día.</small>
        </div>
      )}
    </div>
  );
}
