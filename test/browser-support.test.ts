import { assertEquals } from "jsr:@std/assert@1";
import { esMessages, explainError, fill, mergeMessages } from "../src/browser/messages.es.ts";
import { formatDateTime, formatMoney, lineAmount, truncateMiddle } from "../src/browser/format.ts";
import { describeFieldPath } from "../src/browser/fields.ts";
import { storageTone } from "../src/browser/storage.ts";
import { appearanceToCssVariables, mergeAppearance, resolveMotion } from "../src/browser/appearance.ts";
import { base64ToBytes } from "../src/browser/download.ts";
import { FactaErrorCode } from "../src/errors.ts";

Deno.test("format: money is $1,234.56 and survives garbage", () => {
  assertEquals(formatMoney(1234.5), "$1,234.50");
  assertEquals(formatMoney(0), "$0.00");
  assertEquals(formatMoney(1234567.891), "$1,234,567.89");
  assertEquals(formatMoney(-12), "-$12.00");
  assertEquals(formatMoney(undefined), "—");
  assertEquals(formatMoney("85.5"), "$85.50");
  assertEquals(lineAmount(3, 19.99), 59.97);
  assertEquals(lineAmount(1, undefined), null);
});

Deno.test("format: dates and identifiers", () => {
  assertEquals(formatDateTime("2026-10-05", "14:32:10"), "05/10/2026 14:32");
  assertEquals(formatDateTime("2026-10-05"), "05/10/2026");
  assertEquals(truncateMiddle("2026ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "2026ABCDEF…UVWXYZ");
  assertEquals(truncateMiddle("short"), "short");
});

Deno.test("fields: machine paths become readable labels", () => {
  assertEquals(describeFieldPath("receptor.nrc", esMessages), "NRC del receptor");
  assertEquals(describeFieldPath("cuerpoDocumento[2].precioUni", esMessages), "Precio de la línea 3");
  assertEquals(describeFieldPath("/items/0/cantidad", esMessages), "Cantidad de la línea 1");
  assertEquals(describeFieldPath("#/receptor/correo", esMessages), "Correo del receptor");
  assertEquals(describeFieldPath("observaciones", esMessages), "Observaciones del documento");
  assertEquals(describeFieldPath("raro.campoDesconocido", esMessages), "raro.campoDesconocido");
});

Deno.test("storage: copies are saved, pending or off, never an error", () => {
  assertEquals(storageTone(undefined), null);
  assertEquals(storageTone({ managed: "stored", archive: "complete" }), "saved");
  assertEquals(storageTone({ managed: null, archive: "complete", copies: { complete: 2 } }), "saved");
  assertEquals(storageTone({ archive: "partial" }), "pending");
  assertEquals(storageTone({ archive: "complete", copies: { pending: 1 } }), "pending");
  assertEquals(storageTone({ managed: "failed", archive: "off" }), "pending");
  assertEquals(storageTone({ managed: "not_configured", archive: "off" }), "off");
});

Deno.test("appearance: variables map to --facta-* and layers merge", () => {
  assertEquals(appearanceToCssVariables({ accent: "#0a0", fontFamily: "Inter", radius: "16px" }), {
    "--facta-accent": "#0a0",
    "--facta-font": "Inter",
    "--facta-radius": "16px",
  });
  assertEquals(appearanceToCssVariables(undefined), {});
  const merged = mergeAppearance({ theme: "dark", variables: { accent: "#111", radius: "4px" } }, { variables: { accent: "#222" }, density: "compact" });
  assertEquals(merged, { theme: "dark", density: "compact", variables: { accent: "#222", radius: "4px" } });
  assertEquals(resolveMotion("full", true), "reduced");
  assertEquals(resolveMotion("none", true), "none");
  assertEquals(resolveMotion(undefined, false), "full");
});

Deno.test("messages: override is merged, placeholders filled, every error code has a Spanish text", () => {
  const merged = mergeMessages({ review: { issue: "Pagar y emitir" }, errors: { rate_limited: "Espere." } });
  assertEquals(merged.review.issue, "Pagar y emitir");
  assertEquals(merged.review.cancel, esMessages.review.cancel);
  assertEquals(merged.errors.rate_limited, "Espere.");
  assertEquals(merged.errors.mh_rejected, esMessages.errors.mh_rejected);
  assertEquals(esMessages.review.issue, "Emitir factura");
  assertEquals(fill("Paso {n} de 3: {label}", { n: 2, label: "Firmando" }), "Paso 2 de 3: Firmando");
  assertEquals(explainError("nope"), esMessages.genericError);

  // Keep the table honest against the SDK's own code list.
  const sdkCodes: FactaErrorCode[] = [
    "unauthorized", "invalid_api_key", "key_revoked", "key_expired", "key_inactive", "forbidden_scope",
    "dte_type_not_allowed", "ip_not_allowed", "environment_not_allowed", "sign_key_required",
    "sign_key_invalid", "sign_vault_locked", "sign_vault_missing", "invalid_request", "validation_failed",
    "not_found", "method_not_allowed", "idempotency_key_required", "idempotency_key_reuse",
    "idempotency_in_flight", "prepare_token_invalid", "rate_limited", "amount_limit", "mh_rejected",
    "mh_unreachable", "correlative_unavailable", "service_unavailable", "no_storage_destination",
    "storage_unsupported", "storage_unavailable", "storage_contract_invalid", "internal_error",
    "operation_outcome_unknown", "archive_integrity_error", "network_error",
    "session_invalid", "session_expired", "action_not_allowed", "bad_request",
  ] as never;
  for (const code of sdkCodes) assertEquals(typeof esMessages.errors[code], "string", code);
});

Deno.test("messages: no voseo or tuteo slipped into the Spanish copy", () => {
  const text = JSON.stringify(esMessages);
  for (const word of [" vos ", "tenés", "podés", "querés", "hacé", "ingresá", "revisá", " tu ", " tus ", "tienes", "puedes", "ingresa "]) {
    assertEquals(text.includes(word), false, word);
  }
});

Deno.test("download: base64 decodes to bytes", () => {
  assertEquals(Array.from(base64ToBytes("JVBERi0=")), [37, 80, 68, 70, 45]);
});
