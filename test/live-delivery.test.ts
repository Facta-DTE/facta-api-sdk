// The live run's e-mail delivery verdict: a mail quota or provider outage only
// warns; every other delivery failure still fails the run.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  EMAIL_LIMIT_REASONS,
  emailDeliveryReportState,
  emailDeliveryVerdict,
  emailDeliveryWarningLines,
  maskedRecipientMatches,
} from "../scripts/live-delivery.mjs";
import { createValidationResults, renderLiveReport } from "../scripts/live-report.mjs";

const INBOX = "pruebas@ejemplo.com";
const settled = (channel: unknown) => ({ channel, settled: true, expectedRecipient: INBOX });

Deno.test("a reached mail quota or a provider outage is a warning, not a failure", () => {
  assertEquals([...EMAIL_LIMIT_REASONS].sort(), ["provider_unavailable", "quota_exceeded"]);
  for (const motivo of EMAIL_LIMIT_REASONS) {
    const verdict = emailDeliveryVerdict(settled({ estado: "fallido", motivo, destino: "p•••@ejemplo.com" }));
    assertEquals(verdict.outcome, "warn", motivo);
    assertEquals(verdict.code, motivo);
    // Without a reported recipient it still only warns.
    assertEquals(emailDeliveryVerdict(settled({ estado: "fallido", motivo })).outcome, "warn");
  }
});

Deno.test("the warning prints a WARNING line and a GitHub annotation without data", () => {
  const quota = emailDeliveryWarningLines({ outcome: "warn", code: "quota_exceeded" });
  assert(quota[0].startsWith("WARNING: "));
  assert(quota[1].startsWith("::warning title=E-mail delivery limit::"));
  assertStringIncludes(quota[0], "quota_exceeded");
  assertStringIncludes(emailDeliveryWarningLines({ outcome: "warn", code: "provider_unavailable" })[1], "provider_unavailable");
  assertEquals(quota.join("\n").includes(INBOX), false);
});

Deno.test("a delivered e-mail to the right inbox passes", () => {
  const verdict = emailDeliveryVerdict(settled({ estado: "enviado", destino: "p•••@ejemplo.com" }));
  assertEquals(verdict, { outcome: "pass", code: "sent", state: "enviado" });
});

Deno.test("every other delivery failure still fails the run", () => {
  for (const motivo of ["smtp_rejected", "document_rejected", "invalid_address", "outcome_unknown"]) {
    const verdict = emailDeliveryVerdict(settled({ estado: "fallido", motivo }));
    assertEquals(verdict.outcome, "fail", motivo);
    assertEquals(verdict.code, motivo);
  }
  // A limit reason under a different state is not the documented limit state.
  assertEquals(emailDeliveryVerdict(settled({ estado: "no_permitido", motivo: "quota_exceeded" })).outcome, "fail");
  assertEquals(emailDeliveryVerdict(settled({ estado: "fallido" })).code, "fallido");
  assertEquals(emailDeliveryVerdict(settled({ estado: "vencido", motivo: "token_expired" })).outcome, "fail");
});

Deno.test("API errors, malformed answers, a wrong recipient and a timeout fail", () => {
  const server = emailDeliveryVerdict({ error: Object.assign(new Error("x"), { code: "internal_error", status: 500 }) });
  assertEquals(server, { outcome: "fail", code: "internal_error", status: 500 });
  const unavailable = emailDeliveryVerdict({ error: Object.assign(new Error("x"), { code: "service_unavailable", status: 503 }) });
  assertEquals(unavailable.outcome, "fail");
  assertEquals(emailDeliveryVerdict({ error: new TypeError("PRIVATE value") }).code, "delivery_request_failed");
  assertEquals(emailDeliveryVerdict({ error: { code: "PRIVATE value with spaces" } }).code, "delivery_request_failed");

  for (const malformed of ["fallido", 42, [], { estado: 3 }, { estado: "fallido", motivo: 9 }, { estado: "Bad State!" }, { estado: "enviado", destino: 7 }]) {
    assertEquals(emailDeliveryVerdict(settled(malformed)).code, "delivery_schema_invalid", JSON.stringify(malformed));
  }
  assertEquals(emailDeliveryVerdict({ settled: true }).code, "delivery_schema_invalid");

  assertEquals(emailDeliveryVerdict(settled({ estado: "enviado", destino: "o•••@otro.com" })).code, "wrong_recipient");
  assertEquals(emailDeliveryVerdict(settled({ estado: "enviado" })).code, "wrong_recipient");
  // A wrong recipient fails even when the state alone would only warn.
  assertEquals(emailDeliveryVerdict(settled({ estado: "fallido", motivo: "quota_exceeded", destino: "o•••@otro.com" })).code, "wrong_recipient");

  assertEquals(emailDeliveryVerdict({ settled: false, expectedRecipient: INBOX }).code, "delivery_timeout");
  assertEquals(emailDeliveryVerdict({ channel: { estado: "en_proceso" }, settled: false, expectedRecipient: INBOX }).code, "delivery_timeout");
  assertEquals(emailDeliveryVerdict(settled({ estado: "pendiente" })).code, "delivery_timeout");
});

Deno.test("masked recipients match only the inbox asked for", () => {
  assert(maskedRecipientMatches("p•••@ejemplo.com", INBOX));
  assert(maskedRecipientMatches("P***@EJEMPLO.COM", INBOX));
  assert(maskedRecipientMatches("p•••@e•••.com", INBOX));
  assert(maskedRecipientMatches(INBOX, INBOX));
  assertEquals(maskedRecipientMatches("x•••@ejemplo.com", INBOX), false);
  assertEquals(maskedRecipientMatches("p•••@ejemplo.org", INBOX), false);
  assertEquals(maskedRecipientMatches("p.•@ejemplo.com", "pz@ejemplo.com"), false);
  assertEquals(maskedRecipientMatches("", INBOX), false);
});

Deno.test("the public report shows the delivery row with allowlisted states only", () => {
  const checks = createValidationResults();
  assertStringIncludes(renderLiveReport(checks), "| E-mail delivery (a mail quota or provider outage only warns) | Not checked |");
  for (const [verdict, state] of [
    [{ outcome: "warn", code: "quota_exceeded" }, "Warning (mail quota reached)"],
    [{ outcome: "warn", code: "provider_unavailable" }, "Warning (mail provider unavailable)"],
    [{ outcome: "pass", code: "sent" }, "Passed (e-mail sent)"],
    [{ outcome: "fail", code: "smtp_rejected" }, "Failed"],
  ] as const) {
    checks["email-delivery"] = emailDeliveryReportState(verdict);
    assertStringIncludes(renderLiveReport(checks), `| ${state} |`);
  }
  checks["email-delivery"] = "Not run (no test inbox configured)";
  assertStringIncludes(renderLiveReport(checks), "| Not run (no test inbox configured) |");
});
