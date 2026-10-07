// The compact receipt card for lists and history (board section 7): badge,
// document name and date, status pill, total, identifiers, downloads.

import { fill, formatDateTime, formatMoney, type Environment, type IssueResult } from "../browser/index.ts";
import { CheckIcon, ClockIcon, SealGlyph } from "./icons.tsx";
import { DeliveryRows } from "./delivery.tsx";
import { FactaRoot, useCfg, type FactaLook } from "./look.tsx";
import { Downloads, EmergencyNotice, IdRow, ObservationsList, StorageRow } from "./parts.tsx";

export interface FactaReceiptProps extends FactaLook {
  /** A sealed (or contingency) result you already hold, e.g. from `onIssued`. */
  result: IssueResult;
  /** Shows the «Pruebas» chip for `"00"`. */
  environment?: Environment | null | undefined;
  /** Your order reference («#1042»); printed as «Factura · Pedido #1042». */
  reference?: string | undefined;
  /** Also offers «JSON original (raw)», the stored original. Off by default. */
  rawJson?: boolean | undefined;
  className?: string | undefined;
}

function ReceiptCard({ result, environment, reference, rawJson }: Pick<FactaReceiptProps, "result" | "environment" | "reference" | "rawJson">) {
  const { sp, cx, messages, showStorage } = useCfg();
  const sealed = result.estado === "sellado";
  const tone = sealed ? "success" : "warning";
  const total = result.totales?.totalPagar;
  const kind = messages.docTypes[result.tipoDte] ?? messages.sealed.headline;
  const title = reference ? `${kind} · ${fill(messages.review.reference, { reference })}` : kind;
  const m = messages.sealed;
  return (
    <article className={cx("facta-receipt")} aria-label={title} data-tone={tone}>
      <div className="facta-receipt-top">
        <span className={`facta-stamp facta-stamp--md facta-tone-${tone}`} aria-hidden>
          {sealed ? <SealGlyph size={22} /> : <ClockIcon size={22} />}
        </span>
        <div className="facta-receipt-title">
          <b>{title}</b>
          <span className="facta-sub">
            {formatDateTime(result.fecEmi, result.horEmi)}
            {environment === "00" && <span {...sp("chip", "facta-chip facta-receipt-chip")}>{messages.chipTest}</span>}
          </span>
        </div>
        <span className={`facta-pill facta-tone-${tone}`}>
          {sealed ? <CheckIcon size={14} strokeWidth={2.6} /> : <ClockIcon size={14} />}
          {sealed ? messages.receipt.sealedPill : messages.status.contingencia}
        </span>
      </div>
      {typeof total === "number" && (
        <div className="facta-receipt-total">
          <span className="facta-sub">{m.total}</span>
          <b {...sp("total", "facta-total")}>{formatMoney(total)}</b>
        </div>
      )}
      <EmergencyNotice result={result} />
      <dl {...sp("identifiers", "facta-block facta-details")}>
        <IdRow label={m.controlNumber} value={result.numeroControl} copy={false} />
        <IdRow label={m.generationCode} value={result.codigoGeneracion} />
        {showStorage && <StorageRow result={result} />}
        <DeliveryRows result={result} />
      </dl>
      <ObservationsList result={result} />
      <Downloads result={result} rawJson={rawJson} />
    </article>
  );
}

/** Renders a finished document (past or present) without any network call. */
export function FactaReceipt({ result, environment, reference, rawJson, className, ...look }: FactaReceiptProps) {
  return (
    <FactaRoot look={look} className={className} state={result.estado === "sellado" ? "sealed" : "contingency"} run="manual" variant="receipt">
      <ReceiptCard result={result} environment={environment} reference={reference} rawJson={rawJson} />
    </FactaRoot>
  );
}
