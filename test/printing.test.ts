import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import type { PrintJob, PrintTransport } from "../src/printing.ts";
import type { DownloadedDocument } from "../src/types.ts";

function ticket(): DownloadedDocument {
  return {
    codigoGeneracion: "ABC-123",
    kind: "ticket",
    bytes: new Uint8Array([37, 80, 68, 70]),
    contentType: "application/pdf",
    filename: "ABC-123-ticket.pdf",
    paperWidthMm: 58,
  };
}

Deno.test("print forwards one immutable-by-copy PDF job to the selected transport", async () => {
  let calls = 0;
  const jobs: PrintJob[] = [];
  const transport: PrintTransport = {
    id: "shop-printer",
    submit: async (value) => {
      calls += 1;
      jobs.push(value);
      value.bytes[0] = 0;
      return { state: "submitted", jobId: "spool-17" };
    },
  };
  const original = ticket();
  const result = await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb" })
    .print(original, transport);
  assertEquals(calls, 1);
  assertEquals(result, {
    state: "submitted",
    transportId: "shop-printer",
    jobId: "spool-17",
  });
  assertEquals(jobs[0]?.kind, "ticket");
  assertEquals(jobs[0]?.paperWidthMm, 58);
  assertEquals(original.bytes[0], 37);
});

Deno.test("an uncertain printer acknowledgement is returned as unknown without retry", async () => {
  let calls = 0;
  const result = await new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb" })
    .print(ticket(), {
      id: "network-printer",
      submit: async () => {
        calls += 1;
        return { state: "unknown" };
      },
    });
  assertEquals(calls, 1);
  assertEquals(result.state, "unknown");
  assertEquals(result.jobId, null);
});

Deno.test("print rejects JSON, empty PDFs, invalid tickets, and empty adapter IDs", async () => {
  const facta = new Facta({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb" });
  const transport: PrintTransport = { id: "printer", submit: async () => ({ state: "submitted" }) };
  await assertRejects(() => facta.print({ ...ticket(), kind: "json", contentType: "application/json" }, transport), TypeError);
  await assertRejects(() => facta.print({ ...ticket(), bytes: new Uint8Array() }, transport), TypeError);
  await assertRejects(() => facta.print({ ...ticket(), paperWidthMm: 58.5 }, transport), TypeError);
  await assertRejects(() => facta.print(ticket(), { ...transport, id: " " }), TypeError);
});


Deno.test("runtime config supplies the default print transport", async () => {
  let submitted = 0;
  const transport: PrintTransport = {
    id: "configured-printer",
    submit: async () => { submitted += 1; return { state: "submitted" }; },
  };
  const facta = new Facta({
    apiKey: "facta_test_a.bbbbbbbbbbbbbbbb",
    runtime: { version: 1, printTransport: transport },
  });
  const result = await facta.print(ticket());
  assertEquals(submitted, 1);
  assertEquals(result.transportId, "configured-printer");
});
