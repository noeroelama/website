// Used by src/proxy.ts. No "server-only" import: the proxy is not a React Server Component.
import { baseEnv, databaseEnv, lazyEnv, loadEnv, rateLimitEnv } from "@website/config/env";
import { createSqlRateLimitStore, getDatabaseForRole } from "@website/db/sql";
import { createLogger } from "@website/observability";
import { createRequestGuard, type GuardResult } from "@website/security";

// `next dev` without a .env.local runs as development; deployments must set APP_ENV.
const getEnv = lazyEnv(() =>
  loadEnv(baseEnv.extend(rateLimitEnv.shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);

const getGuard = lazyEnv(() => {
  const env = getEnv();
  const logger = createLogger({ service: "shop", level: env.LOG_LEVEL });
  return createRequestGuard({
    appEnv: env.APP_ENV,
    secret: env.RATE_LIMIT_SECRET,
    mode: "same-site",
    privatePrefixes: ["/api/", "/account", "/cart", "/checkout"],
    // Staging/production: counters shared by all server instances (MySQL, pooled).
    sharedStore: () => {
      const db = loadEnv(baseEnv.extend(databaseEnv.shape), process.env);
      return createSqlRateLimitStore(
        getDatabaseForRole({
          role: "shop_rw",
          url: db.DATABASE_URL,
          connectionLimit: db.DATABASE_CONNECTION_LIMIT,
        }),
      );
    },
    onStoreError: (error) => logger.error("rate_limit_store_error", { error: String(error) }),
  });
});

/** Origin check + per-IP rate limit + private caching headers for every request. */
export function guardRequest(request: Request): Promise<GuardResult> {
  return getGuard()(request);
}
