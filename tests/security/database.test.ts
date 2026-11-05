import { describe, expect, it } from "vitest";
import {
  createSqlRateLimitStore,
  deleteExpired,
  getDocumentsByIds,
  getDatabaseForRole,
} from "@website/db/sql";
import { DEFAULT_RATE_LIMIT } from "@website/security";
import { fakeDb as createFakeDb } from "../support/fake-db";

type Database = Parameters<typeof createSqlRateLimitStore>[0];

function fakeDb(options: { failWith?: Error } = {}) {
  const fake = createFakeDb(options);
  return { ...fake, db: fake.db as unknown as Database };
}

describe("rate-limit store (shared across server instances)", () => {
  const now = new Date("2026-10-07T10:00:00Z");

  it("enforces the limit atomically under concurrency", async () => {
    const { db } = fakeDb();
    const store = createSqlRateLimitStore(db);
    const results = await Promise.all(
      Array.from({ length: 120 }, () => store.consume("ip_abc", DEFAULT_RATE_LIMIT, now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
  });

  it("writes only allowed requests, with a TTL field for automatic cleanup", async () => {
    const { db, writes } = fakeDb();
    const store = createSqlRateLimitStore(db);
    await store.consume("ip_abc", { ...DEFAULT_RATE_LIMIT, perMinute: 1 }, now);
    await store.consume("ip_abc", { ...DEFAULT_RATE_LIMIT, perMinute: 1 }, now);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("rateLimits/ip_abc");
    expect(writes[0]?.data["expiresAt"]).toEqual(new Date("2026-10-09T00:00:00Z"));
  });

  it("treats transaction contention as 'limited' (abusive bursts), and rethrows other errors", async () => {
    const contended = createSqlRateLimitStore(
      fakeDb({ failWith: Object.assign(new Error("ABORTED"), { code: 10 }) }).db,
    );
    expect(await contended.consume("ip_abc", DEFAULT_RATE_LIMIT, now)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    const down = createSqlRateLimitStore(
      fakeDb({ failWith: Object.assign(new Error("UNAVAILABLE"), { code: 14 }) }).db,
    );
    await expect(down.consume("ip_abc", DEFAULT_RATE_LIMIT, now)).rejects.toThrow("UNAVAILABLE");
  });

  it("rejects unsafe document keys", async () => {
    const store = createSqlRateLimitStore(fakeDb().db);
    await expect(store.consume("../users/x", DEFAULT_RATE_LIMIT, now)).rejects.toThrow();
  });
});

describe("N+1 prevention: batched reads", () => {
  it("loads many documents in one round trip, de-duplicated, in input order", async () => {
    const { db, docs, getAll } = fakeDb();
    docs.set("memberProfiles/u1", { fullName: "A" });
    docs.set("memberProfiles/u3", { fullName: "C" });
    const result = await getDocumentsByIds<{ fullName: string }>(db, "memberProfiles", [
      "u1",
      "u2",
      "u1",
      "u3",
    ]);
    expect(getAll).toHaveBeenCalledOnce();
    expect([...result.entries()]).toEqual([
      ["u1", { fullName: "A" }],
      ["u2", null],
      ["u3", { fullName: "C" }],
    ]);
  });

  it("chunks very large batches and skips the call for an empty list", async () => {
    const { db, getAll } = fakeDb();
    await getDocumentsByIds(db, "users", []);
    expect(getAll).not.toHaveBeenCalled();
    await getDocumentsByIds(
      db,
      "users",
      Array.from({ length: 250 }, (_, i) => `u${i}`),
    );
    expect(getAll).toHaveBeenCalledTimes(3);
  });

  it("rejects ids that could address other documents (path injection)", async () => {
    await expect(
      getDocumentsByIds(fakeDb().db, "users", ["ok", "x/../../admin"]),
    ).rejects.toThrow();
  });
});

describe("connection pooling: one MySQL pool per database URL, reused", () => {
  it("returns the same pooled database on every call and separate pools per MySQL user", async () => {
    const url = "mysql://web:x@127.0.0.1:3306/ppidk";
    const a = getDatabaseForRole({ role: "web_ro", url });
    const b = getDatabaseForRole({ role: "web_ro", url });
    const c = getDatabaseForRole({ role: "admin_rw", url: "mysql://admin:x@127.0.0.1:3306/ppidk" });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    await Promise.all([a.close(), c.close()]);
    expect(getDatabaseForRole({ role: "web_ro", url })).not.toBe(a);
    await getDatabaseForRole({ role: "web_ro", url }).close();
  });
});

describe("expired rows (rate limits, challenges, webhook ids): cron job `expire`", () => {
  it("deletes at most `limit` expired rows per collection and keeps the rest", async () => {
    const { db, docs } = fakeDb();
    const now = new Date("2026-10-31T00:00:00Z");
    docs.set("rateLimits/old1", { expiresAt: new Date("2026-10-01T00:00:00Z") });
    docs.set("rateLimits/old2", { expiresAt: new Date("2026-10-02T00:00:00Z") });
    docs.set("rateLimits/new", { expiresAt: new Date("2026-11-02T00:00:00Z") });
    docs.set("webauthnChallenges/c", { expiresAt: now });
    docs.set("webhookEvents/w", { expiresAt: new Date("2026-12-01T00:00:00Z") });
    expect(await deleteExpired(db, now, 1)).toEqual({
      rateLimits: 1,
      webauthnChallenges: 1,
      webhookEvents: 0,
      attendanceCodes: 0,
      whatsappConversations: 0,
    });
    expect(await deleteExpired(db, now)).toEqual({
      rateLimits: 1,
      webauthnChallenges: 0,
      webhookEvents: 0,
      attendanceCodes: 0,
      whatsappConversations: 0,
    });
    expect([...docs.keys()].sort()).toEqual(["rateLimits/new", "webhookEvents/w"]);
  });
});
