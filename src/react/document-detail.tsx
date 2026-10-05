import { useState, type ReactNode } from "react";
import { formatMoney, type CopyRow, type DocumentDetail, type DownloadKind, type FactaMessages } from "../browser/index.ts";
import { AlertIcon, CheckIcon, ClockIcon } from "./icons.tsx";
import { CopyButton } from "./parts.tsx";
import { useCfg, useResolvedLook, type FactaLook } from "./look.tsx";
import {
  Attribution,
  BanIcon,
  CloudIcon,
  DataLayer,
  DataRoot,
  ErrorCallout,
  EstadoBadge,
  EyeOffIcon,
  docTypeLabel,
  midTruncate,
  RefreshIcon,
  shortDate,
  shortTime,
  splitLook,
} from "./data-parts.tsx";
import { DownloadSplit } from "./download-button.tsx";
import { useFactaActions, useFactaDocument, useFactaDocumentCopies } from "./data-hooks.ts";
import { FactaWindowError } from "./provider.tsx";

export interface FactaDocumentDetailProps extends FactaLook {
  /** The document to show. */
  codigoGeneracion: string | null;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** `drawer` (default): right panel on desktop, sheet on phones. `inline`: embedded in the page. */
  presentation?: "drawer" | "inline" | undefined;
  /** Formats offered by the download button. */
  kinds?: DownloadKind[] | undefined;
  /** Show the «Copias» block (needs `documents: "read"`; hidden when the handler refuses it). Default true. */
  showCopies?: boolean | undefined;
  /**
   * Gives the «Anular» action: return the token your server made with
   * `createFactaInvalidationSession` for this document. Omit it to hide the action.
   */
  onInvalidate?: ((document: DocumentDetail) => string | Promise<string>) | undefined;
  /** Called after the document was invalidated from here. */
  onInvalidated?: (() => void) | undefined;
  className?: string | undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TotalsTable({ doc }: { doc: DocumentDetail }) {
  const { messages, sp } = useCfg();
  const t = doc.totales ?? {};
  const rows: Array<[string, number | undefined, boolean]> = [
    [messages.data.detail.taxed, t.totalGravada, false],
    [messages.data.detail.exempt, t.totalExenta, true],
    [messages.data.detail.notSubject, t.totalNoSuj, true],
    [messages.data.detail.discount, t.totalDescu, true],
    [messages.data.detail.iva, t.totalIva, false],
  ];
  const shown = rows.filter(([, v, hideZero]) => v !== undefined && !(hideZero && v === 0));
  return (
    <section className="facta-d-sec" aria-labelledby={undefined}>
      <h3 className="facta-d-h">{messages.data.detail.totals}</h3>
      <table {...sp("identifiers", "facta-d-tot")}>
        <tbody>
          {shown.map(([label, value]) => (
            <tr key={label}><th scope="row">{label}</th><td className="facta-amount">{formatMoney(value)}</td></tr>
          ))}
          <tr className="facta-d-tot-final"><th scope="row">{messages.data.detail.grandTotal}</th><td className="facta-amount">{formatMoney(t.totalPagar)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

function CopiesBlock({ code, estado }: { code: string; estado: string }) {
  const { cx, messages } = useCfg();
  const m = messages.data.detail.copies;
  const copies = useFactaDocumentCopies(code, { enabled: estado === "sellado" });
  const actions = useFactaActions();
  const [retrying, setRetrying] = useState(false);
  if (estado !== "sellado" || copies.unavailable) return null;
  const rows: CopyRow[] = copies.data ?? [];
  const bad = rows.some((r) => r.state !== "stored");
  const aggregate = rows.length === 0 ? null : rows.every((r) => r.state === "stored") ? "ok" : rows.some((r) => r.state === "failed") ? "bad" : "wait";
  async function retry() {
    setRetrying(true);
    try {
      await actions.retryStorage(code);
    } catch { /* the block re-reads and shows the real state */ }
    await copies.refresh();
    setRetrying(false);
  }
  const stateLabel = (s: CopyRow["state"]) => (s === "stored" ? m.saved : s === "pending" ? m.pending : m.failed);
  return (
    <section className="facta-d-sec">
      <h3 className="facta-d-h">{m.heading}</h3>
      <div className="facta-copies" aria-busy={copies.loading || undefined}>
        <div className="facta-copies-row facta-copies-row--group">
          <CloudIcon size={16} />
          <span>{m.facta}</span>
          {aggregate && (
            <span className={cx("facta-st", undefined, `facta-st--${aggregate}`)}>
              {aggregate === "ok" ? <CheckIcon size={14} /> : aggregate === "wait" ? <ClockIcon size={14} /> : <AlertIcon size={14} />}
              {aggregate === "ok" ? m.saved : aggregate === "wait" ? m.pending : m.failed}
            </span>
          )}
        </div>
        {copies.loading && <div className="facta-copies-row facta-copies-row--sub"><span className="facta-sk facta-sk--lbl" /></div>}
        {copies.error && !copies.data && (
          <div className="facta-copies-row facta-copies-row--sub" role="alert">{messages.data.detail.error}</div>
        )}
        {rows.length === 0 && !copies.loading && !copies.error && (
          <div className="facta-copies-row facta-copies-row--sub facta-muted">{m.none}</div>
        )}
        {rows.map((r) => (
          <div key={r.kind} className="facta-copies-row facta-copies-row--sub">
            <span>{r.kind === "json" ? m.json : m.pdf}</span>
            <span className="facta-mono facta-muted facta-copies-bytes">{formatBytes(r.bytes)}</span>
            <span className={cx("facta-st", undefined, `facta-st--${r.state === "stored" ? "ok" : r.state === "pending" ? "wait" : "bad"}`)}>{stateLabel(r.state)}</span>
          </div>
        ))}
        {bad && (
          <div className="facta-copies-row facta-copies-row--action">
            <button type="button" className={cx("facta-btn facta-btn--sm")} disabled={retrying} onClick={() => void retry()}>
              <RefreshIcon size={14} />
              {retrying ? m.retrying : m.retry}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Timeline({ doc }: { doc: DocumentDetail }) {
  const { cx, messages } = useCfg();
  const m = messages.data.detail.timeline;
  type Item = { id: string; tone: "ok" | "wait" | "off"; icon: ReactNode; title: string; help?: string; time?: string };
  const issued = `${shortDate(doc.fecEmi)}${doc.horEmi ? ` · ${shortTime(doc.horEmi)}` : ""}`;
  const items: Item[] = [];
  if (doc.estado === "contingencia") {
    items.push({ id: "c", tone: "wait", icon: <ClockIcon size={12} />, title: m.contingency, help: m.contingencyHelp, time: issued });
    items.push({ id: "w", tone: "off", icon: <ClockIcon size={12} />, title: m.waiting });
  } else {
    items.push({ id: "i", tone: "ok", icon: <CheckIcon size={12} />, title: m.issued, help: docTypeLabel(doc.tipoDte, messages), time: issued });
    if (doc.selloRecibido) items.push({ id: "s", tone: "ok", icon: <CheckIcon size={12} />, title: m.sealed, help: m.sealedHelp });
    if (doc.estado === "invalidado") items.push({ id: "x", tone: "off", icon: <BanIcon size={12} />, title: m.invalidated, help: m.invalidatedHelp });
  }
  return (
    <section className="facta-d-sec">
      <h3 className="facta-d-h">{m.heading}</h3>
      <ul className="facta-tl">
        {items.map((it) => (
          <li key={it.id}>
            <span className={cx("facta-tl-dot", undefined, `facta-tl-dot--${it.tone}`)} aria-hidden>{it.icon}</span>
            <div><b>{it.title}</b>{it.help && <small>{it.help}</small>}</div>
            {it.time && <time>{it.time}</time>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetailBody({ doc }: { doc: DocumentDetail }) {
  const { messages, sp } = useCfg();
  const d = messages.data.detail;
  const void_ = doc.estado === "invalidado";
  const t = doc.totales ?? {};
  return (
    <div className="facta-d-body">
      <div className="facta-d-hero" data-void={void_ || undefined}>
        <small>{d.total}</small>
        <b {...sp("total", "facta-total facta-d-amt")}>{formatMoney(t.totalPagar)}</b>
        {(t.totalGravada !== undefined || t.totalIva !== undefined) && (
          <small>{[t.totalGravada !== undefined && `${d.taxed} ${formatMoney(t.totalGravada)}`, t.totalIva !== undefined && `${d.iva} ${formatMoney(t.totalIva)}`].filter(Boolean).join(" · ")}</small>
        )}
      </div>
      <section className="facta-d-sec">
        <h3 className="facta-d-h">{d.identifiers}</h3>
        <dl {...sp("identifiers", "facta-d-ids")}>
          <div className="facta-d-id"><dt>{d.code}</dt><dd className="facta-mono" title={doc.codigoGeneracion}>{doc.codigoGeneracion}</dd><CopyButton value={doc.codigoGeneracion} label={d.code} /></div>
          <div className="facta-d-id"><dt>{d.control}</dt><dd className="facta-mono" title={doc.numeroControl}>{doc.numeroControl}</dd><span /></div>
          {doc.selloRecibido && (
            <div className="facta-d-id"><dt>{d.seal}</dt><dd className="facta-mono" title={doc.selloRecibido}>{midTruncate(doc.selloRecibido, 14, 8)}</dd><CopyButton value={doc.selloRecibido} label={d.seal} /></div>
          )}
        </dl>
      </section>
      <section className="facta-d-sec">
        <h3 className="facta-d-h">{d.receiver}</h3>
        {doc.receptor === undefined ? (
          <div className="facta-callout facta-callout--quiet">
            <EyeOffIcon size={18} />
            <div className="facta-callout-text"><b>{d.receiverHidden}</b><span>{d.receiverHiddenHelp}</span></div>
          </div>
        ) : (
          <p className="facta-d-receiver"><b>{doc.receptor?.nombre ?? messages.data.list.finalConsumer}</b>{doc.receptor?.numDocumento && <span className="facta-mono facta-muted">{doc.receptor.numDocumento}</span>}</p>
        )}
      </section>
      <TotalsTable doc={doc} />
      {doc.observaciones && doc.observaciones.length > 0 && (
        <section className="facta-d-sec">
          <h3 className="facta-d-h">{d.observations}</h3>
          <ul className="facta-d-notes">{doc.observaciones.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </section>
      )}
      <CopiesBlock code={doc.codigoGeneracion} estado={doc.estado} />
      <Timeline doc={doc} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="facta-d-body" aria-hidden>
      <span className="facta-sk facta-sk--ctx" />
      <span className="facta-sk facta-sk--rec" />
      <span className="facta-sk facta-sk--rec" />
      <span className="facta-sk facta-sk--ctx" />
    </div>
  );
}

function useDetail(props: FactaDocumentDetailProps, messages: FactaMessages) {
  const actions = useFactaActions();
  const q = useFactaDocument(props.codigoGeneracion, { enabled: props.codigoGeneracion !== null && (props.open ?? true) });
  const doc = q.data;
  const [busy, setBusy] = useState(false);
  const canInvalidate = Boolean(props.onInvalidate) && doc?.estado === "sellado";

  async function invalidate() {
    if (!doc || !props.onInvalidate) return;
    setBusy(true);
    try {
      const token = await props.onInvalidate(doc);
      await actions.invalidate(token);
      props.onInvalidated?.();
      await q.refresh();
    } catch (error) {
      if (!(error instanceof FactaWindowError)) throw error;
    } finally {
      setBusy(false);
    }
  }

  const body = doc
    ? <DetailBody doc={doc} />
    : q.error
    ? (
      <div className="facta-d-body">
        <ErrorCallout title={messages.data.detail.error} body="" code={(q.error as { code?: string }).code} onRetry={() => void q.refresh()} retryLabel={messages.data.detail.retry} />
      </div>
    )
    : <DetailSkeleton />;
  const actionsNode = doc
    ? (
      <>
        {canInvalidate && (
          <button type="button" className="facta-btn facta-btn--danger-outline" disabled={busy} onClick={() => void invalidate()}>
            <BanIcon size={16} />{messages.data.detail.invalidate}
          </button>
        )}
        <DownloadSplit codigoGeneracion={doc.codigoGeneracion} {...(props.kinds ? { kinds: props.kinds } : {})} />
      </>
    )
    : undefined;
  return { doc, body, actionsNode };
}

/** The document in a right drawer (desktop) or a bottom sheet (phones), or inline in the page. */
export function FactaDocumentDetail(props: FactaDocumentDetailProps) {
  const [look] = splitLook(props);
  const resolved = useResolvedLook(look);
  const messages = resolved.messages;
  const { doc, body, actionsNode } = useDetail(props, messages);
  const title = doc ? `${docTypeLabel(doc.tipoDte, messages)} · ${shortDate(doc.fecEmi)}` : messages.data.detail.label;
  const subtitle = doc
    ? <><EstadoBadge estado={doc.estado} />{doc.horEmi && <span>{shortTime(doc.horEmi)}</span>}</>
    : undefined;
  if (props.presentation === "inline") {
    if (props.open === false || props.codigoGeneracion === null) return null;
    return (
      <DataRoot look={look} variant="detail" state={doc?.estado} className={props.className}>
        <section className="facta-card facta-card--inline" aria-label={messages.data.detail.label}>
          <header className="facta-header facta-header--data">
            <div className="facta-header-main">
              <h2 className="facta-title">{title}</h2>
              {subtitle && <div className="facta-header-sub">{subtitle}</div>}
            </div>
          </header>
          <div className="facta-scroll facta-scroll--data">{body}</div>
          {actionsNode && <footer className="facta-footer"><Attribution /><div className="facta-actions">{actionsNode}</div></footer>}
        </section>
      </DataRoot>
    );
  }
  return (
    <DataLayer
      look={look}
      open={(props.open ?? true) && props.codigoGeneracion !== null}
      desktop="drawer"
      step={doc?.estado ?? "loading"}
      title={title}
      subtitle={subtitle}
      closeLabel={messages.data.detail.close}
      ariaLabel={messages.data.detail.label}
      onRequestClose={() => props.onOpenChange?.(false)}
      body={body}
      actions={actionsNode}
    />
  );
}
