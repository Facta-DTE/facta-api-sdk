import { useId, type KeyboardEvent, type ReactNode } from "react";
import { usePlayground } from "../state.tsx";

/** The `facta.` wordmark of the boards: Bricolage, the dot in the accent. */
export function Wordmark() {
  return <span className="pg-wordmark" aria-label="Facta">facta<i>.</i></span>;
}

export interface Choice<T extends string> { value: T; label: ReactNode; disabled?: boolean }

/** Segmented control (the boards' `.seg`): one choice of a few, keyboard-operable as a radio group. */
export function Segmented<T extends string>({ label, value, onChange, choices, block, className }: {
  label: string;
  value: T;
  onChange(value: T): void;
  choices: readonly Choice<T>[];
  block?: boolean;
  className?: string;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = choices.filter((c) => c.disabled !== true);
    const at = enabled.findIndex((c) => c.value === value);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || at < 0) return;
    event.preventDefault();
    const next = enabled[(at + step + enabled.length) % enabled.length]!;
    onChange(next.value);
    (event.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`pg-segmented${block ? " pg-segmented--block" : ""}${className ? ` ${className}` : ""}`} onKeyDown={move}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          data-value={choice.value}
          aria-checked={choice.value === value}
          tabIndex={choice.value === value || (!choices.some((c) => c.value === value) && choice === choices.find((c) => c.disabled !== true)) ? 0 : -1}
          disabled={choice.disabled}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<string, string> = { sellado: "Sellada", rechazado: "Rechazada", invalidado: "Anulada", contingencia: "Contingencia" };

/** Document state chip: green sealed, red rejected, grey voided, amber contingency. */
export function StatusChip({ estado }: { estado: string }) {
  return <span className={`pg-status pg-status--${estado}`}>{STATUS[estado] ?? estado}</span>;
}

export const HOUR_LIMIT = 20;
export const DAY_LIMIT = 100;

/** Visitor initials from the e-mail's local part («marvin.quevedo@…» → MQ). */
export function initials(email: string): string {
  const parts = (email.split("@")[0] ?? "").split(/[._\-+]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** «N de 20 esta hora», where N is what is left. Null until signed in. */
export function useQuotaView() {
  const { view } = usePlayground();
  const state = view.status === "ready" ? view.state : null;
  const quota = state?.quota ?? null;
  return {
    visitor: state?.visitor ?? null,
    quota,
    hour: quota === null ? null : { left: Math.max(0, quota.remainingHour), limit: HOUR_LIMIT },
    day: quota === null ? null : { left: Math.max(0, quota.remainingDay), limit: DAY_LIMIT },
  };
}

export function QuotaMeter() {
  const { hour } = useQuotaView();
  const id = useId();
  if (hour === null) return null;
  return (
    <span className="pg-meter" data-testid="quota-meter" aria-labelledby={id}>
      <span className="pg-meter-bar" aria-hidden><i style={{ width: `${(hour.left / hour.limit) * 100}%` }} /></span>
      <span className="pg-meter-text" id={id}>{hour.left} de {hour.limit} esta hora</span>
    </span>
  );
}

export function Meter({ label, left, limit }: { label: string; left: number; limit: number }) {
  return (
    <div className="pg-quota-row">
      <div><span>{label}</span><b>{left} de {limit}</b></div>
      <span className="pg-meter-bar pg-meter-bar--wide" role="img" aria-label={`${label}: le quedan ${left} de ${limit}`}><i style={{ width: `${(left / limit) * 100}%` }} /></span>
    </div>
  );
}
