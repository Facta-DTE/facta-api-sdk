// Debug timings: off by default, one header when asked, body first and Server-Timing as the fallback.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { debugFromServerTiming } from "../src/debug.ts";

const CG = "7875BC7A-9580-441D-94E4-FA455E9D8BD0";
const VENTA = { tipoDte: "01" as const, items: [{ descripcion: "x", cantidad: 1, precioUni: 10 }] };

function fake(body: unknown, headers: Record<string, string> = {}) {
  const seen: Array<Headers> = [];
  const fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}
const options = (fetch: typeof globalThis.fetch, debug?: { timings?: boolean }) =>
  ({ apiKey: "facta_test_a.bbbbbbbbbbbbbbbb", fetch, maxRetries: 0, ...(debug ? { debug } : {}) });

Deno.test("no flag: no header, and a stray debug member is not handed over", async () => {
  const { fetch, seen } = fake({ estado: "sellado", codigoGeneracion: CG, debug: { timings: [], totalMs: 1 } });
  const result = await new Facta(options(fetch)).issue(VENTA);
  assertEquals(seen[0].get("x-facta-debug"), null);
  assertEquals(result.debug, undefined);
});

Deno.test("client option sends the header and exposes the body timings", async () => {
  const body = { estado: "sellado", codigoGeneracion: CG, debug: { timings: [{ step: "mh", ms: 410, startedAtMs: 20 }, { step: "bad", ms: "x" }], totalMs: 500 } };
  const { fetch, seen } = fake(body);
  const result = await new Facta(options(fetch, { timings: true })).issue(VENTA);
  assertEquals(seen[0].get("x-facta-debug"), "timings");
  assertEquals(result.debug, { timings: [{ step: "mh", ms: 410, startedAtMs: 20 }], totalMs: 500, source: "body" });
});

Deno.test("a per-call option overrides the client option, both ways", async () => {
  const { fetch, seen } = fake({ estado: "sellado", codigoGeneracion: CG });
  const off = new Facta(options(fetch));
  await off.issue(VENTA, { debug: { timings: true } });
  const on = new Facta(options(fetch, { timings: true }));
  await on.issue(VENTA, { debug: { timings: false } });
  assertEquals(seen[0].get("x-facta-debug"), "timings");
  assertEquals(seen[1].get("x-facta-debug"), null);
});

Deno.test("Server-Timing is the fallback when the body has no debug member", async () => {
  const { fetch } = fake({ estado: "sellado", codigoGeneracion: CG }, { "server-timing": "auth;dur=3.5, mh;dur=410, total;dur=498.2" });
  const result = await new Facta(options(fetch, { timings: true })).issue(VENTA);
  assertEquals(result.debug, { timings: [{ step: "auth", ms: 3.5 }, { step: "mh", ms: 410 }], totalMs: 498.2, source: "server-timing" });
});

Deno.test("asked for but the API sent nothing: no debug member", async () => {
  const { fetch } = fake({ estado: "sellado", codigoGeneracion: CG });
  const result = await new Facta(options(fetch, { timings: true })).issue(VENTA);
  assert(!("debug" in result));
});

Deno.test("Server-Timing parsing ignores what it cannot read", () => {
  assertEquals(debugFromServerTiming(null), null);
  assertEquals(debugFromServerTiming("cache;desc=hit"), null);
  assertEquals(debugFromServerTiming("a;dur=1, b;dur=oops, ;dur=3")?.timings, [{ step: "a", ms: 1 }]);
});
