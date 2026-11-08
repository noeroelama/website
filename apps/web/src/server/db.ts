import "server-only";
import { lazyEnv } from "@website/config/env";
import { createDbFileStorage, getDatabaseForRole } from "@website/db/sql";
import { getWebEnv } from "./env";

export const webDb = lazyEnv(() => {
  const env = getWebEnv();
  return getDatabaseForRole({
    role: "web_ro",
    url: env.DATABASE_URL,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
  });
});

export const webStorage = lazyEnv(() => {
  const env = getWebEnv();
  return createDbFileStorage({
    db: webDb(),
    baseUrl: env.WEB_URL ?? "",
    secret: env.LINK_SIGNING_SECRET,
  });
});
