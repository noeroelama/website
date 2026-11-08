import { createMiddleware } from "hono/factory";
import { problem } from "../http/problem";
import type { GatewayVariables } from "../types";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const VALID_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export const requireIdempotencyKey = createMiddleware<{ Variables: GatewayVariables }>(
  async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const key = c.req.header("idempotency-key");
      if (!key || !VALID_KEY.test(key)) return problem(c, "idempotencyKeyRequired");
    }
    return next();
  },
);
