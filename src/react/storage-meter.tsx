import { fill, type StorageView } from "../browser/index.ts";
import { AlertIcon, InfoIcon } from "./icons.tsx";
import { useCfg, type FactaLook } from "./look.tsx";
import { DataRoot, ErrorCallout, splitLook } from "./data-parts.tsx";
import { useFactaStorage } from "./data-hooks.ts";

export interface FactaStorageMeterProps extends FactaLook {
  /** Percentage from which the bar turns amber and warns (default 85). */
  warnAt?: number | undefined;
  className?: string | undefined;
}

/** `1_288_490_188` → `1.2 GB`. Decimal units, like the plans are sold. */
export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export type MeterLevel = "normal" | "near" | "full" | "none";

export function meterLevel(storage: StorageView | undefined, warnAt: number): { level: MeterLevel; percent: number } {
  if (!storage || !storage.configured || storage.quotaBytes === null || storage.quotaBytes <= 0 || storage.usedBytes === null) {
    return { level: "none", percent: 0 };
  }
  const percent = Math.min(100, Math.round((storage.usedBytes / storage.quotaBytes) * 100));
  return { level: percent >= 100 ? "full" : percent >= warnAt ? "near" : "normal", percent };
}

export function FactaStorageMeter(props: FactaStorageMeterProps) {
  const [look, rest] = splitLook(props);
  return (
    <DataRoot look={look} variant="meter" className={rest.className}>
      <MeterInner warnAt={rest.warnAt ?? 85} />
    </DataRoot>
  );
}

function MeterInner({ warnAt }: { warnAt: number }) {
  const { sp, messages } = useCfg();
  const m = messages.data.meter;
  const { storage, loading, error, refresh } = useFactaStorage();
  if (loading) {
    return <div {...sp("meter", "facta-meter")} aria-busy="true"><span className="facta-sk facta-sk--lbl" /><span className="facta-sk" style={{ height: 10, borderRadius: 999 }} /></div>;
  }
  if (error && !storage) {
    return <div {...sp("meter", "facta-meter")}><ErrorCallout title={m.unavailable} body="" code={(error as { code?: string }).code} onRetry={() => void refresh()} retryLabel={m.retry} /></div>;
  }
  const { level, percent } = meterLevel(storage, warnAt);
  if (level === "none") {
    return (
      <div {...sp("meter", "facta-meter facta-meter--none")} data-level="none">
        <div className="facta-meter-hd"><b>{m.title}</b></div>
        <div className="facta-meter-bar" aria-hidden />
        <div className="facta-callout facta-callout--info facta-callout--row">
          <InfoIcon size={18} />
          <div className="facta-callout-text"><b>{m.none.title}</b><span>{m.none.body}</span></div>
        </div>
      </div>
    );
  }
  const used = storage!.usedBytes!;
  const quota = storage!.quotaBytes!;
  const free = Math.max(0, quota - used);
  const freeText = fill(m.free, { free: formatStorageBytes(free) });
  return (
    <div {...sp("meter", `facta-meter facta-meter--${level}`)} data-level={level}>
      <div className="facta-meter-hd">
        <b>{m.title}</b>
        <span className="facta-mono">{fill(m.of, { used: formatStorageBytes(used), total: formatStorageBytes(quota) })}</span>
      </div>
      <div className="facta-meter-bar" role="progressbar" aria-label={m.title} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="facta-meter-ft"><span>{fill(m.usedPercent, { n: percent })}</span><span>{level === "full" ? m.noneFree : freeText}</span></div>
      {level !== "normal" && (
        <div className={`facta-callout facta-callout--${level === "full" ? "danger" : "warning"} facta-callout--row`} role="status">
          <AlertIcon size={18} />
          <div className="facta-callout-text">
            <b>{level === "full" ? m.full.title : m.near.title}</b>
            <span>{level === "full" ? m.full.body : fill(m.near.body, { free: formatStorageBytes(free) })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
