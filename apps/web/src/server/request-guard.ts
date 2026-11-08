import { readCookie, SESSION_COOKIE, signInUrl } from "@website/auth";
import {
  baseEnv,
  documentsEnv,
  databaseEnv,
  lazyEnv,
  loadEnv,
  rateLimitEnv,
} from "@website/config/env";
import { createSqlRateLimitStore, getDatabaseForRole } from "@website/db/sql";
import { createLogger } from "@website/observability";
import { createRequestGuard, type GuardResult } from "@website/security";
import { isVerificationPath, verificationRewrite } from "../lib/verification-host";

const getEnv = lazyEnv(() =>
  loadEnv(baseEnv.extend(rateLimitEnv.shape).extend(documentsEnv.shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);

const getGuard = lazyEnv(() => {
  const env = getEnv();
  const logger = createLogger({ service: "web", level: env.LOG_LEVEL });
  return createRequestGuard({
    appEnv: env.APP_ENV,
    secret: env.RATE_LIMIT_SECRET,
    mode: "same-site",
    privatePrefixes: ["/api/", "/account"],
    extraLimits: [
      {
        name: "verify",
        policy: { perMinute: 20, perDay: 10_000, throttleDelayMs: 500 },
        applies: (request, path) =>
          isVerificationPath(path) || verificationTarget(request, path) !== null,
      },
    ],
    sharedStore: () => {
      const db = loadEnv(baseEnv.extend(databaseEnv.shape), process.env);
      return createSqlRateLimitStore(
        getDatabaseForRole({
          role: "web_ro",
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
  if (pathname !== "/account" && !pathname.startsWith("/account/")) return null;
  return readCookie(request, SESSION_COOKIE) ? null : signInUrl("", pathname + search);
}

const requestHost = (request: Request) =>
  request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
  request.headers.get("host") ??
  new URL(request.url).host;

export function verificationTarget(request: Request, path: string): string | null {
  return verificationRewrite(requestHost(request), path, getEnv().VERIFICATION_HOST ?? null);
}
