// E-mail delivery of a playground document: the rules the server enforces.
//
// The visitor may type ANY address, so everything here exists to keep the playground from being
// used to flood a third party: Turnstile on every send (router/route), per-visitor and per-IP
// hourly/daily limits, a per-recipient daily cap shared by all visitors, one resend per document
// every 10 minutes, ownership, and a fixed message (no text from the visitor reaches the mail).
//
// WhatsApp is NEVER requested from this server: `deliveryFor` only ever builds `{ email }`.

import { sha256Hex } from "./hash.ts";

export const MAIL_HOUR_LIMIT = 5;
export const MAIL_DAY_LIMIT = 20;
export const RECIPIENT_DAY_LIMIT = 2;
export const RESEND_COOLDOWN_SECONDS = 10 * 60;
export const MAX_ADDRESS_CHARS = 254;

export class DeliveryError extends Error {
  override readonly name = "DeliveryError";
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * A deliverable address: syntax, length and no control characters, commas, semicolons or spaces
 * (one address only, no header injection). Returns the trimmed address.
 */
export function parseAddress(value: unknown): string {
  if (typeof value !== "string") throw new DeliveryError("email_invalid", "Escriba el correo al que se enviará el documento.");
  const address = value.trim();
  if (address === "" || address.length > MAX_ADDRESS_CHARS) throw new DeliveryError("email_invalid", "El correo no es válido: debe tener hasta 254 caracteres.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s,;<>()[\]\\"]/.test(address)) throw new DeliveryError("email_invalid", "El correo no es válido: escriba una sola dirección, sin espacios ni comas.");
  const match = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/.exec(address);
  if (match === null || match[1]!.startsWith(".") || match[1]!.endsWith(".") || match[1]!.includes("..")) {
    throw new DeliveryError("email_invalid", "El correo no es válido. Revise que tenga la forma nombre@dominio.com.");
  }
  return address;
}

/** The form limits are counted on: lower case, trimmed. */
export const normalizeAddress = (address: string): string => address.trim().toLowerCase();

/** `m•••@ejemplo.com`: never the whole address on screen or in a response. */
export function maskAddress(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Per-recipient counter key: a peppered hash, so the address is never stored in clear. */
export async function recipientKey(secret: string, address: string): Promise<string> {
  return `rcpt:${(await sha256Hex(`${secret}|recipient|${normalizeAddress(address)}`)).slice(0, 32)}`;
}

/** Per-IP counter key (hashed, never the address itself). */
export async function ipKey(secret: string, ip: string): Promise<string> {
  return `ip:${(await sha256Hex(`${secret}|ip|${ip}`)).slice(0, 32)}`;
}

/** Channels the server will request: the e-mail only. The only builder of `deliver` in the playground. */
export function deliveryFor(address: string): { email: string } {
  return { email: address };
}

/** Browser fields that try to name another channel; refused outright. */
export function mentionsWhatsApp(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  const text = JSON.stringify(body, (_key, value: unknown) => value).toLowerCase();
  return text.includes("whatsapp");
}

export interface MailDecision {
  allowed: boolean;
  window?: "hour" | "day" | "recipient" | "document";
  remainingHour: number;
  remainingDay: number;
  retryAfterSeconds?: number;
}

/** «Se alcanzó el límite de envíos» plus what applies and when to retry. */
export function mailMessage(decision: Pick<MailDecision, "window" | "retryAfterSeconds">): string {
  const wait = decision.retryAfterSeconds ?? 0;
  const when = wait >= 3600 ? `en ${Math.ceil(wait / 3600)} h` : `en ${Math.max(1, Math.ceil(wait / 60))} min`;
  switch (decision.window) {
    case "document": return `Se alcanzó el límite de envíos: este documento ya se envió hace poco (uno cada 10 minutos). Podrá reenviarlo ${when}.`;
    case "recipient": return "Se alcanzó el límite de envíos a esa dirección: 2 por día. Pruebe con otra dirección o mañana.";
    case "day": return `Se alcanzó el límite de envíos: ${MAIL_DAY_LIMIT} correos por día. Podrá enviar de nuevo ${when}.`;
    default: return `Se alcanzó el límite de envíos: ${MAIL_HOUR_LIMIT} correos por hora. Podrá enviar de nuevo ${when}.`;
  }
}
