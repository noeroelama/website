import { readCookie, SESSION_COOKIE, signInUrl } from "@website/auth";
import {
  baseEnv,
  databaseEnv,
  lazyEnv,
  loadEnv,
  publicUrlsEnv,
  rateLimitEnv,
} from "@website/config/env";
import { createSqlRateLimitStore, getDatabaseForRole } from "@website/db/sql";
import { createLogger } from "@website/observability";
import { createRequestGuard, type GuardResult } from "@website/security";

export const ADMIN_WEBHOOK_PATHS: readonly string[] = [
  "/webhooks/zoom",
  "/webhooks/waha",
  "/webhooks/whatsapp",
];

const getEnv = lazyEnv(() =>
  loadEnv(
    baseEnv
      .extend(rateLimitEnv.shape)
      .extend(publicUrlsEnv.pick({ WEB_URL: true, ADMIN_URL: true }).shape),
    {
      APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
      ...process.env,
    },
  ),
);

const getGuard = lazyEnv(() => {
  const env = getEnv();
  const logger = createLogger({ service: "admin", level: env.LOG_LEVEL });
  return createRequestGuard({
    appEnv: env.APP_ENV,
    secret: env.RATE_LIMIT_SECRET,
    mode: "same-site",
    privatePrefixes: ["/"],
    signedWebhookPaths: ADMIN_WEBHOOK_PATHS,
    sharedStore: () => {
      const db = loadEnv(baseEnv.extend(databaseEnv.shape), process.env);
      return createSqlRateLimitStore(
        getDatabaseForRole({
          role: "admin_rw",
          url: db.DATABASE_URL,
          connectionLimit: db.DATABASE_CONNECTION_LIMIT,
        }),
      );
    },
    onStoreError: (error) => logger.error("rate_limit_store_error", { error: String(error) }),
  });
});

export function guardRequest(request: Request): Promise<GuardResult> {
  return getGuard()(request);
}

export function signInRedirect(request: Request): string | null {
  const { pathname, search } = new URL(request.url);
  const machine = ["/api/", "/cron/", "/webhooks/", "/certificates/"].some((prefix) =>
    pathname.startsWith(prefix),
  );
  const feed = pathname.startsWith("/calendar/") && pathname.endsWith(".ics");
  if (machine || feed || pathname === "/health") return null;
  if (readCookie(request, SESSION_COOKIE)) return null;
  const { WEB_URL, ADMIN_URL } = getEnv();
  return WEB_URL && ADMIN_URL ? signInUrl(WEB_URL, `${ADMIN_URL}${pathname}${search}`) : null;
}
