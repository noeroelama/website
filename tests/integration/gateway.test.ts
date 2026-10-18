import { describe, expect, it } from "vitest";
import { generateApiKey } from "@website/apikeys";
import { EventPageSchema, ProblemDetailsSchema } from "@website/contracts";
import { createMemoryGatewayRepositories } from "@website/db/memory";
import { createLogger } from "@website/observability";
import { createMemoryRateLimitStore } from "@website/security";
import { createGatewayApp } from "../../apps/gateway/src/app";

const pepper = "integration-pepper-0123456789abcdef012345";
const now = new Date("2026-10-07T00:00:00Z");
const key = generateApiKey("test", pepper);
const readOnlyKey = generateApiKey("test", pepper);

const repos = createMemoryGatewayRepositories({
  apiKeys: [
    {
      keyId: key.keyId,
      clientId: "c1",
      environment: "test",
      secretHash: key.secretHash,
      scopes: ["events.read"],
      expiresAt: null,
      revokedAt: null,
      rateLimitPerMinute: 2,
    },
    {
      keyId: readOnlyKey.keyId,
      clientId: "c2",
      environment: "test",
      secretHash: readOnlyKey.secretHash,
      scopes: [],
      expiresAt: null,
      revokedAt: null,
      rateLimitPerMinute: null,
    },
  ],
  events: [
    {
      id: "e1",
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      slug: "summit",
      title: "Summit",
      summary: null,
      startsAt: new Date("2026-12-01T00:00:00Z"),
      endsAt: null,
      timezone: "Asia/Tokyo",
      location: "Tokyo",
      chapterId: "jp",
      published: true,
      capacity: 100,
      registrationClosesAt: null,
      type: "conference",
      description: "",
      bannerImage: null,
      registrationUrl: null,
      schedule: [],
      speakers: [],
      sponsors: [],
    },
  ],
});

const app = createGatewayApp({
  logger: createLogger({ service: "gateway-test", level: "error", write: () => undefined }),
  apiKeys: repos.apiKeys,
  events: repos.events,
  rateLimitStore: createMemoryRateLimitStore(),
  rateLimitSecret: "integration-rate-limit-secret-0123456789",
  apiKeyPepper: pepper,
  keyEnvironment: "test",
  defaultRateLimitPerMinute: 60,
  now: () => now,
});
const auth = (k: string) => ({ headers: { authorization: `Bearer ${k}` } });

describe("gateway", () => {
  it("health endpoints return only status", async () => {
    for (const path of ["/health", "/v1/health"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    }
  });

  it("rejects missing/invalid API keys with RFC 9457 problem+json", async () => {
    const res = await app.request("/v1/events");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(ProblemDetailsSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("enforces scopes", async () => {
    const res = await app.request("/v1/events", auth(readOnlyKey.plaintext));
    expect(res.status).toBe(403);
  });

  it("returns explicit DTOs that match the contract (no internal fields)", async () => {
    const res = await app.request("/v1/events?limit=10", auth(key.plaintext));
    expect(res.status).toBe(200);
    const body = EventPageSchema.parse(await res.json());
    expect(body.data[0]).not.toHaveProperty("capacity");
    expect(body.data[0]).not.toHaveProperty("version");
  });

  it("validates queries and rate-limits per key", async () => {
    const bad = await app.request("/v1/events?limit=1000", auth(key.plaintext));
    expect(bad.status).toBe(400);
    const limited = await app.request("/v1/events", auth(key.plaintext));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("requires Idempotency-Key on writes", async () => {
    const res = await app.request("/v1/registrations", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { type: string }).type).toContain("idempotency-key-required");
  });

  it("serves an OpenAPI 3.1 document generated from the contracts", async () => {
    const res = await app.request("/v1/openapi.json");
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/v1/events");
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(["Event", "ProblemDetails"]),
    );
  });
});
