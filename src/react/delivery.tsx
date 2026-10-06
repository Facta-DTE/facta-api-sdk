// «Entrega» rows: one per channel the integrator's server marked (e-mail, WhatsApp).
// A separate file on purpose, so the surrounding restyle stays easy to merge: the
// only insertion point in the result screens is `<DeliveryRows result={…} />`.

import { fill, isDeliveryLimitReason, type DeliveryView, type IssueResult } from "../browser/index.ts";
import type { DeliveryChannel, DeliveryChannelStatus } from "../types.ts";
import { useCfg } from "./look.tsx";

const CHANNELS: DeliveryChannel[] = ["correo", "whatsapp"];

type RowTone = "pending" | "ok" | "problem" | "info" | "warn";

function describe(
  channel: DeliveryChannel,
  status: DeliveryChannelStatus,
  view: DeliveryView,
  messages: ReturnType<typeof useCfg>["messages"],
): { text: string; reason?: string; tone: RowTone } {
  const m = messages.delivery;
  const name = m.channel[channel];
  switch (status.estado) {
    case "pendiente":
    case "en_proceso":
      return view.timedOut
        ? { text: m.later, tone: "info" }
        : { text: fill(m.sending, { channel: name }), tone: "pending" };
    case "enviado":
      return { text: fill(m.sent[channel], { to: status.destino ?? "" }).replace(/\s+a\s*$/, ""), tone: "ok" };
    case "fallido": {
      // A sending limit or a provider outage is not a problem with the document:
      // it is already issued, so the row is a warning that offers a way forward.
      if (isDeliveryLimitReason(status.motivo)) {
        const headline = m.reasons[status.motivo as string] ?? m.failed[channel];
        return { text: headline, ...(m.limitHelp ? { reason: m.limitHelp } : {}), tone: "warn" };
      }
      const reason = (status.motivo ? m.reasons[status.motivo] : undefined) ?? m.reasons.default;
      return { text: m.failed[channel], ...(reason ? { reason } : {}), tone: "problem" };
    }
    case "esperando_sello":
      return { text: m.states.esperando_sello ?? "", tone: "info" };
    default: {
      const text = m.states[status.estado];
      return text === undefined
        ? { text: m.failed[channel], reason: m.reasons.default ?? "", tone: "problem" }
        : { text: fill(text, { channel: name }), tone: "problem" };
    }
  }
}

const DOT: Record<RowTone, string> = { pending: "pending", ok: "saved", info: "off", problem: "problem", warn: "warn" };

/** Same markup as the «Copias» row (`facta-kv` + the status dot), so it sits in the identifiers list. */
export function DeliveryRows({ result }: { result: IssueResult }) {
  const { sp, messages } = useCfg();
  const view = result.delivery;
  if (!view) return null;
  return (
    <>
      {CHANNELS.map((channel) => {
        const status = view.canales[channel];
        if (!status) return null;
        const { text, reason, tone } = describe(channel, status, view, messages);
        return (
          <div
            key={channel}
            {...sp("deliveryRow", "facta-kv facta-delivery-row")}
            data-channel={channel}
            data-state={status.estado}
            data-tone={tone}
          >
            <dt className="facta-kv-k">{messages.delivery.label[channel]}</dt>
            <dd className="facta-kv-v facta-dd" role="status" aria-live="polite">
              <span className={`facta-storage facta-storage--${DOT[tone]}`}>
                <span className="facta-dot" aria-hidden />
                {text}
              </span>
              {reason && <small className="facta-help">{reason}</small>}
            </dd>
          </div>
        );
      })}
    </>
  );
}
