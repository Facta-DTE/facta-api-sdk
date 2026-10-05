// «Entrega» rows: one per channel the integrator's server marked (e-mail, WhatsApp).
// A separate file on purpose, so the surrounding restyle stays easy to merge: the
// only insertion point in the result screens is `<DeliveryRows result={…} />`.

import { fill, type DeliveryView, type IssueResult } from "../browser/index.ts";
import type { DeliveryChannel, DeliveryChannelStatus } from "../types.ts";
import { Spinner } from "./icons.tsx";
import { useCfg } from "./look.tsx";

const CHANNELS: DeliveryChannel[] = ["correo", "whatsapp"];

type RowTone = "pending" | "ok" | "problem" | "info";

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

/** The `<div>` rows are valid children of the `<dl>` that `Identifiers` renders. */
export function DeliveryRows({ result }: { result: IssueResult }) {
  const { cx, messages } = useCfg();
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
            className={cx("facta-row facta-delivery-row", "deliveryRow", `facta-delivery--${tone}`)}
            data-facta-slot="deliveryRow"
            data-channel={channel}
            data-state={status.estado}
          >
            <dt>{messages.delivery.label[channel]}</dt>
            <dd role="status" aria-live="polite">
              {tone === "pending" && <Spinner size={14} />}
              <span className="facta-delivery-text">{text}{reason ? ` · ${reason}` : ""}</span>
            </dd>
          </div>
        );
      })}
    </>
  );
}
