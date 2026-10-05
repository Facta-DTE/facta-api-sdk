import { useCallback, useEffect, useRef, useState } from "react";
import {
  explainError,
  fill,
  formatMoney,
  FactaClientError,
  type DocumentDetail,
  type InvalidationInfo,
  type InvalidationOutcome,
} from "../browser/index.ts";
import { AlertIcon, CheckIcon, ClockIcon, SealGlyph, Spinner } from "./icons.tsx";
import { CopyButton } from "./parts.tsx";
import { useCfg, useResolvedLook, type FactaLook } from "./look.tsx";
import { BanIcon, DataLayer, LockIcon, docTypeLabel, midTruncate, shortDate, shortTime, splitLook } from "./data-parts.tsx";
import { useDataContext } from "./data-hooks.ts";

export interface FactaInvalidateDialogProps extends FactaLook {
  /** The token your server made with `createFactaInvalidationSession`. */
  session: string;
  open: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** Called once Hacienda accepted the invalidation (or it was already invalidated). */
  onInvalidated?: ((outcome: InvalidationOutcome) => void) | undefined;
  onError?: ((error: FactaClientError) => void) | undefined;
  /** Adds «Ver detalle» to the success screen. */
  onViewDetail?: ((codigoGeneracion: string) => void) | undefined;
}

type Stage =
  | { name: "loading" }
  | { name: "confirm"; info: InvalidationInfo }
  | { name: "progress"; info: InvalidationInfo; step: 1 | 2 }
  | { name: "success"; info: InvalidationInfo; outcome: InvalidationOutcome; at: Date }
  | { name: "error"; info: InvalidationInfo | null; error: FactaClientError | Error }
  | { name: "expired" };

function personLine(p: { nombre: string; tipoDocumento: string; numDocumento: string }) {
  return (
    <span>
      {p.nombre}
      <small>{p.tipoDocumento === "13" ? "DUI" : p.tipoDocumento === "36" ? "NIT" : p.tipoDocumento} {p.numDocumento}</small>
    </span>
  );
}

function Summary({ doc, codigoGeneracion }: { doc: DocumentDetail | null; codigoGeneracion: string }) {
  const { messages } = useCfg();
  if (!doc) return <div className="facta-sum"><span className="facta-mono">{midTruncate(codigoGeneracion, 8, 6)}</span></div>;
  return (
    <div className="facta-sum">
      <b>{docTypeLabel(doc.tipoDte, messages)} · {shortDate(doc.fecEmi)} {shortTime(doc.horEmi)}</b>
      <span className="facta-sum-total facta-amount">{formatMoney(doc.totales?.totalPagar)}</span>
      <span className="facta-mono facta-muted" title={doc.numeroControl}>{midTruncate(doc.numeroControl, 15, 6)}</span>
    </div>
  );
}

/**
 * Confirms an invalidation your server prepared. Nothing in it can be edited:
 * the type, the replacement, the reason and the two people come from the token.
 */
export function FactaInvalidateDialog(props: FactaInvalidateDialogProps) {
  const [look] = splitLook(props);
  const resolved = useResolvedLook(look);
  const messages = resolved.messages;
  const m = messages.data.invalidate;
  const { client, cache } = useDataContext();
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; clearTimeout(timer.current); }, []);

  const load = useCallback(async () => {
    setStage({ name: "loading" });
    try {
      const info = await client.describeInvalidation(props.session);
      if (live.current) setStage({ name: "confirm", info });
    } catch (error) {
      if (!live.current) return;
      if (error instanceof FactaClientError && error.code === "session_expired") setStage({ name: "expired" });
      else setStage({ name: "error", info: null, error: error as Error });
    }
  }, [client, props.session]);

  useEffect(() => {
    if (props.open) void load();
  }, [props.open, load]);

  async function submit(info: InvalidationInfo) {
    setStage({ name: "progress", info, step: 1 });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (stageRef.current.name === "progress") setStage({ name: "progress", info, step: 2 });
    }, resolved.motion === "none" ? 0 : 600);
    try {
      const outcome = await client.invalidate(props.session);
      clearTimeout(timer.current);
      if (!live.current) return;
      cache.invalidate("doc:");
      cache.invalidate("docs:");
      setStage({ name: "success", info, outcome, at: new Date() });
      props.onInvalidated?.(outcome);
    } catch (error) {
      clearTimeout(timer.current);
      if (!live.current) return;
      if (error instanceof FactaClientError) props.onError?.(error);
      setStage({ name: "error", info, error: error as Error });
    }
  }

  const busy = stage.name === "progress";
  const close = () => { if (!busy) props.onOpenChange?.(false); };
  const done = <button type="button" className="facta-btn facta-btn--primary" onClick={close}>{m.close}</button>;

  let title: string = m.confirm.title;
  let subtitle: string | undefined = m.confirm.body;
  let glyph: React.ReactNode = <BanIcon size={20} />;
  let tone: "danger" | "success" = "danger";
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (stage.name === "loading") {
    subtitle = undefined;
    body = <div className="facta-dlg-body" role="status" aria-label={m.loading}><span className="facta-sk facta-sk--ctx" /><span className="facta-sk facta-sk--rec" /><span className="facta-sk facta-sk--rec" /></div>;
  } else if (stage.name === "expired") {
    title = m.error.title;
    subtitle = undefined;
    glyph = <AlertIcon size={20} />;
    body = <div className="facta-dlg-body"><div className="facta-callout facta-callout--warning facta-callout--row" role="alert"><ClockIcon size={18} /><div className="facta-callout-text"><span>{m.expired}</span></div></div></div>;
    actions = done;
  } else if (stage.name === "confirm" || stage.name === "progress") {
    const { info } = stage;
    const inv = info.invalidation;
    if (stage.name === "progress") {
      title = m.progress.title;
      subtitle = m.progress.body;
    }
    const steps: Array<[string, "done" | "now" | "wait"]> = stage.name === "progress"
      ? [
        [m.steps.signing, stage.step === 1 ? "now" : "done"],
        [m.steps.sending, stage.step === 1 ? "wait" : "now"],
        [m.steps.saving, "wait"],
      ]
      : [];
    body = (
      <div className="facta-dlg-body">
        <Summary doc={info.document} codigoGeneracion={inv.codigoGeneracion} />
        {stage.name === "confirm" ? (
          <>
            <div className="facta-ro" role="group" aria-label={m.readOnly}>
              <div className="facta-ro-lock"><LockIcon size={14} />{m.readOnly}</div>
              <dl>
                <div><dt>{m.type}</dt><dd><b>{inv.tipoAnulacion}</b> · {m.types[String(inv.tipoAnulacion) as "1" | "2" | "3"]}</dd></div>
                {inv.codigoGeneracionReemplazo && <div><dt>{m.replacement}</dt><dd className="facta-mono">{inv.codigoGeneracionReemplazo}</dd></div>}
                {inv.motivo && <div><dt>{m.reason}</dt><dd>{inv.motivo}</dd></div>}
                <div><dt>{m.responsible}</dt><dd>{personLine(inv.responsable)}</dd></div>
                <div><dt>{m.requester}</dt><dd>{personLine(inv.solicita)}</dd></div>
              </dl>
            </div>
            <div className="facta-callout facta-callout--danger facta-callout--row">
              <AlertIcon size={18} />
              <div className="facta-callout-text"><b>{m.irreversible.title}</b><span>{m.irreversible.body}</span></div>
            </div>
          </>
        ) : (
          <ol className="facta-steps-list" aria-label={m.progress.title}>
            {steps.map(([label, st]) => (
              <li key={label} data-step-state={st}>
                <span className="facta-steps-c" aria-hidden>{st === "done" ? <CheckIcon size={14} /> : st === "now" ? <Spinner size={14} /> : <ClockIcon size={14} />}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
    actions = (
      <>
        <button type="button" className="facta-btn" disabled={busy} onClick={close}>{m.cancel}</button>
        <button type="button" className="facta-btn facta-btn--danger" disabled={busy} onClick={() => void submit(info)}>
          {busy ? <><Spinner size={16} />{m.working}</> : m.submit}
        </button>
      </>
    );
  } else if (stage.name === "success") {
    const when = new Intl.DateTimeFormat("es-SV", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/El_Salvador" }).format(stage.at);
    title = m.success.title;
    subtitle = fill(m.success.body, { date: when.replace(",", " a las") });
    glyph = <CheckIcon size={20} />;
    tone = "success";
    const seal = stage.outcome.evento?.selloRecibido;
    body = (
      <div className="facta-dlg-body">
        <Summary doc={stage.info.document} codigoGeneracion={stage.info.invalidation.codigoGeneracion} />
        {seal && (
          <div className="facta-seal-box">
            <SealGlyph size={20} />
            <div className="facta-seal-tx"><small>{m.eventSeal}</small><div className="facta-mono" title={seal}>{seal}</div></div>
            <CopyButton value={seal} label={m.eventSeal} />
          </div>
        )}
      </div>
    );
    actions = (
      <>
        {props.onViewDetail && <button type="button" className="facta-btn" onClick={() => props.onViewDetail!(stage.outcome.codigoGeneracion)}>{m.viewDetail}</button>}
        {done}
      </>
    );
  } else {
    const err = stage.error;
    const known = err instanceof FactaClientError ? err : null;
    title = m.error.title;
    subtitle = m.error.body;
    glyph = <AlertIcon size={20} />;
    const rejected = known && !known.transport && known.observaciones.length + (known.code === "mh_rejected" ? 1 : 0) > 0;
    body = (
      <div className="facta-dlg-body">
        {stage.info && <Summary doc={stage.info.document} codigoGeneracion={stage.info.invalidation.codigoGeneracion} />}
        <div className="facta-callout facta-callout--danger facta-callout--row" role="alert">
          <AlertIcon size={18} />
          <div className="facta-callout-text">
            <b>{rejected ? m.error.hacienda : known ? explainError(known.code, messages) : messages.genericError}</b>
            {rejected && (known!.observaciones.length > 0 ? known!.observaciones : [known!.message]).map((o, i) => <span key={i} className="facta-mono facta-quote-line">{o}</span>)}
            {known && !rejected && <span className="facta-mono facta-code">{known.code}</span>}
          </div>
        </div>
      </div>
    );
    const retryable = known && (known.transport || known.retryable) && stage.info;
    actions = (
      <>
        {retryable && <button type="button" className="facta-btn" onClick={() => void submit(stage.info!)}>{messages.failed.retry}</button>}
        <button type="button" className="facta-btn facta-btn--primary" onClick={close}>{m.understood}</button>
      </>
    );
  }

  return (
    <DataLayer
      look={look}
      open={props.open}
      desktop="dialog"
      step={stage.name}
      title={title}
      subtitle={subtitle}
      glyph={glyph}
      glyphTone={tone}
      canClose={!busy}
      closeLabel={messages.closeLabel}
      ariaLabel={m.label}
      onRequestClose={close}
      body={body}
      actions={actions}
    />
  );
}
