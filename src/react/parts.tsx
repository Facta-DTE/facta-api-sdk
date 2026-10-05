// Small building blocks shared by the card, the button's popover and the receipt.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  downloadJson,
  downloadPdf,
  fill,
  formatDateTime,
  formatMoney,
  storageTone,
  truncateMiddle,
  type FieldIssue,
  type FlowFailure,
  type IssuePhase,
  type IssueResult,
} from "../browser/index.ts";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, CopyIcon, CrossIcon, DownloadIcon, HourIcon, InfoIcon, SealBig, Spinner } from "./icons.tsx";
import { useCfg } from "./look.tsx";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const cfg = useCfg();
  const { cx, messages } = cfg;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch { /* the person can still select the text by hand */ }
      area.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [value]);
  return (
    <button
      type="button"
      className={cx("facta-copy")}
      data-copied={copied ? "" : undefined}
      aria-label={fill(messages.sealed.copyLabel, { label })}
      onClick={onCopy}
    >
      <span className="facta-copy-icon" aria-hidden>{copied ? <CheckIcon size={14} /> : <CopyIcon size={16} />}</span>
      {copied && <span className="facta-copy-text">{messages.sealed.copied}</span>}
      <span className="facta-sr" role="status" aria-live="polite">{copied ? messages.sealed.copied : ""}</span>
    </button>
  );
}

/** Rolls a money amount up from zero in 600 ms; instant when motion is off. */
export function Money({ value, className }: { value: number; className?: string }) {
  const { motion, sp } = useCfg();
  const [shown, setShown] = useState(motion === "full" ? 0 : value);
  useEffect(() => {
    if (motion !== "full" || typeof requestAnimationFrame !== "function") {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, motion]);
  return <b {...sp("total", "facta-total", className)} aria-label={formatMoney(value)}>{formatMoney(shown)}</b>;
}

export type Tone = "success" | "warning" | "danger" | "neutral";

/** The status «stamp»: ring ripple and a badge that lands like a rubber stamp. */
export function StampSeal({ tone = "success", small, children }: { tone?: Tone; small?: boolean; children?: ReactNode }) {
  const { sp } = useCfg();
  return (
    <span {...sp("statusIcon", `facta-stamp facta-tone-${tone}${small ? " facta-stamp--sm" : ""}`)} aria-hidden>
      <span className="facta-stamp-ring" />
      <span className="facta-stamp-badge">
        {children ?? (
          <>
            {tone === "success" && <SealBig size={40} />}
            {tone === "warning" && <ClockIcon size={32} />}
            {tone === "danger" && <CrossIcon size={small ? 28 : 30} />}
            {tone === "neutral" && <AlertIcon size={28} />}
          </>
        )}
      </span>
    </span>
  );
}

export function ExpiredIcon() {
  return <StampSeal tone="neutral"><HourIcon size={30} /></StampSeal>;
}

const STEP_ORDER: IssuePhase[] = ["preparing", "signing", "sending"];

/** `phase = null` with `allDone` shows every step done. */
export function Stepper({ phase }: { phase: IssuePhase | null }) {
  const { sp, messages } = useCfg();
  const active = phase ? STEP_ORDER.indexOf(phase) : 0;
  return (
    <ol {...sp("stepper", "facta-steps")} aria-live="polite">
      {STEP_ORDER.map((key, i) => {
        const status = i < active ? "done" : i === active ? "active" : "pending";
        return (
          <li key={key} className={`facta-step facta-step--${status}`} aria-current={status === "active" ? "step" : undefined}>
            <span className="facta-step-node">
              {status === "done" && <CheckIcon size={16} strokeWidth={2.4} />}
              {status === "active" && <span className="facta-step-dot" />}
              {status === "active" && <span className="facta-step-ring" />}
            </span>
            {i < STEP_ORDER.length - 1 && <span className="facta-step-conn"><i className="facta-step-fill" /></span>}
            <span className="facta-step-text">
              <b className="facta-step-label">{messages.issuing.steps[key]}</b>
              <small className="facta-step-state">{messages.issuing.stepStates[status]}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function FieldsList({ fields, heading }: { fields: FieldIssue[]; heading?: string }) {
  const { sp } = useCfg();
  if (fields.length === 0) return null;
  return (
    <ul {...sp("fieldList", "facta-fields")} aria-label={heading}>
      {fields.map((f, i) => (
        <li key={`${f.path}-${i}`} className="facta-field">
          <CloseIcon size={16} />
          <span>
            <b>{f.label}</b> — {f.message}
            <code className="facta-field-path">{f.path}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Quote({ lines, heading }: { lines: string[]; heading: string }) {
  const { sp } = useCfg();
  if (lines.length === 0) return null;
  return (
    <blockquote {...sp("quote", "facta-quote")}>
      <small className="facta-quote-title">{heading}</small>
      {lines.map((line, i) => <p key={i} className="facta-quote-line">{line}</p>)}
    </blockquote>
  );
}

export function StorageRow({ result }: { result: IssueResult }) {
  const { sp, messages } = useCfg();
  const tone = storageTone(result.storage);
  if (!tone) return null;
  const text = messages.storage[tone];
  const help = tone === "saved" ? messages.storage.savedHelp : tone === "pending" ? messages.storage.pendingHelp : messages.storage.offHelp;
  return (
    <div {...sp("storageRow", "facta-kv")}>
      <dt className="facta-kv-k">{messages.storage.label}</dt>
      <dd className="facta-kv-v facta-dd" title={help}>
        <span className={`facta-storage facta-storage--${tone}`}>
          <span className="facta-dot" aria-hidden />
          {text}
        </span>
        {tone !== "saved" && <small className="facta-help">{help}</small>}
      </dd>
    </div>
  );
}

export function IdRow({ label, value, shown, copy = true }: { label: string; value: string; shown?: string; copy?: boolean }) {
  return (
    <div className="facta-kv facta-kv--stack">
      <dt className="facta-kv-k">{label}</dt>
      <dd className="facta-kv-v facta-id facta-mono">
        <span title={shown ? value : undefined}>{shown ?? value}</span>
        {copy && <CopyButton value={value} label={label} />}
      </dd>
    </div>
  );
}

export function Identifiers({ result, showStorage, dateLabel }: { result: IssueResult; showStorage: boolean; dateLabel?: string }) {
  const { sp, messages } = useCfg();
  const m = messages.sealed;
  return (
    <dl {...sp("identifiers", "facta-block facta-details")}>
      <IdRow label={m.controlNumber} value={result.numeroControl} copy={false} />
      <IdRow label={m.generationCode} value={result.codigoGeneracion} />
      {result.selloRecibido && <IdRow label={m.seal} value={result.selloRecibido} shown={truncateMiddle(result.selloRecibido, 12, 6)} />}
      <div className="facta-kv">
        <dt className="facta-kv-k">{dateLabel ?? m.dateTime}</dt>
        <dd className="facta-kv-v">{formatDateTime(result.fecEmi, result.horEmi)}</dd>
      </div>
      {showStorage && <StorageRow result={result} />}
    </dl>
  );
}

type TileState = "idle" | "loading" | "done";

/** A download tile: icon, label, one muted line; spinner while working, check for 1.5 s after. */
export function DownloadTile({ kind, result }: { kind: "pdf" | "json"; result: IssueResult }) {
  const { sp, messages } = useCfg();
  const [state, setState] = useState<TileState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const label = kind === "pdf" ? messages.sealed.downloadPdf : messages.sealed.downloadJson;
  const hint = kind === "pdf" ? messages.downloads.pdfHint : messages.downloads.jsonHint;
  const onClick = async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      await Promise.resolve();
      if (kind === "pdf" && result.estado === "sellado" && result.representacionGrafica) downloadPdf(result.representacionGrafica, result.codigoGeneracion);
      if (kind === "json" && result.archivoJson) downloadJson(result.archivoJson, result.codigoGeneracion);
      setState("done");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  };
  return (
    <button
      type="button"
      {...sp("downloadButton", "facta-download")}
      data-state={state}
      data-kind={kind}
      aria-label={label}
      aria-busy={state === "loading" || undefined}
      onClick={onClick}
    >
      <span className="facta-download-icon" aria-hidden>
        {state === "loading" ? <Spinner size={20} /> : state === "done" ? <CheckIcon size={20} /> : <DownloadIcon size={20} />}
      </span>
      <span className="facta-download-text">
        <span className="facta-download-label">{label}</span>
        <span className="facta-download-hint">{hint}</span>
      </span>
    </button>
  );
}

export function Downloads({ result }: { result: IssueResult }) {
  const pdf = result.estado === "sellado" ? result.representacionGrafica : null;
  const json = result.archivoJson;
  if (!pdf && !json) return null;
  return (
    <div className="facta-downloads">
      {pdf && <DownloadTile kind="pdf" result={result} />}
      {json && <DownloadTile kind="json" result={result} />}
    </div>
  );
}

export function ObservationsList({ result }: { result: IssueResult }) {
  const { messages } = useCfg();
  if (!result.observaciones || result.observaciones.length === 0) return null;
  return <Quote lines={result.observaciones} heading={messages.sealed.observations} />;
}

export function Callout({ tone, children }: { tone: "warning" | "info" | "danger"; children: ReactNode }) {
  return (
    <div className={`facta-callout facta-callout--${tone}`} role={tone === "warning" ? "note" : undefined}>
      {tone === "info" ? <InfoIcon size={20} /> : <AlertIcon size={20} />}
      <span>{children}</span>
    </div>
  );
}

export function SealedContent({
  result,
  showStorage,
  compact,
}: {
  result: IssueResult;
  showStorage: boolean;
  /** The popover and the receipt: no headline, smaller. */
  compact?: boolean;
}) {
  const { messages } = useCfg();
  const total = result.totales?.totalPagar;
  return (
    <>
      <div className="facta-hero">
        <StampSeal tone="success" />
        <h3 className="facta-headline">{result.tipoDte === "01" ? messages.sealed.headline : messages.docTypes[result.tipoDte] ?? messages.sealed.headline}</h3>
        {typeof total === "number" && (
          <>
            <span className="facta-sub">{messages.sealed.total}</span>
            <Money value={total} />
          </>
        )}
      </div>
      <Identifiers result={result} showStorage={showStorage} />
      {!compact && <Downloads result={result} />}
      <ObservationsList result={result} />
    </>
  );
}

export function ContingencyContent({ result, showStorage }: { result: IssueResult; showStorage: boolean }) {
  const { messages } = useCfg();
  return (
    <>
      <div className="facta-hero">
        <StampSeal tone="warning" />
        <h3 className="facta-headline">{messages.contingency.headline}</h3>
        <p className="facta-hero-text">{messages.contingency.body}</p>
      </div>
      <Callout tone="warning"><b>{messages.contingency.warningTitle}</b> {messages.contingency.warningBody}</Callout>
      <Identifiers result={result} showStorage={showStorage} dateLabel={messages.contingency.signedAt} />
      {result.detalle && <p className="facta-text facta-text--small">{result.detalle}</p>}
      <Downloads result={result} />
    </>
  );
}

export function FailureContent({ error, kind }: { error: FlowFailure; kind: "rejected" | "failed"; showHeadline?: boolean }) {
  const { messages: m } = useCfg();
  const spentNumber = error.spent?.numeroControl;
  const headline = error.uncertain ? m.failed.uncertainTitle : kind === "rejected" ? m.rejected.headline : m.failed.headline;
  const rejected = kind === "rejected" && !error.uncertain;
  const lead = error.uncertain ? m.failed.uncertainBody : rejected && error.fields.length > 0 ? m.rejected.intro : error.explanation;
  return (
    <>
      <div className={rejected ? "facta-hero facta-hero--left" : "facta-hero"}>
        <StampSeal tone={error.uncertain ? "warning" : "danger"} small={rejected} />
        <h3 className="facta-headline">{headline}</h3>
        <p className="facta-hero-text">{lead}</p>
      </div>
      <FieldsList fields={error.fields} heading={kind === "rejected" ? m.rejected.fieldsHeading : m.failed.fieldsHeading} />
      <Quote lines={error.observaciones} heading={m.sealed.observations} />
      {error.spent && (
        <p className="facta-note">
          {spentNumber ? fill(m.rejected.spent, { numeroControl: spentNumber }) : m.rejected.spentUnknown}
        </p>
      )}
      {rejected && <Callout tone="info">{m.rejected.fixInSystem}</Callout>}
      {!rejected && error.fields.length > 0 && <p className="facta-text facta-text--small">{m.failed.fixInSystem}</p>}
      {!rejected && (
        <div className="facta-block">
          <span className="facta-label">{m.failed.detailLabel}</span>
          <span className="facta-codeline">{error.code}</span>
        </div>
      )}
    </>
  );
}
