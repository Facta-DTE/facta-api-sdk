// E-mail send limits, separate from the issue quota. Pure decisions; `QuotaCounter` persists them.
//
//   visitor  5 per hour, 20 per day per visitor cookie; plus one send per document every 10 minutes
//   ip       the same 5 / 20, counted on the hashed caller IP (a new cookie does not reset it)
//   recipient 2 per day per address across ALL visitors, so nobody can flood a third party

import { consumeQuota, emptyQuota, peekQuota, type QuotaState } from "./quota.ts";
import { MAIL_DAY_LIMIT, MAIL_HOUR_LIMIT, RECIPIENT_DAY_LIMIT, RESEND_COOLDOWN_SECONDS, type MailDecision } from "./delivery.ts";

export type MailScope = "visitor" | "ip" | "recipient";

export interface MailState extends QuotaState {
  /** Last send per document (upper-case code), for the 10-minute resend cooldown. */
  docs: Record<string, number>;
}

export const emptyMail = (): MailState => ({ ...emptyQuota(), docs: {} });

const DAY_MS = 24 * 60 * 60 * 1000;

const LIMITS: Record<MailScope, { hour: number; day: number }> = {
  visitor: { hour: MAIL_HOUR_LIMIT, day: MAIL_DAY_LIMIT },
  ip: { hour: MAIL_HOUR_LIMIT, day: MAIL_DAY_LIMIT },
  recipient: { hour: RECIPIENT_DAY_LIMIT, day: RECIPIENT_DAY_LIMIT },
};

export interface MailRequest {
  key: string;
  scope: MailScope;
  /** Visitor scope only: the document this send is for. */
  doc?: string;
}

/** Count one send (or only check it, with `commit: false`). A key already counted is free. */
export function consumeMail(state: MailState, request: MailRequest, now: number, commit = true): { state: MailState; decision: MailDecision } {
  const limits = LIMITS[request.scope];
  const docs: Record<string, number> = {};
  for (const [code, at] of Object.entries(state.docs ?? {})) if (now - at < DAY_MS) docs[code] = at;
  const base = { stamps: state.stamps, keys: state.keys };
  const code = request.doc?.toUpperCase();

  if (request.scope === "visitor" && code !== undefined && !(request.key in base.keys)) {
    const last = docs[code];
    if (last !== undefined && now - last < RESEND_COOLDOWN_SECONDS * 1000) {
      const view = peekQuota(base, now, limits);
      return {
        state: { ...base, docs },
        decision: { allowed: false, window: "document", remainingHour: view.remainingHour, remainingDay: view.remainingDay, retryAfterSeconds: Math.ceil((last + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000) },
      };
    }
  }
  const step = consumeQuota(base, request.key, now, limits);
  const decision: MailDecision = { allowed: step.decision.allowed, remainingHour: step.decision.remainingHour, remainingDay: step.decision.remainingDay };
  if (!step.decision.allowed) {
    decision.window = request.scope === "recipient" ? "recipient" : step.decision.window!;
    if (step.decision.retryAfterSeconds !== undefined) decision.retryAfterSeconds = step.decision.retryAfterSeconds;
    return { state: { ...step.state, docs }, decision };
  }
  if (!commit) return { state: { ...base, docs }, decision };
  if (request.scope === "visitor" && code !== undefined) docs[code] = now;
  return { state: { ...step.state, docs }, decision };
}

export function peekMail(state: MailState, now: number, scope: MailScope = "visitor"): MailDecision {
  const view = peekQuota(state, now, LIMITS[scope]);
  return { allowed: view.allowed, remainingHour: view.remainingHour, remainingDay: view.remainingDay };
}

/** A delivery token the Worker keeps for the five minutes it is valid, so a resend can use it. */
export interface StashedToken {
  code: string;
  token: string;
  /** Epoch ms. */
  exp: number;
  masked: string;
  /** Per-recipient counter key, so a resend counts against the same address. */
  rcpt: string;
}
