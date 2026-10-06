import { describe, expect, it } from "vitest";
import { checkGuard } from "../server/guard.ts";
import { goodEnv } from "./helpers.ts";

const PROD_URL = "https://playground.factadte.com/api/state";

describe("fail-closed guard", () => {
  it("accepts a complete staging environment", () => {
    expect(checkGuard(goodEnv(), PROD_URL)).toEqual({ ok: true, devBypass: false });
  });

  it("refuses a production key", () => {
    const verdict = checkGuard(goodEnv({ FACTA_API_KEY: "facta_live_abcdef.secretsecret" }), PROD_URL);
    expect(verdict).toMatchObject({ ok: false, code: "key_not_test" });
    expect(JSON.stringify(verdict)).not.toContain("secretsecret");
  });

  it("refuses anything that is not a test key", () => {
    expect(checkGuard(goodEnv({ FACTA_API_KEY: "something-else-entirely" }), PROD_URL)).toMatchObject({ code: "key_not_test" });
  });

  it.each([
    ["the production project", "https://hcnvknpsbadplnfcflxx.supabase.co/functions/v1/api-v1"],
    ["a look-alike host", "https://eobxzotnqzgtpuqvmpkc.supabase.co.evil.example/functions/v1/api-v1"],
    ["a prefixed host", "https://x.eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1"],
    ["plain http", "http://eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1"],
    ["embedded credentials", "https://user:pw@eobxzotnqzgtpuqvmpkc.supabase.co/functions/v1/api-v1"],
    ["garbage", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(checkGuard(goodEnv({ FACTA_API_BASE_URL: url }), PROD_URL)).toMatchObject({ ok: false, code: "base_url_not_staging" });
  });

  it("refuses a missing base URL instead of falling back to the SDK default (production)", () => {
    const env = goodEnv();
    delete env.FACTA_API_BASE_URL;
    expect(checkGuard(env, PROD_URL)).toMatchObject({ ok: false, code: "base_url_missing" });
  });

  it.each([
    ["no key", { FACTA_API_KEY: undefined }, "key_missing"],
    ["short key", { FACTA_API_KEY: "facta_test_" }, "key_missing"],
    ["no sign key", { FACTA_SIGN_KEY: undefined }, "sign_key_missing"],
    ["short sign key", { FACTA_SIGN_KEY: "short" }, "sign_key_missing"],
    ["short session secret", { FACTA_SESSION_SECRET: "x".repeat(31) }, "session_secret_short"],
    ["no session secret", { FACTA_SESSION_SECRET: undefined }, "session_secret_short"],
    ["bad fixtures", { FACTA_DTE_FIXTURES_JSON: "{nope" }, "fixtures_invalid"],
    ["no Access team", { ACCESS_TEAM_DOMAIN: "" }, "access_not_configured"],
    ["no Access audience", { ACCESS_AUD: undefined }, "access_not_configured"],
  ] as const)("refuses %s", (_label, extra, code) => {
    const env = { ...goodEnv(), ...extra } as ReturnType<typeof goodEnv>;
    expect(checkGuard(env, PROD_URL)).toMatchObject({ ok: false, code });
  });

  it("allows the dev bypass on localhost only", () => {
    const env = goodEnv({ PLAYGROUND_DEV_BYPASS: "1", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
    expect(checkGuard(env, "http://localhost:8787/api/state")).toEqual({ ok: true, devBypass: true });
    expect(checkGuard(env, "http://127.0.0.1:8787/api/state")).toEqual({ ok: true, devBypass: true });
    expect(checkGuard(env, PROD_URL)).toMatchObject({ ok: false, code: "bypass_not_local" });
    expect(checkGuard(env, "https://facta-playground-dev.example.workers.dev/api/state")).toMatchObject({ code: "bypass_not_local" });
    expect(checkGuard(env, "https://localhost.evil.example/api/state")).toMatchObject({ code: "bypass_not_local" });
  });
});
