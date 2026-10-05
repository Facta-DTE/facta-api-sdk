import { assertEquals } from "jsr:@std/assert@1";
import { mergeRecipient, resolveTipoDte, validateRecipient } from "../server.ts";

const CCF = {
  nombre: "Acme S.A. de C.V.",
  tipoDocumento: "36",
  numDocumento: "0614-010190-101-3",
  nrc: "123456",
  codActividad: "62010",
  descActividad: "Programación informática",
  correo: "compras@acme.test",
};

function fields(r: ReturnType<typeof validateRecipient>): string[] {
  return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.code}`).sort();
}

Deno.test("a DUI is normalised to nine digits without a dash", () => {
  const r = validateRecipient({ nombre: "Ana", tipoDocumento: "13", numDocumento: "05308546-5" }, { tipoDte: "01", policy: "optional" });
  assertEquals(r, { ok: true, recipient: { nombre: "Ana", tipoDocumento: "13", numDocumento: "053085465" } });
});

Deno.test("DUI and NIT lengths are checked", () => {
  assertEquals(fields(validateRecipient({ nombre: "Ana", tipoDocumento: "13", numDocumento: "1234" }, { tipoDte: "01", policy: "optional" })), ["numDocumento:invalid"]);
  assertEquals(fields(validateRecipient({ nombre: "Ana", tipoDocumento: "36", numDocumento: "053085465" }, { tipoDte: "01", policy: "optional" })), ["numDocumento:invalid"]);
  assertEquals(fields(validateRecipient({ nombre: "Ana", numDocumento: "053085465" }, { tipoDte: "01", policy: "optional" })), ["tipoDocumento:required"]);
  assertEquals(fields(validateRecipient({ nombre: "Ana", tipoDocumento: "99", numDocumento: "1" }, { tipoDte: "01", policy: "optional" })), ["tipoDocumento:invalid"]);
});

Deno.test("a complete credit-invoice recipient passes and the NIT loses its dashes", () => {
  const r = validateRecipient(CCF, { tipoDte: "03", policy: "required" });
  assertEquals(r.ok && r.recipient?.numDocumento, "06140101901013");
});

Deno.test("a credit invoice lists every missing field", () => {
  assertEquals(
    fields(validateRecipient({ nombre: "Acme" }, { tipoDte: "03", policy: "optional" })),
    ["codActividad:required", "correo:required", "descActividad:required", "nrc:required", "numDocumento:required", "tipoDocumento:required"],
  );
  assertEquals(fields(validateRecipient(undefined, { tipoDte: "03", policy: "optional" })).includes("nombre:required"), true);
});

Deno.test("NRC must be 1 to 8 digits", () => {
  for (const nrc of ["", "123456789", "12a4"]) {
    const r = validateRecipient({ ...CCF, nrc }, { tipoDte: "03", policy: "required" });
    assertEquals(r.ok, false);
    assertEquals(fields(r).some((f) => f.startsWith("nrc:")), true);
  }
});

Deno.test("a catalogued customer stands in for the credit-invoice fields", () => {
  const r = validateRecipient(undefined, { tipoDte: "03", policy: "optional", base: { customerId: "c1" } });
  assertEquals(r, { ok: true, recipient: null });
});

Deno.test("policy none refuses any recipient; required refuses none", () => {
  assertEquals(fields(validateRecipient({ nombre: "x" }, { tipoDte: "01", policy: "none" })), ["recipient:not_allowed"]);
  assertEquals(validateRecipient(undefined, { tipoDte: "01", policy: "none" }), { ok: true, recipient: null });
  assertEquals(fields(validateRecipient(undefined, { tipoDte: "01", policy: "required" })), ["nombre:required"]);
  assertEquals(validateRecipient(undefined, { tipoDte: "01", policy: "optional" }), { ok: true, recipient: null });
});

Deno.test("credit-only fields are dropped for a Factura and unknown keys never pass", () => {
  const r = validateRecipient({ nombre: "Ana", nrc: "12", codActividad: "62010", isAdmin: true, direccion: { x: 1 } }, { tipoDte: "01", policy: "optional" });
  assertEquals(r, { ok: true, recipient: { nombre: "Ana" } });
});

Deno.test("the recipient of an export or excluded-subject invoice is not editable", () => {
  assertEquals(fields(validateRecipient({ nombre: "x" }, { tipoDte: "11", policy: "optional" })), ["recipient:unsupported"]);
});

Deno.test("email shape and non-string values are refused", () => {
  assertEquals(fields(validateRecipient({ nombre: "Ana", correo: "nope" }, { tipoDte: "01", policy: "optional" })), ["correo:invalid"]);
  assertEquals(fields(validateRecipient({ nombre: 5 }, { tipoDte: "01", policy: "optional" })), ["nombre:invalid"]);
  assertEquals(fields(validateRecipient("Ana", { tipoDte: "01", policy: "optional" })), ["recipient:invalid"]);
});

Deno.test("tipoDte must be in allow.types unless it is the session's own", () => {
  const allow = { recipient: "optional" as const, types: ["01", "03"] as ("01" | "03")[] };
  assertEquals(resolveTipoDte("03", allow, "01"), { ok: true, tipoDte: "03" });
  assertEquals(resolveTipoDte(undefined, allow, "01"), { ok: true, tipoDte: "01" });
  assertEquals(resolveTipoDte("11", allow, "01"), { ok: false, errors: [{ field: "tipoDte", code: "not_allowed" }] });
  assertEquals(resolveTipoDte("03", { recipient: "none" }, "01"), { ok: false, errors: [{ field: "tipoDte", code: "not_allowed" }] });
  assertEquals(resolveTipoDte("zz", allow, "01"), { ok: false, errors: [{ field: "tipoDte", code: "invalid" }] });
});

Deno.test("browser fields win over the session receptor, field by field", () => {
  assertEquals(mergeRecipient({ nombre: "A", telefono: "1" }, { nombre: "B" }), { nombre: "B", telefono: "1" });
  assertEquals(mergeRecipient({ nombre: "A" }, null), { nombre: "A" });
});
