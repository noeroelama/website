import { createHmac, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { jsonError } from "./errors";
import {
  createMemoryRateLimitStore,
  DEFAULT_RATE_LIMIT,
  type RateLimitPolicy,
  type RateLimitStore,
} from "./rate-limit";

export interface GuardOptions {
  readonly store: RateLimitStore;
  /** HMAC key for client IPs: counters never contain raw IP addresses. */
  readonly secret: string;
  /**
   * `same-site` (web/admin/shop): `/api/*` and every non-GET request must come from our own origin.
   * `public-api` (gateway): server-to-server calls allowed; browsers on other websites refused.
   */
  readonly mode: "same-site" | "public-api";
  /** Path prefixes whose responses must never be stored by shared caches. */
  readonly privatePrefixes: readonly string[];
  readonly policy?: RateLimitPolicy;
  readonly now?: () => Date;
  /** Waits before continuing a throttled request (injectable for tests). */
  readonly sleep?: (ms: number) => Promise<unknown>;
  /** Called when the counter store fails; the request is then allowed (fail-open). */
  readonly onStoreError?: (error: unknown) => void;
}

export interface GuardResult {
  /** A response to return immediately (403/429), or null to continue. */
  readonly blocked: Response | null;
  /** Headers to add to the normal response. */
  readonly headers: Record<string, string>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Client IP as set by the hosting reverse proxy (cPanel/Passenger sets these headers). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Our public host. Behind a reverse proxy (cPanel/Passenger) `request.url` is the internal
 * address (http://localhost:<port>), so the forwarded/Host header is used — the same check
 * Next.js applies to Server Actions. Browsers cannot forge these headers cross-site.
 */
function ownHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    new URL(request.url).host
  );
}

function isSameHost(origin: string, request: Request): boolean {
  return URL.canParse(origin) && new URL(origin).host === ownHost(request);
}

function isOwnOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return isSameHost(origin, request);
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function originAllowed(request: Request, mode: GuardOptions["mode"], path: string): boolean {
  if (mode === "public-api") {
    const origin = request.headers.get("origin");
    return origin === null || isSameHost(origin, request);
  }
  const mustBeOwn = path.startsWith("/api/") || !SAFE_METHODS.has(request.method);
  return !mustBeOwn || isOwnOrigin(request);
}

/** Runs before every request: origin restriction, per-IP rate limit, private caching headers. */
export async function guardRequest(request: Request, options: GuardOptions): Promise<GuardResult> {
  const path = new URL(request.url).pathname;
  const headers: Record<string, string> = {};
  if (options.privatePrefixes.some((prefix) => path.startsWith(prefix))) {
    headers["Cache-Control"] = "private, no-store";
  }

  if (!originAllowed(request, options.mode, path)) {
    return { blocked: jsonError("forbidden"), headers };
  }

  const policy = options.policy ?? DEFAULT_RATE_LIMIT;
  const key = `ip_${createHmac("sha256", options.secret).update(clientIp(request.headers)).digest("hex")}`;
  try {
    const decision = await options.store.consume(key, policy, options.now?.() ?? new Date());
    headers["RateLimit-Limit"] = String(decision.limit);
    headers["RateLimit-Remaining"] = String(decision.remaining);
    if (!decision.allowed) {
      return {
        blocked: jsonError("rate_limited", {
          ...headers,
          "Retry-After": String(decision.retryAfterSeconds),
        }),
        headers,
      };
    }
    // Past the daily quota: still served, but slowed down.
    if (decision.throttled) await (options.sleep ?? delay)(policy.throttleDelayMs);
  } catch (error) {
    options.onStoreError?.(error);
  }
  return { blocked: null, headers };
}

/**
 * Builds the guard for an app. Development/test use an in-memory store and a random secret;
 * staging/production require RATE_LIMIT_SECRET and use the shared (Firestore) store, created once.
 */
export function createRequestGuard(
  config: Omit<GuardOptions, "store" | "secret"> & {
    readonly appEnv: "development" | "test" | "staging" | "production";
    readonly secret: string | undefined;
    readonly sharedStore: () => RateLimitStore;
  },
): (request: Request) => Promise<GuardResult> {
  const deployed = config.appEnv === "staging" || config.appEnv === "production";
  if (deployed && !config.secret) {
    throw new Error("RATE_LIMIT_SECRET is required in staging and production.");
  }
  const secret = config.secret ?? randomBytes(32).toString("hex");
  let store: RateLimitStore | undefined;
  return (request) => {
    store ??= deployed ? config.sharedStore() : createMemoryRateLimitStore();
    return guardRequest(request, { ...config, store, secret });
  };
}
