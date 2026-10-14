import { describe, expect, it, vi } from "vitest";
import {
  clientIp,
  createMemoryRateLimitStore,
  createRequestGuard,
  guardRequest,
  type GuardOptions,
  type RateLimitStore,
} from "@website/security";

const SECRET = "test-secret-0123456789abcdef0123456789";
const SITE = "https://web.example.org";

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new Request(`${SITE}${path}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? {},
  });
}
function opts(over: Partial<GuardOptions> = {}): GuardOptions {
  return {
    store: createMemoryRateLimitStore(),
    secret: SECRET,
    mode: "same-site",
    privatePrefixes: ["/api/", "/account"],
    ...over,
  };
}

describe("origin restriction (requests must come from our own site)", () => {
  it("allows normal page navigation, including from other sites (links, search engines)", async () => {
    const r = await guardRequest(
      req("/news", { headers: { "sec-fetch-site": "cross-site" } }),
      opts(),
    );
    expect(r.blocked).toBeNull();
  });

  it("blocks cross-site form posts / server actions (CSRF)", async () => {
    const r = await guardRequest(
      req("/news", { method: "POST", headers: { origin: "https://evil.example" } }),
      opts(),
    );
    expect(r.blocked?.status).toBe(403);
  });

  it("blocks API calls from other origins or from non-browser clients", async () => {
    for (const headers of [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      {},
    ]) {
      const r = await guardRequest(req("/api/session", { headers }), opts());
      expect(r.blocked?.status, JSON.stringify(headers)).toBe(403);
    }
  });

  it("allows same-origin API calls (Origin or Sec-Fetch-Site)", async () => {
    expect(
      (await guardRequest(req("/api/x", { method: "POST", headers: { origin: SITE } }), opts()))
        .blocked,
    ).toBeNull();
    expect(
      (await guardRequest(req("/api/x", { headers: { "sec-fetch-site": "same-origin" } }), opts()))
        .blocked,
    ).toBeNull();
  });

  it("behind a reverse proxy (cPanel/Passenger) compares against the Host header, not the internal URL", async () => {
    // Next.js standalone behind Passenger sees http://localhost:<port> as request.url.
    const proxied = (headers: Record<string, string>) =>
      new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { host: "web.example.org", ...headers },
      });
    expect((await guardRequest(proxied({ origin: SITE }), opts())).blocked).toBeNull();
    expect(
      (await guardRequest(proxied({ origin: "https://evil.example" }), opts())).blocked?.status,
    ).toBe(403);
    expect(
      (await guardRequest(proxied({ origin: SITE }), opts({ mode: "public-api" }))).blocked,
    ).toBeNull();
  });

  it("public-api mode (gateway): server-to-server allowed, cross-origin browsers blocked", async () => {
    const o = opts({ mode: "public-api" });
    expect((await guardRequest(req("/v1/events"), o)).blocked).toBeNull();
    expect(
      (await guardRequest(req("/v1/events", { headers: { origin: "https://evil.example" } }), o))
        .blocked?.status,
    ).toBe(403);
  });

  it("403 responses are generic", async () => {
    const r = await guardRequest(
      req("/api/x", { method: "POST", headers: { origin: "https://evil.example" } }),
      opts(),
    );
    expect(await r.blocked?.json()).toEqual({
      error: "forbidden",
      message: "Request not allowed.",
    });
  });
});

describe("per-IP rate limiting", () => {
  it("returns 429 with Retry-After once an IP exceeds 100 requests/minute; other IPs unaffected", async () => {
    const o = opts({ now: () => new Date("2026-10-07T10:00:30Z") });
    const from = (ip: string) =>
      req("/news", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
    for (let i = 0; i < 100; i++)
      expect((await guardRequest(from("203.0.113.9"), o)).blocked).toBeNull();
    const limited = await guardRequest(from("203.0.113.9"), o);
    expect(limited.blocked?.status).toBe(429);
    expect(limited.blocked?.headers.get("retry-after")).toBe("30");
    expect(await limited.blocked?.json()).toEqual({
      error: "rate_limited",
      message: "Too many requests. Try again later.",
    });
    expect((await guardRequest(from("198.51.100.7"), o)).blocked).toBeNull();
  });

  it("after the daily quota each request is delayed (slowed down), not refused", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const throttledStore: RateLimitStore = {
      consume: () =>
        Promise.resolve({
          allowed: true,
          limit: 100,
          remaining: 50,
          retryAfterSeconds: 0,
          throttled: true,
        }),
    };
    const r = await guardRequest(req("/news"), opts({ store: throttledStore, sleep }));
    expect(r.blocked).toBeNull();
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("does not delay requests below the daily quota", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await guardRequest(req("/news"), opts({ sleep }));
    expect(sleep).not.toHaveBeenCalled();
  });

  it("delays by default with a real timer", async () => {
    const throttledStore: RateLimitStore = {
      consume: () =>
        Promise.resolve({
          allowed: true,
          limit: 100,
          remaining: 50,
          retryAfterSeconds: 0,
          throttled: true,
        }),
    };
    const started = Date.now();
    await guardRequest(
      req("/news"),
      opts({ store: throttledStore, policy: { perMinute: 100, perDay: 1, throttleDelayMs: 50 } }),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it("exposes RateLimit headers", async () => {
    const r = await guardRequest(req("/news"), opts());
    expect(r.headers).toMatchObject({ "RateLimit-Limit": "100", "RateLimit-Remaining": "99" });
  });

  it("stores only a keyed hash of the IP, never the IP itself", async () => {
    const consume = vi.fn<RateLimitStore["consume"]>().mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      retryAfterSeconds: 0,
      throttled: false,
    });
    await guardRequest(
      req("/news", { headers: { "x-real-ip": "203.0.113.9" } }),
      opts({ store: { consume } }),
    );
    const key = consume.mock.calls[0]?.[0] ?? "";
    expect(key).toMatch(/^ip_[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
  });

  it("fails open (and reports) when the store is unavailable, so an outage does not take the site down", async () => {
    const onStoreError = vi.fn();
    const store: RateLimitStore = { consume: () => Promise.reject(new Error("unavailable")) };
    const r = await guardRequest(req("/news"), opts({ store, onStoreError }));
    expect(r.blocked).toBeNull();
    expect(onStoreError).toHaveBeenCalledOnce();
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe(
      "1.1.1.1",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " 2.2.2.2 , 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("caching of private responses", () => {
  it("marks API and account responses as private, no-store; leaves public pages cacheable", async () => {
    expect(
      (await guardRequest(req("/api/x", { headers: { "sec-fetch-site": "same-origin" } }), opts()))
        .headers["Cache-Control"],
    ).toBe("private, no-store");
    expect((await guardRequest(req("/account/profile"), opts())).headers["Cache-Control"]).toBe(
      "private, no-store",
    );
    expect((await guardRequest(req("/news"), opts())).headers["Cache-Control"]).toBeUndefined();
  });
});

describe("createRequestGuard (environment wiring)", () => {
  it("requires a secret in staging and production", () => {
    expect(() =>
      createRequestGuard({
        appEnv: "production",
        secret: undefined,
        sharedStore: () => createMemoryRateLimitStore(),
        mode: "same-site",
        privatePrefixes: [],
      }),
    ).toThrow(/RATE_LIMIT_SECRET/);
  });

  it("uses the shared store in staging/production and memory in development/test", async () => {
    const shared = vi.fn(() => createMemoryRateLimitStore());
    const prod = createRequestGuard({
      appEnv: "staging",
      secret: SECRET,
      sharedStore: shared,
      mode: "same-site",
      privatePrefixes: [],
    });
    await prod(req("/news"));
    await prod(req("/news"));
    expect(shared).toHaveBeenCalledOnce(); // created once, reused

    const devShared = vi.fn(() => createMemoryRateLimitStore());
    const dev = createRequestGuard({
      appEnv: "development",
      secret: undefined,
      sharedStore: devShared,
      mode: "same-site",
      privatePrefixes: [],
    });
    expect((await dev(req("/news"))).blocked).toBeNull();
    expect(devShared).not.toHaveBeenCalled();
  });
});
