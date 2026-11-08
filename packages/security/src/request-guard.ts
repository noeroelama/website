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
  readonly secret: string;
  readonly mode: "same-site" | "public-api";
  readonly privatePrefixes: readonly string[];
  readonly signedWebhookPaths?: readonly string[];
  readonly policy?: RateLimitPolicy;
  readonly extraLimits?: readonly {
    readonly name: string;
    readonly policy: RateLimitPolicy;
    readonly applies: (request: Request, path: string) => boolean;
  }[];
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<unknown>;
  readonly onStoreError?: (error: unknown) => void;
}

export interface GuardResult {
  readonly blocked: Response | null;
  readonly headers: Record<string, string>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

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

function originAllowed(request: Request, options: GuardOptions, path: string): boolean {
  const { mode, signedWebhookPaths = [] } = options;
  if (signedWebhookPaths.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  if (mode === "public-api") {
    const origin = request.headers.get("origin");
    return origin === null || isSameHost(origin, request);
  }
  const mustBeOwn = path.startsWith("/api/") || !SAFE_METHODS.has(request.method);
  return !mustBeOwn || isOwnOrigin(request);
}

export async function guardRequest(request: Request, options: GuardOptions): Promise<GuardResult> {
  const path = new URL(request.url).pathname;
  const headers: Record<string, string> = {};
  if (options.privatePrefixes.some((prefix) => path.startsWith(prefix))) {
    headers["Cache-Control"] = "private, no-store";
  }

  if (!originAllowed(request, options, path)) {
    return { blocked: jsonError("forbidden"), headers };
  }

  const policy = options.policy ?? DEFAULT_RATE_LIMIT;
  const key = `ip_${createHmac("sha256", options.secret).update(clientIp(request.headers)).digest("hex")}`;
  const now = options.now?.() ?? new Date();
  try {
    const decision = await options.store.consume(key, policy, now);
    headers["RateLimit-Limit"] = String(decision.limit);
    headers["RateLimit-Remaining"] = String(decision.remaining);
    const refused = (retryAfterSeconds: number) => ({
      blocked: jsonError("rate_limited", { ...headers, "Retry-After": String(retryAfterSeconds) }),
      headers,
    });
    if (!decision.allowed) return refused(decision.retryAfterSeconds);
    for (const extra of options.extraLimits ?? []) {
      if (!extra.applies(request, path)) continue;
      const tight = await options.store.consume(`${extra.name}_${key}`, extra.policy, now);
      if (!tight.allowed) return refused(tight.retryAfterSeconds);
    }
    if (decision.throttled) await (options.sleep ?? delay)(policy.throttleDelayMs);
  } catch (error) {
    options.onStoreError?.(error);
  }
  return { blocked: null, headers };
}

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
