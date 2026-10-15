/**
 * Node server: pnpm dev / pnpm start locally, `dist/server.js` on cPanel (docs/deployment.md).
 * Convenience defaults apply ONLY when APP_ENV is unset or development, so
 * `pnpm dev` works without a .env.local. Staging/production never get defaults.
 */
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { createGatewayApp } from "./app";
import { createDepsFromEnv } from "./deps";

const source: Record<string, string | undefined> = { ...process.env };
if (source["APP_ENV"] === undefined || source["APP_ENV"] === "development") {
  source["APP_ENV"] = "development";
  // Ephemeral per-process pepper: dev keys are invalid after restart, by design.
  source["API_KEY_PEPPER"] ??= randomBytes(32).toString("base64url");
}

const deps = createDepsFromEnv(source);
const port = Number(source["PORT"] ?? 3003);
serve({ fetch: createGatewayApp(deps).fetch, port }, (info) => {
  deps.logger.info("gateway_listening", { port: info.port });
});
