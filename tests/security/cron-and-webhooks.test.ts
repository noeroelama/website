import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFirestoreWebhookEventStore } from "@website/db/firestore";
import {
  bearerTokenMatches,
  createMemoryRateLimitStore,
  guardRequest,
  verifyHmacSignature,
} from "@website/security";
import { createCronRoute, CRON_JOBS } from "../../apps/admin/src/server/cron";
import { fakeFirestore } from "../support/fake-firestore";

const SECRET = "c".repeat(40);
const hmac = (body: string, secret = "wh-secret") =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("signed webhooks: the origin check is skipped ONLY for the listed paths", () => {
  const options = {
    store: createMemoryRateLimitStore(),
    secret: "s".repeat(40),
    mode: "same-site" as const,
    privatePrefixes: ["/"],
    signedWebhookPaths: ["/webhooks/zoom"],
  };
  const post = (path: string) =>
    new Request(`https://admin.example${path}`, {
      method: "POST",
      headers: { origin: "https://zoom.example" },
    });

  it("lets a provider POST to its webhook path, still rate limited and never cached", async () => {
    const result = await guardRequest(post("/webhooks/zoom"), options);
    expect(result.blocked).toBeNull();
    expect(result.headers).toMatchObject({
      "Cache-Control": "private, no-store",
      "RateLimit-Limit": "100",
    });
    expect((await guardRequest(post("/webhooks/zoom/extra"), options)).blocked).toBeNull();
  });

  it("still blocks cross-site posts everywhere else (other providers, look-alike paths, /api)", async () => {
    for (const path of ["/webhooks/whatsapp", "/webhooks/zoomer", "/api/session", "/users"]) {
      expect((await guardRequest(post(path), options)).blocked?.status, path).toBe(403);
    }
  });
});

describe("verifyHmacSignature (provider signature + timestamp)", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  const ts = String(now.getTime() / 1000);
  const base = { secret: "wh-secret", now, toleranceSeconds: 300 };

  it("accepts a valid signature over timestamp + body, with an optional prefix", () => {
    const payload = `v0:${ts}:{"a":1}`;
    expect(
      verifyHmacSignature({
        ...base,
        payload,
        signature: `v0=${hmac(payload)}`,
        prefix: "v0=",
        timestamp: ts,
      }),
    ).toBe(true);
    expect(verifyHmacSignature({ ...base, payload, signature: hmac(payload) })).toBe(true);
  });

  it("refuses wrong, missing, malformed or old signatures", () => {
    const payload = "body";
    const good = hmac(payload);
    expect(verifyHmacSignature({ ...base, payload, signature: hmac("other") })).toBe(false);
    expect(verifyHmacSignature({ ...base, payload, signature: null })).toBe(false);
    expect(verifyHmacSignature({ ...base, payload, signature: "zz" })).toBe(false);
    expect(verifyHmacSignature({ ...base, payload, signature: good, prefix: "v0=" })).toBe(false);
    expect(
      verifyHmacSignature({ ...base, payload, signature: good, timestamp: "not-a-time" }),
    ).toBe(false);
    const old = String(now.getTime() / 1000 - 301);
    expect(verifyHmacSignature({ ...base, payload, signature: good, timestamp: old })).toBe(false);
    const future = String(now.getTime() / 1000 + 301);
    expect(verifyHmacSignature({ ...base, payload, signature: good, timestamp: future })).toBe(
      false,
    );
  });
});

describe("webhook event de-duplication (webhookEvents/{provider}_{eventId})", () => {
  it("records an event once; a replay returns false", async () => {
    const fake = fakeFirestore();
    const store = createFirestoreWebhookEventStore(
      fake.db as unknown as Parameters<typeof createFirestoreWebhookEventStore>[0],
    );
    const at = new Date("2026-10-16T00:00:00Z");
    expect(await store.record("zoom", "evt-1", at)).toBe(true);
    expect(await store.record("zoom", "evt-1", at)).toBe(false);
    expect(await store.record("waha", "evt-1", at)).toBe(true);
    expect(fake.docs.get("webhookEvents/zoom_evt-1")).toBeDefined();
    await expect(store.record("zoom", "../x", at)).rejects.toThrow();
  });
});

describe("cron routes (GET /cron/<job>, cPanel Cron Jobs)", () => {
  const noop = vi.fn(() => Promise.resolve({ processed: 0 }));
  const route = createCronRoute({ secret: SECRET, jobs: { noop }, log: () => undefined });
  const call = (job: string, authorization?: string) =>
    route(
      job,
      new Request(`https://admin.example/cron/${job}`, {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("runs a known job with the bearer secret and answers a JSON summary", async () => {
    const response = await call("noop", `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      job: "noop",
      ok: true,
      result: { processed: 0 },
    });
    expect(noop).toHaveBeenCalledTimes(1);
  });

  it("is 401 without or with a wrong secret, and 404 for an unknown job (after the secret check)", async () => {
    expect((await call("noop")).status).toBe(401);
    expect((await call("noop", `Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await call("noop", SECRET)).status).toBe(401);
    expect((await call("unknown")).status).toBe(401);
    expect((await call("unknown", `Bearer ${SECRET}`)).status).toBe(404);
    expect((await call("toString", `Bearer ${SECRET}`)).status).toBe(404);
  });

  it("refuses to run at all without a configured secret", async () => {
    const unconfigured = createCronRoute({
      secret: undefined,
      jobs: { noop },
      log: () => undefined,
    });
    const response = await unconfigured(
      "noop",
      new Request("https://admin.example/cron/noop", { headers: { authorization: "Bearer " } }),
    );
    expect(response.status).toBe(401);
  });

  it("a failing job answers 500 with a generic body and logs the error", async () => {
    const lines: string[] = [];
    const failing = createCronRoute({
      secret: SECRET,
      jobs: { broken: () => Promise.reject(new Error("db password=x")) },
      log: (line) => lines.push(JSON.stringify(line)),
    });
    const response = await failing(
      "broken",
      new Request("https://admin.example/cron/broken", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("password");
    expect(lines.join()).toContain("cron_job_failed");
  });

  it("the registry has the noop job for checking the set-up", async () => {
    expect(await CRON_JOBS["noop"]?.()).toEqual({ processed: 0 });
  });

  it("compares bearer tokens in constant time and never accepts an empty secret", () => {
    expect(bearerTokenMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerTokenMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerTokenMatches(null, SECRET)).toBe(false);
    expect(bearerTokenMatches("Bearer ", "")).toBe(false);
  });
});
