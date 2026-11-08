import { createMiddleware } from "hono/factory";
import { guardRequest } from "@website/security";
import { problem } from "../http/problem";
import type { GatewayDeps, GatewayVariables } from "../types";

export function requestGuard(deps: GatewayDeps) {
  return createMiddleware<{ Variables: GatewayVariables }>(async (c, next) => {
    const guard = await guardRequest(c.req.raw, {
      store: deps.rateLimitStore,
      secret: deps.rateLimitSecret,
      mode: "public-api",
      privatePrefixes: ["/"],
      now: deps.now,
      onStoreError: (error) =>
        deps.logger.error("rate_limit_store_error", {
          requestId: c.get("requestId"),
          error: String(error),
        }),
    });
    for (const [name, value] of Object.entries(guard.headers)) c.header(name, value);
    if (guard.blocked?.status === 429) {
      c.header("Retry-After", String(guard.blocked.headers.get("retry-after")));
      return problem(c, "rateLimited");
    }
    if (guard.blocked) return problem(c, "originNotAllowed");
    return next();
  });
}
