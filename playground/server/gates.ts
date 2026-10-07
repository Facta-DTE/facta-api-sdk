// The cost gates in front of every action that spends something: the issue quota and the e-mail
// limits, each counted on the visitor cookie AND on the hashed caller IP (and, for mail, on the
// recipient). All state lives in Durable Objects (quota.ts); nothing here stores an address or an IP.

import type { DurableObjectNamespaceLike, PlaygroundEnv } from "./env.ts";
import { ipKey, type MailDecision } from "./delivery.ts";
import type { QuotaDecision } from "./quota.ts";
import type { MailScope } from "./mail-quota.ts";
import type { StashedToken } from "./mail-quota.ts";

export interface Caller {
  /** `Visitor.id`. */
  visitorId: string;
  /** `cf-connecting-ip`, or null when the request has none (local development). */
  ip: string | null;
}

type Stub = { fetch(request: Request): Promise<Response> };

function stubOf(namespace: DurableObjectNamespaceLike | undefined, name: string): Stub {
  if (!namespace) throw new Error("gates need the QUOTA Durable Object binding.");
  return namespace.get(namespace.idFromName(name.toLowerCase()));
}

const post = (stub: Stub, path: string, body: unknown) =>
  stub.fetch(new Request(`https://quota${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** The counters one action touches, in the order they are tried: IP first, then the visitor. */
async function ipName(env: PlaygroundEnv, caller: Caller): Promise<string | null> {
  return caller.ip === null ? null : ipKey(env.FACTA_SESSION_SECRET ?? "", caller.ip);
}

/**
 * Count one issue under `key` for the IP and the visitor. Null when a counter cannot answer.
 * `commit: false` only checks (nothing is counted): the gate before the call. The count itself
 * happens once the document is sealed or in contingency, never for a failure.
 */
export async function consumeIssue(env: PlaygroundEnv, caller: Caller, key: string, commit = true): Promise<QuotaDecision | null> {
  const names = [await ipName(env, caller), caller.visitorId].filter((n): n is string => n !== null);
  let last: QuotaDecision | null = null;
  for (const name of names) {
    const response = await post(stubOf(env.QUOTA, name), "/consume", { key, commit });
    if (!response.ok) return null;
    const decision = (await response.json()) as QuotaDecision;
    if (!decision.allowed) return decision;
    last = decision;
  }
  return last;
}

export interface MailCheck {
  caller: Caller;
  /** Unique per send attempt; a replay of the same key is free. */
  key: string;
  /** `recipientKey(...)`: the hashed address, never the address. */
  recipient: string;
  /** The document this send is for (resend cooldown). */
  doc?: string;
  /** False: only check, count nothing (the pre-flight at session creation). */
  commit?: boolean;
}

/** Count one e-mail send on the IP, the visitor and the recipient. The first refusal wins. */
export async function consumeMail(env: PlaygroundEnv, check: MailCheck): Promise<MailDecision | null> {
  const targets: Array<{ name: string; scope: MailScope; doc?: string }> = [];
  const ip = await ipName(env, check.caller);
  if (ip !== null) targets.push({ name: ip, scope: "ip" });
  targets.push({ name: check.caller.visitorId, scope: "visitor", ...(check.doc === undefined ? {} : { doc: check.doc }) });
  targets.push({ name: check.recipient, scope: "recipient" });
  let visitorView: MailDecision | null = null;
  for (const target of targets) {
    const response = await post(stubOf(env.QUOTA, target.name), "/mail/consume", {
      key: check.key,
      scope: target.scope,
      ...(target.doc === undefined ? {} : { doc: target.doc }),
      commit: check.commit !== false,
    });
    if (!response.ok) return null;
    const decision = (await response.json()) as MailDecision;
    if (!decision.allowed) return decision;
    if (target.scope === "visitor") visitorView = decision;
  }
  return visitorView;
}

export async function peekMail(env: PlaygroundEnv, visitorId: string): Promise<MailDecision | null> {
  try {
    const response = await stubOf(env.QUOTA, visitorId).fetch(new Request("https://quota/mail/peek"));
    return response.ok ? ((await response.json()) as MailDecision) : null;
  } catch {
    return null;
  }
}

export async function stashToken(env: PlaygroundEnv, visitorId: string, token: StashedToken): Promise<void> {
  await post(stubOf(env.QUOTA, visitorId), "/mail/token", token);
}

export async function readStashedToken(env: PlaygroundEnv, visitorId: string, code: string): Promise<StashedToken | null> {
  const response = await stubOf(env.QUOTA, visitorId).fetch(new Request(`https://quota/mail/token?code=${encodeURIComponent(code)}`));
  return response.ok ? ((await response.json()) as { token: StashedToken | null }).token : null;
}
