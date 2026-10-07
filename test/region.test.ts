// Regional pinning: discovery from /v1/status, the x-region header, overrides and failure tolerance.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Facta } from "../src/client.ts";
import { createFactaFromConfigFile } from "../src/node-config.ts";

const TEST_KEY = "facta_test_a.bbbbbbbbbbbbbbbb";
const LIVE_KEY = "facta_live_a.bbbbbbbbbbbbbbbb";

interface Seen { path: string; region: string | null }

function fake(status: Record<string, unknown> | "fail", served = "us-west-2") {
  const seen: Seen[] = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^.*\/v1/, "/v1");
    seen.push({ path, region: new Headers(init?.headers).get("x-region") });
    if (path === "/v1/status") {
      if (status === "fail") return Promise.reject(new TypeError("offline"));
      return Promise.resolve(new Response(JSON.stringify({ ok: true, ambiente: "00", ...status }), {
        status: 200, headers: { "content-type": "application/json", "x-sb-edge-region": served },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { "content-type": "application/json", "x-sb-edge-region": served },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}
const make = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}, key = TEST_KEY) =>
  new Facta({ apiKey: key, fetch, maxRetries: 0, clock: false, ...extra });

Deno.test("discovery reads /v1/status once and later calls carry the advertised region", async () => {
  const { fetch, seen } = fake({ region: "eu-west-1" });
  const facta = make(fetch);
  await facta.listHolding();
  await facta.listHolding();
  assertEquals(seen.filter((s) => s.path === "/v1/status").length, 1);
  assertEquals(seen.filter((s) => s.path !== "/v1/status").map((s) => s.region), ["eu-west-1", "eu-west-1"]);
  assertEquals(await facta.region(), "eu-west-1");
  assertEquals(facta.servedRegion, "us-west-2");
});

Deno.test("concurrent first calls share one discovery", async () => {
  const { fetch, seen } = fake({ region: "us-west-2" });
  const facta = make(fetch);
  await Promise.all([facta.listHolding(), facta.listHolding(), facta.region()]);
  assertEquals(seen.filter((s) => s.path === "/v1/status").length, 1);
});

Deno.test("an explicit status() call afterwards sends the header too", async () => {
  const { fetch, seen } = fake({ region: "us-west-2" });
  const facta = make(fetch);
  await facta.region();
  await facta.status();
  assertEquals(seen.at(-1), { path: "/v1/status", region: "us-west-2" });
});

Deno.test("the region option overrides discovery and makes no status request", async () => {
  const { fetch, seen } = fake({ region: "eu-west-1" });
  const facta = make(fetch, { region: "us-east-1" });
  await facta.listHolding();
  assertEquals(seen, [{ path: "/v1/dte/holding", region: "us-east-1" }]);
  assertEquals(await facta.region(), "us-east-1");
});

Deno.test("region: false disables the header and discovery", async () => {
  const { fetch, seen } = fake({ region: "us-west-2" });
  const facta = make(fetch, { region: false });
  await facta.listHolding();
  assertEquals(seen, [{ path: "/v1/dte/holding", region: null }]);
  assertEquals(await facta.region(), null);
});

Deno.test("config.region is honoured and an option wins over it", async () => {
  const a = fake({});
  await make(a.fetch, { config: { version: 1, region: "ap-south-1" } }).listHolding();
  assertEquals(a.seen[0].region, "ap-south-1");
  const b = fake({});
  await make(b.fetch, { config: { version: 1, region: "ap-south-1" }, region: "sa-east-1" }).listHolding();
  assertEquals(b.seen[0].region, "sa-east-1");
});

Deno.test("an API without region in status falls back to the built-in default per environment", async () => {
  for (const key of [TEST_KEY, LIVE_KEY]) {
    const { fetch, seen } = fake({});
    const facta = make(fetch, {}, key);
    await facta.listHolding();
    assertEquals(seen.at(-1)?.region, "us-west-2");
  }
});

Deno.test("a discovery failure never fails the operation and sends no header", async () => {
  const { fetch, seen } = fake("fail");
  const facta = make(fetch);
  const page = await facta.listHolding();
  assert(page);
  assertEquals(seen.find((s) => s.path === "/v1/dte/holding")?.region, null);
  assertEquals(await facta.region(), null);
});

Deno.test("a malformed region in status is ignored; a malformed option is refused", async () => {
  const { fetch, seen } = fake({ region: "not a region!" });
  await make(fetch).listHolding();
  assertEquals(seen.at(-1)?.region, "us-west-2");
  let threw = false;
  try { make(fetch, { region: "bad value" }); } catch { threw = true; }
  assert(threw);
});

Deno.test("diagnose carries the served region, even when the API is unhealthy", async () => {
  const fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: { code: "internal_error", message: "x" } }), {
    status: 503, headers: { "content-type": "application/json", "x-sb-edge-region": "us-east-1" },
  }))) as unknown as typeof globalThis.fetch;
  const report = await make(fetch, { region: "us-west-2" }).diagnose();
  assertEquals(report.overall, "blocked");
  assertEquals(report.servedRegion, "us-east-1");
});

Deno.test("a config file may carry region", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(path, JSON.stringify({ version: 1, region: "us-west-2" }));
  const { fetch, seen } = fake({});
  const facta = await createFactaFromConfigFile({ configFile: path, apiKey: TEST_KEY, fetch, clock: false });
  await facta.listHolding();
  assertEquals(seen.length, 1);
  await Deno.writeTextFile(path, JSON.stringify({ version: 1, region: "nope" }));
  await assertRejects(() => createFactaFromConfigFile({ configFile: path, apiKey: TEST_KEY, fetch }), TypeError);
  await Deno.remove(path);
});
