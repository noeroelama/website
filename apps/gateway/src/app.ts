import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { CURRENT_API_VERSION } from "@website/contracts";
import { problem } from "./http/problem";
import { requireApiKey, requireScope } from "./middleware/api-key";
import { requireIdempotencyKey } from "./middleware/idempotency";
import { requestGuard } from "./middleware/request-guard";
import { requestId } from "./middleware/request-id";
import { eventRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
import type { GatewayDeps, GatewayVariables } from "./types";

export function createGatewayApp(deps: GatewayDeps) {
  const app = new OpenAPIHono<{ Variables: GatewayVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return problem(c, "validation", {
          errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      return undefined;
    },
  });

  app.use("*", requestId);
  app.use("*", secureHeaders());
  app.use("*", requestGuard(deps));
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c: Context<{ Variables: GatewayVariables }>) =>
        problem(c, "validation", { detail: "Body too large" }),
    }),
  );

  app.route("/", healthRoutes());
  app.route(`/${CURRENT_API_VERSION}`, healthRoutes());

  app.doc31(`/${CURRENT_API_VERSION}/openapi.json`, {
    openapi: "3.1.0",
    info: { title: "PPIDK Website API", version: CURRENT_API_VERSION },
    servers: [{ url: "https://api.example.org" }],
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "ApiKey", {
    type: "http",
    scheme: "bearer",
    description: "API key issued by an administrator: `Authorization: Bearer pk_live_…`",
  });

  const v1 = `/${CURRENT_API_VERSION}`;
  app.use(`${v1}/events/*`, requireApiKey(deps), requireScope("events.read"));
  app.use(`${v1}/*`, requireIdempotencyKey);
  app.route(v1, eventRoutes(deps));

  app.notFound((c) => problem(c, "notFound"));
  app.onError((error, c) => {
    deps.logger.error("unhandled_error", { requestId: c.get("requestId"), error: error.message });
    return problem(c, "internal");
  });

  return app;
}
