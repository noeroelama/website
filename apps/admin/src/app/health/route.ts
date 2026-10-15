/**
 * Liveness probe for uptime checks (infrastructure/monitoring): no database call, and nothing about
 * versions, hosts or configuration (docs/security.md). Same body as the gateway's GET /health.
 */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
