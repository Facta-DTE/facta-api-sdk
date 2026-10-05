import { useEffect, useId, useRef, useState } from "react";
import type { ServiceState } from "../browser/index.ts";
import { ClockIcon } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { DataRoot, WifiOffIcon, splitLook } from "./data-parts.tsx";
import { useFactaServiceStatus } from "./data-hooks.ts";

export interface FactaServiceStatusProps extends FactaLook {
  /** `pill` (text + dot) or `dot` (44 px touch target with the state in `aria-label`, for a POS header). */
  variant?: "pill" | "dot" | undefined;
  /** Poll interval in ms (default 60 000); paused while the tab is hidden. */
  pollMs?: number | undefined;
  /** Explain the state in a tooltip on hover, focus or tap (default true; pill only). */
  help?: boolean | undefined;
  /** Called whenever the state changes. */
  onChange?: ((state: ServiceState | null) => void) | undefined;
  className?: string | undefined;
}

export function FactaServiceStatus(props: FactaServiceStatusProps) {
  const [look, rest] = splitLook(props);
  return (
    <DataRoot look={look} variant="status" className={`facta-data--inline ${rest.className ?? ""}`}>
      <StatusInner {...rest} />
    </DataRoot>
  );
}

function StatusInner(props: Omit<FactaServiceStatusProps, keyof FactaLook>) {
  const { sp, messages, cx } = useCfg();
  const m = messages.data.service;
  const status = useFactaServiceStatus(props.pollMs !== undefined ? { pollMs: props.pollMs } : {});
  const { state } = status;
  const [tip, setTip] = useState(false);
  const tipId = useId();
  const onChange = props.onChange;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    changeRef.current?.(state);
  }, [state]);
  const key = state ?? "checking";
  const labels = { online: m.online, contingency: m.contingency, degraded: m.degraded, offline: m.offline, checking: m.checking };
  const helps = { online: m.onlineHelp, contingency: m.contingencyHelp, degraded: m.degradedHelp, offline: m.offlineHelp, checking: "" };
  const label = labels[key];
  if (props.variant === "dot") {
    return (
      <span {...sp("pill", "facta-dot-btn", `facta-dot-btn--${key}`)} role="img" aria-label={`${label}. ${helps[key]}`.trim()} title={label} data-state={key}>
        <i />
      </span>
    );
  }
  const help = props.help !== false && helps[key] !== "";
  return (
    <span
      {...sp("pill", "facta-svc", `facta-svc--${key}`)}
      data-state={key}
      role="status"
      tabIndex={help ? 0 : undefined}
      aria-describedby={help && tip ? tipId : undefined}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      onFocus={() => setTip(true)}
      onBlur={() => setTip(false)}
      onClick={() => setTip((v) => !v)}
      onKeyDown={(e) => { if (e.key === "Escape") setTip(false); }}
    >
      {key === "contingency" ? <ClockIcon size={14} /> : key === "offline" ? <WifiOffIcon size={14} /> : <i aria-hidden />}
      {label}
      {help && tip && <span id={tipId} role="tooltip" className={cx("facta-tip")}>{helps[key]}</span>}
    </span>
  );
}
