import { describe, expect, it } from "vitest";
import {
  applyRateLimit,
  createMemoryRateLimitStore,
  DEFAULT_RATE_LIMIT,
  type RateLimitState,
} from "@website/security";

const at = (iso: string) => new Date(iso);

describe("rate limit policy (100/min, 10k/day, then slowed down)", () => {
  it("defaults to 100 per minute, 10,000 per day, then a 500 ms delay per request", () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ perMinute: 100, perDay: 10_000, throttleDelayMs: 500 });
  });

  it("allows 100 requests in a minute, then denies with Retry-After until the next minute", () => {
    let state: RateLimitState | null = null;
    const now = at("2026-10-07T10:00:20Z");
    for (let i = 0; i < 100; i++) {
      const r = applyRateLimit(state, DEFAULT_RATE_LIMIT, now);
      expect(r.decision.allowed).toBe(true);
      state = r.state;
    }
    const denied = applyRateLimit(state, DEFAULT_RATE_LIMIT, now);
    expect(denied.decision).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 40,
      limit: 100,
    });
    expect(denied.state).toEqual(state);
    expect(
      applyRateLimit(state, DEFAULT_RATE_LIMIT, at("2026-10-07T10:01:00Z")).decision.allowed,
    ).toBe(true);
  });

  it("reports remaining requests", () => {
    const first = applyRateLimit(null, DEFAULT_RATE_LIMIT, at("2026-10-07T10:00:00Z"));
    expect(first.decision).toMatchObject({
      allowed: true,
      limit: 100,
      remaining: 99,
      throttled: false,
    });
  });

  it("after 10,000 requests in a day requests are marked throttled (slowed), not blocked", () => {
    const state: RateLimitState = {
      day: "2026-10-07",
      dayCount: 10_000,
      minute: 0,
      minuteCount: 0,
    };
    let s: RateLimitState | null = state;
    const now = at("2026-10-07T18:00:00Z");
    for (let i = 0; i < 100; i++) {
      const r = applyRateLimit(s, DEFAULT_RATE_LIMIT, now);
      expect(r.decision).toMatchObject({ allowed: true, throttled: true, limit: 100 });
      s = r.state;
    }
    expect(applyRateLimit(s, DEFAULT_RATE_LIMIT, now).decision).toMatchObject({
      allowed: false,
      throttled: true,
    });
  });

  it("the 10,000th request of the day is still at full speed", () => {
    const state: RateLimitState = { day: "2026-10-07", dayCount: 9_999, minute: 0, minuteCount: 0 };
    const first = applyRateLimit(state, DEFAULT_RATE_LIMIT, at("2026-10-07T18:00:00Z"));
    expect(first.decision.throttled).toBe(false);
    expect(
      applyRateLimit(first.state, DEFAULT_RATE_LIMIT, at("2026-10-07T18:00:00Z")).decision
        .throttled,
    ).toBe(true);
  });

  it("the daily quota resets at 00:00 UTC", () => {
    const state: RateLimitState = {
      day: "2026-10-07",
      dayCount: 20_000,
      minute: 0,
      minuteCount: 0,
    };
    const r = applyRateLimit(state, DEFAULT_RATE_LIMIT, at("2026-10-08T00:00:01Z"));
    expect(r.decision).toMatchObject({ allowed: true, throttled: false, limit: 100 });
    expect(r.state.dayCount).toBe(1);
  });

  it("memory store: concurrent requests can never exceed the limit (no race)", async () => {
    const store = createMemoryRateLimitStore();
    const now = at("2026-10-07T10:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 150 }, () => store.consume("ip-a", DEFAULT_RATE_LIMIT, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
    expect((await store.consume("ip-b", DEFAULT_RATE_LIMIT, now)).allowed).toBe(true);
  });
});
