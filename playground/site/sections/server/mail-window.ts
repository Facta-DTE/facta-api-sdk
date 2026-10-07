// Pure rules of «Entregar por correo, en dos llamadas»: what the issue stage handed back, how long the
// delivery token has left, and when the second call may be started. No React, no clock of its own.

/** What the issue stage puts in `result.entrega` (redaction keeps `token` there and nowhere else). */
export interface DeliveryOfferView {
  token?: string;
  venceEn: string | null;
  canales: Record<string, { estado?: string; destino?: string | null } | undefined>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Reads `entrega` from an issue-stage result. Null when the result has none. */
export function offerOf(result: unknown): DeliveryOfferView | null {
  if (!isRecord(result) || !isRecord(result.entrega)) return null;
  const e = result.entrega;
  const token = typeof e.token === "string" && e.token !== "" ? e.token : undefined;
  return {
    ...(token === undefined ? {} : { token }),
    venceEn: typeof e.venceEn === "string" ? e.venceEn : null,
    canales: isRecord(e.canales) ? (e.canales as DeliveryOfferView["canales"]) : {},
  };
}

/** Whole seconds until `venceEn`, never negative; null when there is no expiry to count to. */
export function secondsLeft(venceEn: string | null, now: number): number | null {
  if (venceEn === null) return null;
  const at = Date.parse(venceEn);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** `4:32`. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface SendGateInput {
  /** The offer from call 1, or null before it ran. */
  offer: DeliveryOfferView | null;
  now: number;
  busy: boolean;
  /** Visitor signed in and the Turnstile (when on) solved. */
  ready: boolean;
  /** The run that issued carries a hand-over for the send. */
  hasContinuation: boolean;
}

export interface SendGate { enabled: boolean; reason: string | null; expired: boolean }

/** «Enviar el correo» is on only while a token from call 1 is alive; otherwise it says why it is off. */
export function sendGate({ offer, now, busy, ready, hasContinuation }: SendGateInput): SendGate {
  if (offer === null) return { enabled: false, reason: "Primero emita la factura (llamada 1): de ahí sale el token.", expired: false };
  if (offer.token === undefined) {
    return { enabled: false, reason: "Sin token de entrega: el correo se enviará cuando Hacienda confirme el documento.", expired: false };
  }
  const left = secondsLeft(offer.venceEn, now);
  if (left !== null && left <= 0) return { enabled: false, reason: "El token venció. Emita otra factura para probar de nuevo.", expired: true };
  if (!hasContinuation) return { enabled: false, reason: "Emita la factura de nuevo: ya no hay un envío pendiente.", expired: false };
  if (busy) return { enabled: false, reason: null, expired: false };
  if (!ready) return { enabled: false, reason: "Complete la verificación para continuar.", expired: false };
  return { enabled: true, reason: null, expired: false };
}

/** A send that failed because the token died (the API answers `entrega_vencida`, HTTP 410). */
export const isExpiredDelivery = (error: { code?: string; status?: number } | undefined | null): boolean =>
  error?.code === "entrega_vencida" || error?.code === "delivery_window_closed" || error?.status === 410;

/** What the second call returned: the channel state and the file names the receiver gets. */
export interface SendSummary {
  destino: string | null;
  solicitado: string | null;
  estado: string | null;
  actualizado: string | null;
  settled: boolean | null;
  adjuntos: string[];
}

export function summaryOf(result: unknown, code: string | null): SendSummary | null {
  if (!isRecord(result)) return null;
  const channel = isRecord(result.channel) ? result.channel : null;
  const delivery = isRecord(result.delivery) ? result.delivery : null;
  const canales = delivery !== null && isRecord(delivery.canales) ? delivery.canales : null;
  const correo = canales !== null && isRecord(canales.correo) ? canales.correo : null;
  const final = correo ?? channel;
  const name = code ?? (typeof result.codigoGeneracion === "string" ? result.codigoGeneracion : null);
  return {
    destino: typeof result.destino === "string" ? result.destino : null,
    solicitado: channel !== null && typeof channel.estado === "string" ? channel.estado : null,
    estado: final !== null && typeof final.estado === "string" ? final.estado : null,
    actualizado: final !== null && typeof final.actualizado === "string" ? final.actualizado : null,
    settled: delivery !== null && typeof delivery.settled === "boolean" ? delivery.settled : null,
    adjuntos: name === null ? [] : [`${name}.json`, `${name}.pdf`],
  };
}
