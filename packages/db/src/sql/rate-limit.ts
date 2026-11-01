import type { Database } from "./store";
import { applyRateLimit, type RateLimitState, type RateLimitStore } from "@website/security";
import { safeId } from "@website/security/validation";

/** gRPC status ABORTED: the transaction lost a race with concurrent writes to the same counter. */
const ABORTED = 10;

/**
 * Shared rate-limit counters in `rateLimits/{key}`, updated in a transaction so concurrent
 * requests on any server instance can never exceed the limit. Only allowed requests write,
 * and `expiresAt` lets the cron job `expire` delete stale counters.
 */
export function createSqlRateLimitStore(db: Database, collection = "rateLimits"): RateLimitStore {
  return {
    async consume(key, policy, now) {
      const ref = db.collection(collection).doc(safeId.parse(key));
      try {
        return await db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          const previous = snapshot.exists ? (snapshot.data() as unknown as RateLimitState) : null;
          const { state, decision } = applyRateLimit(previous, policy, now);
          if (decision.allowed) {
            const expiresAt = new Date(`${state.day}T00:00:00Z`);
            expiresAt.setUTCDate(expiresAt.getUTCDate() + 2);
            tx.set(ref, { ...state, expiresAt });
          }
          return decision;
        });
      } catch (error) {
        // Heavy contention on one counter only happens under bursts far above the limit.
        if ((error as { code?: unknown }).code === ABORTED) {
          return {
            allowed: false,
            limit: policy.perMinute,
            remaining: 0,
            retryAfterSeconds: 1,
            throttled: false,
          };
        }
        throw error;
      }
    },
  };
}
