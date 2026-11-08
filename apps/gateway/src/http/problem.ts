import type { Context } from "hono";
import type { GatewayVariables } from "../types";
import { PROBLEM_CONTENT_TYPE, ProblemTypes, type ProblemDetails } from "@website/contracts";

type ProblemKey = keyof typeof ProblemTypes;

const TITLES: Record<ProblemKey, string> = {
  validation: "Request validation failed",
  unauthorized: "Missing or invalid API key",
  forbidden: "API key lacks the required scope",
  originNotAllowed: "Browser requests from other websites are not allowed",
  notFound: "Resource not found",
  rateLimited: "Rate limit exceeded",
  idempotencyKeyRequired: "Idempotency-Key header required",
  internal: "Internal server error",
};

const STATUS: Record<ProblemKey, 400 | 401 | 403 | 404 | 429 | 500> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  originNotAllowed: 403,
  notFound: 404,
  rateLimited: 429,
  idempotencyKeyRequired: 400,
  internal: 500,
};

export function problem(
  c: Context<{ Variables: GatewayVariables }>,
  key: ProblemKey,
  extra: Partial<Pick<ProblemDetails, "detail" | "errors">> = {},
): Response {
  const body: ProblemDetails = {
    type: ProblemTypes[key],
    title: TITLES[key],
    status: STATUS[key],
    instance: c.req.path,
    requestId: c.get("requestId"),
    ...extra,
  };
  return c.body(JSON.stringify(body), STATUS[key], { "Content-Type": PROBLEM_CONTENT_TYPE });
}
