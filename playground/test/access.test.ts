import { describe, expect, it } from "vitest";
import { AccessError, verifyAccessJwt, visitorFrom } from "../server/access.ts";
import { accessClaims, AUD, goodEnv, makeKeys, TEAM } from "./helpers.ts";

const NOW = 1_800_000_000_000;
const seconds = Math.floor(NOW / 1000);
const config = { teamDomain: TEAM, aud: AUD };

async function setup() {
  const keys = await makeKeys();
  return { keys, source: async () => [keys.jwk] };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof AccessError ? error.code : "other";
  }
}

describe("Cloudflare Access verification", () => {
  it("accepts a valid token and returns its claims", async () => {
    const { keys, source } = await setup();
    const claims = await verifyAccessJwt(await keys.sign(accessClaims(seconds)), config, source, NOW);
    expect(claims.email).toBe("Visitor@Example.com");
  });

  it("accepts the team domain written with a scheme", async () => {
    const { keys, source } = await setup();
    await expect(verifyAccessJwt(await keys.sign(accessClaims(seconds)), { teamDomain: `https://${TEAM}/`, aud: AUD }, source, NOW)).resolves.toBeTruthy();
  });

  it("rejects a token signed by another key", async () => {
    const { keys, source } = await setup();
    expect(await code(verifyAccessJwt(await keys.forge(accessClaims(seconds)), config, source, NOW))).toBe("bad_signature");
  });

  it("rejects a tampered payload", async () => {
    const { keys, source } = await setup();
    const [h, , s] = (await keys.sign(accessClaims(seconds))).split(".");
    const evil = btoa(JSON.stringify(accessClaims(seconds, { email: "attacker@example.com" }))).replaceAll("=", "");
    expect(await code(verifyAccessJwt(`${h}.${evil}.${s}`, config, source, NOW))).toBe("bad_signature");
  });

  it("rejects the wrong audience, issuer and an expired token", async () => {
    const { keys, source } = await setup();
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds, { aud: ["other"] })), config, source, NOW))).toBe("bad_claims");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds, { aud: undefined })), config, source, NOW))).toBe("bad_claims");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds, { iss: "https://evil.cloudflareaccess.com" })), config, source, NOW))).toBe("bad_claims");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds, { exp: seconds - 3600 })), config, source, NOW))).toBe("expired");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds, { exp: undefined })), config, source, NOW))).toBe("expired");
  });

  it("rejects a non-RS256 algorithm and an unknown key id", async () => {
    const { keys, source } = await setup();
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds), { alg: "none" }), config, source, NOW))).toBe("malformed");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds), { alg: "HS256" }), config, source, NOW))).toBe("malformed");
    expect(await code(verifyAccessJwt(await keys.sign(accessClaims(seconds), { kid: "nope" }), config, source, NOW))).toBe("unknown_key");
  });

  it("rejects missing and malformed tokens", async () => {
    const { source } = await setup();
    expect(await code(verifyAccessJwt(null, config, source, NOW))).toBe("missing");
    expect(await code(verifyAccessJwt("a.b", config, source, NOW))).toBe("malformed");
    expect(await code(verifyAccessJwt("!!!.???.***", config, source, NOW))).toBe("malformed");
  });
});

describe("visitorFrom", () => {
  it("reads the lower-cased e-mail from a verified token", async () => {
    const { keys, source } = await setup();
    const request = new Request("https://playground.factadte.com/api/state", {
      headers: { "cf-access-jwt-assertion": await keys.sign(accessClaims(seconds)) },
    });
    expect(await visitorFrom(request, goodEnv(), source, NOW)).toEqual({ email: "visitor@example.com", via: "access" });
  });

  it("returns null without a valid token", async () => {
    const { source } = await setup();
    expect(await visitorFrom(new Request("https://playground.factadte.com/api/state"), goodEnv(), source, NOW)).toBeNull();
  });

  it("ignores the bypass flag off localhost", async () => {
    const { source } = await setup();
    const env = goodEnv({ PLAYGROUND_DEV_BYPASS: "1" });
    expect(await visitorFrom(new Request("https://playground.factadte.com/api/state"), env, source, NOW)).toBeNull();
  });

  it("honours the bypass on localhost", async () => {
    const { source } = await setup();
    const env = goodEnv({ PLAYGROUND_DEV_BYPASS: "1", PLAYGROUND_DEV_EMAIL: "Dev@Example.com" });
    expect(await visitorFrom(new Request("http://localhost:8787/api/state"), env, source, NOW)).toEqual({ email: "dev@example.com", via: "dev-bypass" });
  });
});
