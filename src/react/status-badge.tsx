import { FactaRoot, useCfg, type FactaLook } from "./look.tsx";

export interface FactaStatusBadgeProps extends FactaLook {
  /** A document `estado`: sellado, contingencia, rechazado, invalidado… */
  estado: string;
  className?: string | undefined;
}

const TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sellado: "success",
  contingencia: "warning",
  rechazado: "danger",
};

function Badge({ estado }: { estado: string }) {
  const { cx, messages } = useCfg();
  const tone = TONES[estado] ?? "neutral";
  return (
    <span className={cx("facta-badge", undefined, `facta-badge--${tone}`)}>
      <span className="facta-dot" aria-hidden />
      {messages.status[estado] ?? estado}
    </span>
  );
}

export function FactaStatusBadge({ estado, className, ...look }: FactaStatusBadgeProps) {
  return (
    <FactaRoot look={look} className={className} style={{ display: "inline-block" }}>
      <Badge estado={estado} />
    </FactaRoot>
  );
}
