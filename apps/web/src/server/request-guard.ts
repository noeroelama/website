// Used by src/proxy.ts. No "server-only" import: the proxy is not a React Server Component.
import { readCookie, SESSION_COOKIE, signInUrl } from "@website/auth";
import { baseEnv, firebaseAdminEnv, lazyEnv, loadEnv, rateLimitEnv } from "@website/config/env";
import { createFirestoreRateLimitStore, getFirestoreForRole } from "@website/db/firestore";
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
  const logger = createLogger({ service: "web", level: env.LOG_LEVEL });
  return createRequestGuard({
    appEnv: env.APP_ENV,
    secret: env.RATE_LIMIT_SECRET,
    mode: "same-site",
    privatePrefixes: ["/api/", "/account"],
    // Staging/production: counters shared by all server instances (Firestore, pooled client).
    sharedStore: () => {
      const fb = loadEnv(baseEnv.extend(firebaseAdminEnv.shape), process.env);
      return createFirestoreRateLimitStore(
        getFirestoreForRole({
          appEnv: fb.APP_ENV,
          role: "web_ro",
          projectId: fb.FIREBASE_PROJECT_ID,
          clientEmail: fb.FIREBASE_CLIENT_EMAIL,
          privateKey: fb.FIREBASE_PRIVATE_KEY,
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
 * Login-required page (/account) without a session cookie → the sign-in URL, for a real 307 from
 * the proxy (with Cache Components a page's redirect() is streamed: 200 + client-side redirect).
 * Only checks that the cookie exists; the page still verifies it.
 */
export function signInRedirect(request: Request): string | null {
  const { pathname, search } = new URL(request.url);
  if (pathname !== "/account" && !pathname.startsWith("/account/")) return null;
  return readCookie(request, SESSION_COOKIE) ? null : signInUrl("", pathname + search);
}
