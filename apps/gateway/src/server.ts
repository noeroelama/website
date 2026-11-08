import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { createGatewayApp } from "./app";
import { createDepsFromEnv } from "./deps";

const source: Record<string, string | undefined> = { ...process.env };
if (source["APP_ENV"] === undefined || source["APP_ENV"] === "development") {
  source["APP_ENV"] = "development";
  source["API_KEY_PEPPER"] ??= randomBytes(32).toString("base64url");
}

const deps = createDepsFromEnv(source);
const port = Number(source["PORT"] ?? 3003);
serve({ fetch: createGatewayApp(deps).fetch, port }, (info) => {
  deps.logger.info("gateway_listening", { port: info.port });
});
