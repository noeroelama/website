import { randomBytes } from "node:crypto";
import { baseEnv, gatewayEnv, loadEnv, rateLimitEnv } from "@website/config/env";
import { createMemoryGatewayRepositories } from "@website/db/memory";
import { createLogger } from "@website/observability";
import { createMemoryRateLimitStore } from "@website/security";
import type { GatewayDeps } from "./types";

const gatewayEnvSchema = baseEnv.extend(gatewayEnv.shape).extend(rateLimitEnv.shape);

export function createDepsFromEnv(
  source: Readonly<Record<string, string | undefined>>,
): GatewayDeps {
  const env = loadEnv(gatewayEnvSchema, source);
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") {
    throw new Error(`Gateway persistence adapters are not wired yet for APP_ENV=${env.APP_ENV}.`);
  }
  const repos = createMemoryGatewayRepositories();
  return {
    logger: createLogger({ service: "gateway", level: env.LOG_LEVEL }),
    apiKeys: repos.apiKeys,
    events: repos.events,
    rateLimitStore: createMemoryRateLimitStore(),
    rateLimitSecret: env.RATE_LIMIT_SECRET ?? randomBytes(32).toString("hex"),
    apiKeyPepper: env.API_KEY_PEPPER,
    keyEnvironment: "test",
    defaultRateLimitPerMinute: env.GATEWAY_RATE_LIMIT_PER_MINUTE,
    now: () => new Date(),
  };
}
