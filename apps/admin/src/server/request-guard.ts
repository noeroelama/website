// Used by src/proxy.ts. No "server-only" import: the proxy is not a React Server Component.
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

/** Incoming webhook paths that skip only the origin check (they check a provider signature). */
export const ADMIN_WEBHOOK_PATHS: readonly string[] = [
  "/webhooks/zoom",
  "/webhooks/waha",
  "/webhooks/whatsapp",
];

// `next dev` without a .env.local runs as development; deployments must set APP_ENV.
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
    // Each provider step adds its path here (e.g. "/webhooks/zoom"); see docs/architecture.md DEC-5.
    signedWebhookPaths: ADMIN_WEBHOOK_PATHS,
    // Staging/production: counters shared by all server instances (MySQL, pooled).
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

/** Origin check + per-IP rate limit + private caching headers for every request. */
export function guardRequest(request: Request): Promise<GuardResult> {
  return getGuard()(request);
}

/**
 * Every admin page (not /api/*, not the /health probe) needs a session: without a session cookie → the web sign-in URL, for a real 307
 * from the proxy (with Cache Components a page's redirect() is streamed: 200 + client-side
 * redirect). Only checks that the cookie exists; the page still verifies it and the permissions.
 * Without WEB_URL/ADMIN_URL (e.g. CI) the page shows its "sign-in required" message instead.
 */
export function signInRedirect(request: Request): string | null {
  const { pathname, search } = new URL(request.url);
  // Machine endpoints authenticate themselves (cron secret, provider signature, signed pickup
  // link), never a session.
  const machine = ["/api/", "/cron/", "/webhooks/", "/certificates/"].some((prefix) =>
    pathname.startsWith(prefix),
  );
  if (machine || pathname === "/health") return null;
  if (readCookie(request, SESSION_COOKIE)) return null;
  const { WEB_URL, ADMIN_URL } = getEnv();
  return WEB_URL && ADMIN_URL ? signInUrl(WEB_URL, `${ADMIN_URL}${pathname}${search}`) : null;
}
