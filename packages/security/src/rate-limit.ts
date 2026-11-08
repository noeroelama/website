export interface RateLimitPolicy {
  readonly perMinute: number;
  readonly perDay: number;
  readonly throttleDelayMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitPolicy = {
  perMinute: 100,
  perDay: 10_000,
  throttleDelayMs: 500,
};

export interface RateLimitState {
  readonly day: string;
  readonly dayCount: number;
  readonly minute: number;
  readonly minuteCount: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly throttled: boolean;
}

export function applyRateLimit(
  previous: RateLimitState | null,
  policy: RateLimitPolicy,
  now: Date,
): { state: RateLimitState; decision: RateLimitDecision } {
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(now.getTime() / 60_000);
  const dayCount = previous?.day === day ? previous.dayCount : 0;
  const minuteCount =
    previous?.minute === minute && previous.day === day ? previous.minuteCount : 0;

  const throttled = dayCount >= policy.perDay;
  const limit = policy.perMinute;

  if (minuteCount >= limit) {
    const retryAfterSeconds = Math.ceil(((minute + 1) * 60_000 - now.getTime()) / 1000);
    return {
      state: { day, dayCount, minute, minuteCount },
      decision: { allowed: false, limit, remaining: 0, retryAfterSeconds, throttled },
    };
  }
  return {
    state: { day, dayCount: dayCount + 1, minute, minuteCount: minuteCount + 1 },
    decision: {
      allowed: true,
      limit,
      remaining: limit - minuteCount - 1,
      retryAfterSeconds: 0,
      throttled,
    },
  };
}

export interface RateLimitStore {
  consume(key: string, policy: RateLimitPolicy, now: Date): Promise<RateLimitDecision>;
}

export function createMemoryRateLimitStore(): RateLimitStore {
  const states = new Map<string, RateLimitState>();
  return {
    consume(key, policy, now) {
      const { state, decision } = applyRateLimit(states.get(key) ?? null, policy, now);
      states.set(key, state);
      return Promise.resolve(decision);
    },
  };
}
