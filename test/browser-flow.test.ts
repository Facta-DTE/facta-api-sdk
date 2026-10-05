import { assert, assertEquals } from "jsr:@std/assert@1";
import { FactaClientError, type FactaClient } from "../src/browser/client.ts";
import { createIssueFlow, type IssueFlow } from "../src/browser/flow.ts";
import type { IssueSummary, SessionInfo, StatusSummary } from "../src/browser/wire.ts";

const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();

function info(patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    draft: { tipoDte: "01", items: [{ descripcion: "Consultoría", cantidad: 2, precioUni: 50 }] },
    environment: "00",
    expiresAt: FUTURE,
    ...patch,
  };
}

const sealed: IssueSummary = {
  estado: "sellado",
  codigoGeneracion: "CG-1",
  numeroControl: "DTE-01-M001P001-000000000000001",
  tipoDte: "01",
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "10:00:00",
  selloRecibido: "2026ABC",
  totales: { totalPagar: 100 },
};

type Script<T> = Array<T | Error>;

function fakeClient(script: { describe?: SessionInfo | Error; issue?: Script<IssueSummary>; status?: Script<StatusSummary> }) {
  const calls: Array<{ action: string; args: unknown[] }> = [];
  const next = <T>(name: string, list: Script<T> | undefined): Promise<T> => {
    const item = list?.shift();
    if (item === undefined) return Promise.reject(new Error(`script exhausted for ${name}`));
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
  };
  const client: FactaClient = {
    describe(...args) {
      calls.push({ action: "describe", args });
      return script.describe instanceof Error ? Promise.reject(script.describe) : Promise.resolve(script.describe ?? info());
    },
    issue(...args) {
      calls.push({ action: "issue", args });
      return next("issue", script.issue);
    },
    status(...args) {
      calls.push({ action: "status", args });
      return next("status", script.status);
    },
  };
  return { client, calls };
}

function flowFor(client: FactaClient, extra: Partial<Parameters<typeof createIssueFlow>[0]> = {}): IssueFlow {
  return createIssueFlow({ client, session: "tok", sleep: () => Promise.resolve(), phaseDelaysMs: [60_000, 120_000], ...extra });
}

const netError = () =>
  new FactaClientError({ code: "network_error", message: "offline", status: 0, retryable: true, transport: true });

const envelope = (code: string, init: Partial<ConstructorParameters<typeof FactaClientError>[0]> = {}) =>
  new FactaClientError({ code, message: code, status: 422, retryable: false, transport: false, ...init });

const spentOutage = () =>
  envelope("mh_unreachable", {
    status: 502,
    retryable: true,
    spent: { codigoGeneracion: "CG-1", numeroControl: "NC" },
    statusToken: "st-1",
  });

const count = (calls: Array<{ action: string }>, action: string) => calls.filter((c) => c.action === action).length;

Deno.test("flow: loading -> review -> issuing -> sealed", async () => {
  const { client, calls } = fakeClient({ issue: [sealed] });
  const flow = flowFor(client);
  const seen: string[] = [];
  flow.subscribe((s) => { if (seen.at(-1) !== s.step) seen.push(s.step); });
  assertEquals(flow.getState().step, "loading");
  await flow.start();
  assertEquals(flow.getState().step, "review");
  await flow.next();
  assertEquals(seen, ["loading", "review", "issuing", "sealed"]);
  assertEquals(flow.getState().result?.numeroControl, sealed.numeroControl);
  assertEquals(calls.map((c) => c.action), ["describe", "issue"]);
  assertEquals(calls[1]!.args, ["tok"]);
  flow.destroy();
});

Deno.test("flow: run=auto issues as soon as the session loads", async () => {
  const { client, calls } = fakeClient({ issue: [sealed] });
  const flow = flowFor(client, { run: "auto" });
  await flow.start();
  assertEquals(flow.getState().step, "sealed");
  assertEquals(calls.map((c) => c.action), ["describe", "issue"]);
});

Deno.test("flow: next() outside the review step does nothing", async () => {
  const { client, calls } = fakeClient({ issue: [sealed] });
  const flow = flowFor(client);
  await flow.next();
  assertEquals(calls.length, 0);
});

Deno.test("flow: contingency is a success state", async () => {
  const { client } = fakeClient({ issue: [{ ...sealed, estado: "contingencia", detalle: "MH sin servicio" }] });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().step, "contingency");
  assertEquals(flow.getState().error, null);
});

Deno.test("flow: an uncertain outcome resends the SAME session, never a fresh retry", async () => {
  const { client, calls } = fakeClient({ issue: [netError(), sealed] });
  const flow = flowFor(client);
  const steps: string[] = [];
  flow.subscribe((s) => steps.push(s.step));
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().step, "sealed");
  assert(steps.includes("verifying"));
  const issues = calls.filter((c) => c.action === "issue");
  assertEquals(issues.length, 2);
  assertEquals(issues[0]!.args, issues[1]!.args);
});

Deno.test("flow: after two failed resends it asks status (not a third fresh attempt)", async () => {
  const { client, calls } = fakeClient({
    issue: [spentOutage(), spentOutage(), spentOutage()],
    status: [{ estado: "sellado", codigoGeneracion: "CG-1", numeroControl: "NC", tipoDte: "01", ambiente: "00", fecEmi: "2026-10-05", selloRecibido: "S" }],
  });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(count(calls, "issue"), 3);
  assertEquals(count(calls, "status"), 1);
  assertEquals(calls.find((c) => c.action === "status")!.args, ["tok", "CG-1", "st-1"]);
  assertEquals(flow.getState().step, "sealed");
  assertEquals(flow.getState().result?.selloRecibido, "S");
});

Deno.test("flow: status «rechazado» ends in the rejected screen", async () => {
  const { client } = fakeClient({
    issue: [spentOutage(), spentOutage(), spentOutage()],
    status: [{ estado: "rechazado", codigoGeneracion: "CG-1", numeroControl: "NC", tipoDte: "01", ambiente: "00", fecEmi: "2026-10-05", observaciones: ["[receptor.nit] FORMATO INVALIDO"] }],
  });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().step, "rejected");
  assertEquals(flow.getState().error?.observaciones, ["[receptor.nit] FORMATO INVALIDO"]);
});

Deno.test("flow: without a status token the window never guesses a status call", async () => {
  const { client, calls } = fakeClient({ issue: [netError(), netError(), netError()] });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(count(calls, "status"), 0);
  assertEquals(flow.getState().step, "failed");
});

Deno.test("flow: unresolved uncertainty is a failure with NO retry offered", async () => {
  const { client, calls } = fakeClient({ issue: [netError(), netError(), netError()] });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  const s = flow.getState();
  assertEquals(s.step, "failed");
  assertEquals(s.error?.uncertain, true);
  assertEquals(s.error?.canRetry, false);
  await flow.retry();
  assertEquals(count(calls, "issue"), 3);
});

Deno.test("flow: a 5xx envelope without spent:false is uncertain; spent:false is definitive", async () => {
  const a = fakeClient({ issue: [envelope("internal_error", { status: 500, retryable: true }), sealed] });
  const flowA = flowFor(a.client);
  await flowA.start();
  await flowA.next();
  assertEquals(flowA.getState().step, "sealed");
  assertEquals(count(a.calls, "issue"), 2);

  const b = fakeClient({ issue: [envelope("service_unavailable", { status: 503, retryable: true, spent: false })] });
  const flowB = flowFor(b.client);
  await flowB.start();
  await flowB.next();
  assertEquals(flowB.getState().step, "failed");
  assertEquals(flowB.getState().error?.canRetry, true);
  assertEquals(count(b.calls, "issue"), 1);
});

Deno.test("flow: a definitive retryable failure offers retry, which re-runs the same call", async () => {
  const { client, calls } = fakeClient({ issue: [envelope("rate_limited", { status: 429, retryable: true }), sealed] });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().error?.canRetry, true);
  await flow.retry();
  assertEquals(flow.getState().step, "sealed");
  assertEquals(count(calls, "issue"), 2);
});

Deno.test("flow: a failure that spent a number is never retryable", async () => {
  const { client } = fakeClient({
    issue: [envelope("validation_failed", { status: 422, retryable: true, spent: { codigoGeneracion: "CG", numeroControl: "NC" } })],
  });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().step, "failed");
  assertEquals(flow.getState().error?.canRetry, false);
  await flow.retry();
  assertEquals(flow.getState().step, "failed");
});

Deno.test("flow: rejection keeps Hacienda's words, the spent number and readable fields", async () => {
  const { client } = fakeClient({
    issue: [envelope("mh_rejected", {
      observaciones: ["[receptor.numDocumento] NO CUMPLE EL FORMATO"],
      spent: { codigoGeneracion: "CG", numeroControl: "NC-9" },
      fields: [
        { path: "receptor.nrc", message: "formato inválido" },
        { path: "cuerpoDocumento[2].precioUni", message: "debe ser mayor que 0" },
      ],
    })],
  });
  const flow = flowFor(client);
  await flow.start();
  await flow.next();
  const s = flow.getState();
  assertEquals(s.step, "rejected");
  assertEquals(s.error?.observaciones, ["[receptor.numDocumento] NO CUMPLE EL FORMATO"]);
  assertEquals(s.error?.spent?.numeroControl, "NC-9");
  assertEquals(s.error?.canRetry, false);
  assertEquals(s.error?.fields.map((f) => f.label), ["NRC del receptor", "Precio de la línea 3"]);
});

Deno.test("flow: expired session, from describe, from the clock, or mid-issue", async () => {
  const a = flowFor(fakeClient({ describe: envelope("session_expired", { status: 401 }) }).client);
  await a.start();
  assertEquals(a.getState().step, "expired");

  const b = flowFor(fakeClient({ describe: info({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }).client);
  await b.start();
  assertEquals(b.getState().step, "expired");

  const c = flowFor(fakeClient({ issue: [envelope("session_expired", { status: 401 })] }).client);
  await c.start();
  await c.next();
  assertEquals(c.getState().step, "expired");
});

Deno.test("flow: a failed load can be retried when definitive and retryable", async () => {
  const c = fakeClient({ describe: envelope("service_unavailable", { status: 503, retryable: true, spent: false }) });
  const flow = flowFor(c.client);
  await flow.start();
  assertEquals(flow.getState().step, "failed");
  assertEquals(flow.getState().error?.canRetry, true);
});

Deno.test("flow: the issuing phase advances while one call is pending", async () => {
  let release!: (value: IssueSummary) => void;
  const pending = new Promise<IssueSummary>((resolve) => (release = resolve));
  const { client } = fakeClient({});
  client.issue = () => pending;
  const flow = createIssueFlow({ client, session: "tok", phaseDelaysMs: [5, 10], sleep: () => Promise.resolve() });
  await flow.start();
  const done = flow.next();
  assertEquals(flow.getState().phase, "preparing");
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(flow.getState().phase, "sending");
  release(sealed);
  await done;
  assertEquals(flow.getState().step, "sealed");
  assertEquals(flow.getState().phase, null);
});

// --- Delivery tracking --------------------------------------------------------

type View = NonNullable<IssueSummary["delivery"]>;
const pendingView = (): View => ({ canales: { correo: { estado: "pendiente", destino: "m•••@e.com" } } });
const sealedWithDelivery = (): IssueSummary => ({ ...sealed, deliveryHandle: "h.mac", delivery: pendingView() });

async function settle(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
}

function withDeliveryReads(base: ReturnType<typeof fakeClient>, reads: Array<View | Error>) {
  const seen: string[] = [];
  base.client.deliveryStatus = (_session, handle) => {
    seen.push(handle);
    const item = reads.shift();
    if (item === undefined) return Promise.reject(new Error("no more reads"));
    return item instanceof Error ? Promise.reject(item) : Promise.resolve(item);
  };
  return seen;
}

Deno.test("delivery: sealed shows the marked channels at once; polling updates them and stops when final", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  const handles = withDeliveryReads(base, [
    { canales: { correo: { estado: "en_proceso" } } },
    { canales: { correo: { estado: "enviado", destino: "m•••@e.com" } } },
  ]);
  const updates: View[] = [];
  const flow = flowFor(base.client, { onDelivery: (d) => updates.push(d) });
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().step, "sealed");
  await settle(() => flow.getState().delivery?.settled === true);
  assertEquals(flow.getState().delivery?.canales.correo?.estado, "enviado");
  assertEquals(flow.getState().result?.delivery?.canales.correo?.estado, "enviado");
  assertEquals(handles, ["h.mac", "h.mac"]); // stopped after the final state: no third read
  assertEquals(updates.map((u) => u.canales.correo?.estado), ["pendiente", "en_proceso", "enviado"]);
  assertEquals("deliveryHandle" in (flow.getState().result ?? {}), false); // consumed, not leaked to onIssued
  flow.destroy();
});

Deno.test("delivery: never blocks the fiscal step, and a polling failure does not change it", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  withDeliveryReads(base, [netError(), netError()]);
  const flow = flowFor(base.client, { deliveryTimeoutMs: 4000, deliveryIntervalMs: 2000 });
  await flow.start();
  await flow.next();
  await settle(() => flow.getState().delivery?.timedOut === true);
  assertEquals(flow.getState().step, "sealed");
  assertEquals(flow.getState().error, null);
  assertEquals(flow.getState().delivery?.timedOut, true);
  assertEquals(flow.getState().delivery?.canales.correo?.estado, "pendiente");
  flow.destroy();
});

Deno.test("delivery: gives up after the time budget (60 s of 2 s reads = 30 reads)", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  const reads = Array.from({ length: 100 }, (): View => ({ canales: { correo: { estado: "en_proceso" } } }));
  const handles = withDeliveryReads(base, reads);
  const flow = flowFor(base.client);
  await flow.start();
  await flow.next();
  await settle(() => flow.getState().delivery?.timedOut === true);
  assertEquals(handles.length, 30);
  assertEquals(flow.getState().delivery?.timedOut, true);
  flow.destroy();
});

Deno.test("delivery: a definitive answer (handle refused) stops polling and says «later»", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  const handles = withDeliveryReads(base, [envelope("action_not_allowed", { status: 403 })]);
  const flow = flowFor(base.client);
  await flow.start();
  await flow.next();
  await settle(() => flow.getState().delivery?.timedOut === true);
  assertEquals(handles.length, 1);
  assertEquals(flow.getState().step, "sealed");
  flow.destroy();
});

Deno.test("delivery: a result without delivery has no tracking, and an all-final view needs no polling", async () => {
  const plain = fakeClient({ issue: [sealed] });
  const flow = flowFor(plain.client);
  await flow.start();
  await flow.next();
  assertEquals(flow.getState().delivery, null);
  flow.destroy();

  const done = fakeClient({
    issue: [{ ...sealed, deliveryHandle: "h", delivery: { canales: { whatsapp: { estado: "sin_credito", motivo: "wallet_empty" } } } }],
  });
  const handles = withDeliveryReads(done, []);
  const second = flowFor(done.client);
  await second.start();
  await second.next();
  assertEquals(second.getState().delivery?.settled, true);
  assertEquals(handles.length, 0);
  second.destroy();
});

Deno.test("delivery: destroying the flow stops the polling", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  const reads = Array.from({ length: 100 }, (): View => ({ canales: { correo: { estado: "en_proceso" } } }));
  const handles = withDeliveryReads(base, reads);
  const flow = flowFor(base.client);
  await flow.start();
  await flow.next();
  flow.destroy();
  await new Promise((r) => setTimeout(r, 20));
  assert(handles.length < 5);
});

Deno.test("delivery: after destroy (auto-close) a host with onDelivery still gets the final state", async () => {
  const base = fakeClient({ issue: [sealedWithDelivery()] });
  withDeliveryReads(base, [{ canales: { correo: { estado: "enviado", destino: "m•••@e.com" } } }]);
  const updates: string[] = [];
  const flow = flowFor(base.client, { onDelivery: (d) => updates.push(d.canales.correo?.estado ?? "") });
  await flow.start();
  await flow.next();
  flow.destroy();
  await settle(() => updates.includes("enviado"));
  assertEquals(updates.at(-1), "enviado");
});
