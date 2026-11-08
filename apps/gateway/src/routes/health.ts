import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HealthResponseSchema } from "@website/contracts";
import type { GatewayVariables } from "../types";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Liveness probe",
  responses: {
    200: {
      description: "Gateway is up",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

export function healthRoutes() {
  const app = new OpenAPIHono<{ Variables: GatewayVariables }>();
  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
  return app;
}
