import { assertEquals } from "jsr:@std/assert@1";
import {
  FACTA_PRODUCTION_BASE_URL,
  FACTA_STAGING_BASE_URL,
  Facta,
} from "../mod.ts";

const API_KEY = "facta_test_a.bbbbbbbbbbbbbbbb";

function recorder() {
  const urls: string[] = [];
  const fetch = ((url: string | URL | Request) => {
    urls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
}

Deno.test("package root endpoint constants and default request URL use production", async () => {
  assertEquals(FACTA_PRODUCTION_BASE_URL, "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1");
  assertEquals(FACTA_STAGING_BASE_URL, "https://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1");

  const { fetch, urls } = recorder();
  await new Facta({ apiKey: API_KEY, region: false, fetch }).status();
  assertEquals(urls, [`${FACTA_PRODUCTION_BASE_URL}/v1/status`]);
});

Deno.test("staging and explicit custom base URLs override the production default", async () => {
  const staging = recorder();
  await new Facta({ apiKey: API_KEY, region: false, fetch: staging.fetch, baseUrl: FACTA_STAGING_BASE_URL }).status();
  assertEquals(staging.urls, [`${FACTA_STAGING_BASE_URL}/v1/status`]);

  const custom = recorder();
  await new Facta({ apiKey: API_KEY, region: false, fetch: custom.fetch, baseUrl: "https://custom.example.test/api-v1" }).status();
  assertEquals(custom.urls, ["https://custom.example.test/api-v1/v1/status"]);
});
