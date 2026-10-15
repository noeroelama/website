import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "@website/contracts";
import { GET as adminHealth } from "../../apps/admin/src/app/health/route";
import { GET as webHealth } from "../../apps/web/src/app/health/route";

// Uptime checks (infrastructure/monitoring) call GET /health on web and admin, like the gateway.
// Liveness only: no database call, nothing about versions, hosts or configuration (docs/security.md).
describe.each([
  ["web", webHealth],
  ["admin", adminHealth],
])("%s GET /health", (_app, GET) => {
  it("answers 200 with { status: 'ok' } only", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(HealthResponseSchema.strict().parse(await response.json())).toEqual({ status: "ok" });
  });
});
