import { describe, expect, it } from "vitest";
import { consumeQuota, DAY_LIMIT, emptyQuota, HOUR_LIMIT, peekQuota, quotaMessage, QuotaCounter } from "../server/quota.ts";

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

describe("quota arithmetic", () => {
  it("allows 20 issues per hour and refuses the 21st with a retry time", () => {
    let state = emptyQuota();
    for (let i = 0; i < HOUR_LIMIT; i++) {
      const step = consumeQuota(state, `k${i}`, T0 + i * 1000);
      expect(step.decision.allowed).toBe(true);
      state = step.state;
    }
    const refused = consumeQuota(state, "k-extra", T0 + 30_000);
    expect(refused.decision).toMatchObject({ allowed: false, window: "hour", remainingHour: 0 });
    expect(refused.decision.retryAfterSeconds).toBe(Math.ceil((T0 + HOUR - (T0 + 30_000)) / 1000));
    expect(quotaMessage(refused.decision)).toContain("20 facturas de prueba por hora");
  });

  it("frees the hour window as time passes", () => {
    let state = emptyQuota();
    for (let i = 0; i < HOUR_LIMIT; i++) state = consumeQuota(state, `k${i}`, T0).state;
    expect(consumeQuota(state, "later", T0 + HOUR + 1).decision.allowed).toBe(true);
  });

  it("stops at 100 per day even when each hour is within its limit", () => {
    let state = emptyQuota();
    let n = 0;
    for (let hour = 0; hour < 5; hour++) {
      for (let i = 0; i < HOUR_LIMIT; i++) {
        const step = consumeQuota(state, `k${n++}`, T0 + hour * (HOUR + 1000) + i);
        expect(step.decision.allowed).toBe(true);
        state = step.state;
      }
    }
    expect(state.stamps).toHaveLength(DAY_LIMIT);
    const refused = consumeQuota(state, "one-more", T0 + 5 * (HOUR + 1000));
    expect(refused.decision).toMatchObject({ allowed: false, window: "day" });
    expect(quotaMessage(refused.decision)).toContain("100 facturas de prueba por día");
  });

  it("does not count a replay of the same idempotency key twice", () => {
    const first = consumeQuota(emptyQuota(), "same", T0);
    const second = consumeQuota(first.state, "same", T0 + 1000);
    expect(second.decision.allowed).toBe(true);
    expect(second.state.stamps).toHaveLength(1);
  });

  it("peeks without counting", () => {
    const state = consumeQuota(emptyQuota(), "a", T0).state;
    expect(peekQuota(state, T0)).toMatchObject({ remainingHour: 19, remainingDay: 99 });
    expect(state.stamps).toHaveLength(1);
  });
});

describe("QuotaCounter Durable Object", () => {
  function counter(now: () => number) {
    const data = new Map<string, unknown>();
    return new QuotaCounter({
      storage: {
        get: async <T>(key: string) => data.get(key) as T | undefined,
        put: async <T>(key: string, value: T) => void data.set(key, value),
      },
    }, undefined, now);
  }
  const consume = (c: QuotaCounter, key: string) =>
    c.fetch(new Request("https://quota/consume", { method: "POST", body: JSON.stringify({ key }) })).then((r) => r.json());

  it("persists counts across requests", async () => {
    const c = counter(() => T0);
    expect(await consume(c, "a")).toMatchObject({ allowed: true, remainingHour: 19 });
    expect(await consume(c, "b")).toMatchObject({ allowed: true, remainingHour: 18 });
    const peek = await c.fetch(new Request("https://quota/peek"));
    expect(await peek.json()).toMatchObject({ remainingHour: 18 });
  });

  it("rejects a missing key and unknown routes", async () => {
    const c = counter(() => T0);
    expect((await c.fetch(new Request("https://quota/consume", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await c.fetch(new Request("https://quota/other"))).status).toBe(404);
  });
});
