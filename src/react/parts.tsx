// Small building blocks shared by the card, the button's popover and the receipt.

import { useCallback, useEffect, useRef, useState } from "react";
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
import { AlertIcon, CheckIcon, ClockIcon, CopyIcon, CrossIcon, DownloadIcon } from "./icons.tsx";
import { DeliveryRows } from "./delivery.tsx";
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
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [value]);
  return (
    <button
      type="button"
      className={cx("facta-copy")}
      data-copied={copied ? "" : undefined}
      aria-label={fill(messages.sealed.copyLabel, { label })}
      onClick={onCopy}
    >
      <span className="facta-copy-icon" aria-hidden>{copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}</span>
      <span className="facta-copy-text">{copied ? messages.sealed.copied : messages.sealed.copy}</span>
      <span className="facta-sr" role="status" aria-live="polite">{copied ? messages.sealed.copied : ""}</span>
    </button>
  );
}

/** Rolls a money amount up from zero in ≤400 ms; instant when motion is off. */
export function Money({ value, className }: { value: number; className?: string }) {
  const { motion } = useCfg();
  const [shown, setShown] = useState(motion === "full" ? 0 : value);
  useEffect(() => {
    if (motion !== "full" || typeof requestAnimationFrame !== "function") {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 380);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, motion]);
  return <span className={className} aria-label={formatMoney(value)}>{formatMoney(shown)}</span>;
}

export type Tone = "success" | "warning" | "danger" | "neutral";

/** The sealed «stamp»: ring ripple, badge scaling in, check drawn. */
export function StampSeal({ tone = "success" }: { tone?: Tone }) {
  const { cx } = useCfg();
  return (
    <span className={cx("facta-stamp", undefined, `facta-tone-${tone}`)} aria-hidden>
      <span className="facta-stamp-ring" />
      <span className="facta-stamp-badge">
        {tone === "success" && <CheckIcon size={30} strokeWidth={2.6} />}
        {tone === "warning" && <ClockIcon size={28} />}
        {tone === "danger" && <CrossIcon size={28} />}
        {tone === "neutral" && <AlertIcon size={28} />}
      </span>
    </span>
  );
}

export function Stepper({ phase }: { phase: IssuePhase | null }) {
  const { cx, messages } = useCfg();
  const order: IssuePhase[] = ["preparing", "signing", "sending"];
  const active = phase ? order.indexOf(phase) : 0;
  return (
    <ol className={cx("facta-steps")}>
      {order.map((key, i) => {
        const status = i < active ? "done" : i === active ? "active" : "pending";
        return (
          <li key={key} className={cx("facta-step", undefined, `facta-step--${status}`)} aria-current={status === "active" ? "step" : undefined}>
            <span className="facta-step-marker">
              {status === "done" ? <CheckIcon size={14} strokeWidth={3} /> : status === "active" ? <span className="facta-step-dot" /> : null}
            </span>
            <span className="facta-step-label">{messages.issuing.steps[key]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function FieldsList({ fields, heading }: { fields: FieldIssue[]; heading: string }) {
  const { cx } = useCfg();
  if (fields.length === 0) return null;
  return (
    <section className={cx("facta-block")}>
      <h3 className={cx("facta-label")}>{heading}</h3>
      <ul className={cx("facta-fields")}>
        {fields.map((f, i) => (
          <li key={`${f.path}-${i}`}>
            <strong>{f.label}</strong>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Quote({ lines, heading }: { lines: string[]; heading: string }) {
  const { cx } = useCfg();
  if (lines.length === 0) return null;
  return (
    <section className={cx("facta-block")}>
      <h3 className={cx("facta-label")}>{heading}</h3>
      <blockquote className={cx("facta-quote")}>
        {lines.map((line, i) => <p key={i}>{line}</p>)}
      </blockquote>
    </section>
  );
}

function StorageRow({ result }: { result: IssueResult }) {
  const { cx, messages } = useCfg();
  const tone = storageTone(result.storage);
  if (!tone) return null;
  const text = messages.storage[tone];
  const help = tone === "saved" ? messages.storage.savedHelp : tone === "pending" ? messages.storage.pendingHelp : messages.storage.offHelp;
  return (
    <div className={cx("facta-row")}>
      <dt>{messages.storage.label}</dt>
      <dd title={help}>
        <span className={cx("facta-storage", undefined, `facta-storage--${tone}`)}>
          <span className="facta-dot" aria-hidden />
          {text}
        </span>
        {tone !== "saved" && <small className={cx("facta-help")}>{help}</small>}
      </dd>
    </div>
  );
}

export function Identifiers({ result, showStorage }: { result: IssueResult; showStorage: boolean }) {
  const { cx, messages } = useCfg();
  const m = messages.sealed;
  return (
    <dl className={cx("facta-details")}>
      <div className={cx("facta-row")}>
        <dt>{m.controlNumber}</dt>
        <dd><span className="facta-mono facta-break">{result.numeroControl}</span><CopyButton value={result.numeroControl} label={m.controlNumber} /></dd>
      </div>
      <div className={cx("facta-row")}>
        <dt>{m.generationCode}</dt>
        <dd><span className="facta-mono facta-break">{result.codigoGeneracion}</span><CopyButton value={result.codigoGeneracion} label={m.generationCode} /></dd>
      </div>
      {result.selloRecibido && (
        <div className={cx("facta-row")}>
          <dt>{m.seal}</dt>
          <dd><span className="facta-mono" title={result.selloRecibido}>{truncateMiddle(result.selloRecibido, 12, 6)}</span><CopyButton value={result.selloRecibido} label={m.seal} /></dd>
        </div>
      )}
      <div className={cx("facta-row")}>
        <dt>{m.dateTime}</dt>
        <dd>{formatDateTime(result.fecEmi, result.horEmi)}</dd>
      </div>
      {showStorage && <StorageRow result={result} />}
      <DeliveryRows result={result} />
    </dl>
  );
}

export function Downloads({ result }: { result: IssueResult }) {
  const { cx, messages } = useCfg();
  const pdf = result.estado === "sellado" ? result.representacionGrafica : null;
  const json = result.archivoJson;
  if (!pdf && !json) return null;
  return (
    <div className={cx("facta-downloads")}>
      {pdf && (
        <button type="button" className={cx("facta-btn facta-btn--secondary facta-btn--sm")} onClick={() => downloadPdf(pdf, result.codigoGeneracion)}>
          <DownloadIcon size={16} />{messages.sealed.downloadPdf}
        </button>
      )}
      {json && (
        <button type="button" className={cx("facta-btn facta-btn--secondary facta-btn--sm")} onClick={() => downloadJson(json, result.codigoGeneracion)}>
          <DownloadIcon size={16} />{messages.sealed.downloadJson}
        </button>
      )}
    </div>
  );
}

export function ObservationsList({ result }: { result: IssueResult }) {
  const { messages } = useCfg();
  if (!result.observaciones || result.observaciones.length === 0) return null;
  return <Quote lines={result.observaciones} heading={messages.sealed.observations} />;
}

export function SealedContent({
  result,
  showStorage,
  showHeadline,
}: {
  result: IssueResult;
  showStorage: boolean;
  showHeadline?: boolean;
}) {
  const { cx, messages } = useCfg();
  const total = result.totales?.totalPagar;
  return (
    <div className={cx("facta-result")}>
      <div className={cx("facta-hero")}>
        <StampSeal tone="success" />
        {showHeadline && <h3 className={cx("facta-headline")}>{messages.sealed.headline}</h3>}
        {typeof total === "number" && (
          <div className={cx("facta-hero-total")}>
            <span className={cx("facta-label")}>{messages.sealed.total}</span>
            <Money value={total} className="facta-amount facta-amount--xl" />
          </div>
        )}
      </div>
      <Identifiers result={result} showStorage={showStorage} />
      <Downloads result={result} />
      <ObservationsList result={result} />
    </div>
  );
}

export function ContingencyContent({
  result,
  showStorage,
}: {
  result: IssueResult;
  showStorage: boolean;
}) {
  const { cx, messages } = useCfg();
  return (
    <div className={cx("facta-result")}>
      <div className={cx("facta-hero")}>
        <StampSeal tone="warning" />
        <h3 className={cx("facta-headline")}>{messages.contingency.headline}</h3>
        <p className={cx("facta-text")}>{messages.contingency.body}</p>
      </div>
      <Identifiers result={result} showStorage={showStorage} />
      {result.detalle && (
        <section className={cx("facta-block")}>
          <h3 className={cx("facta-label")}>{messages.contingency.detail}</h3>
          <p className={cx("facta-text facta-text--small")}>{result.detalle}</p>
        </section>
      )}
      <Downloads result={result} />
    </div>
  );
}

export function FailureContent({ error, kind, showHeadline = true }: { error: FlowFailure; kind: "rejected" | "failed"; showHeadline?: boolean }) {
  const { cx, messages } = useCfg();
  const m = messages;
  const spentNumber = error.spent?.numeroControl;
  const headline = error.uncertain ? m.failed.uncertainTitle : kind === "rejected" ? m.rejected.headline : m.failed.headline;
  return (
    <div className={cx("facta-result")}>
      <div className={cx("facta-hero")}>
        <StampSeal tone={error.uncertain ? "warning" : "danger"} />
        {showHeadline && <h3 className={cx("facta-headline")}>{headline}</h3>}
        <p className={cx("facta-text")}>{error.uncertain ? m.failed.uncertainBody : error.explanation}</p>
      </div>
      <Quote lines={error.observaciones} heading={m.rejected.quoteHeading} />
      <FieldsList fields={error.fields} heading={kind === "rejected" ? m.rejected.fieldsHeading : m.failed.fieldsHeading} />
      {error.fields.length > 0 && <p className={cx("facta-text facta-text--small")}>{m.failed.fixInSystem}</p>}
      {spentNumber && <p className={cx("facta-text facta-text--small")}>{fill(m.rejected.spent, { numeroControl: spentNumber })}</p>}
      <p className={cx("facta-codeline")}>{m.failed.codeLabel}: <span className="facta-mono">{error.code}</span></p>
    </div>
  );
}
