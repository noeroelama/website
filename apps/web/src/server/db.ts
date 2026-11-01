import "server-only";
import { lazyEnv } from "@website/config/env";
import { createDbFileStorage, getDatabaseForRole } from "@website/db/sql";
import { getWebEnv } from "./env";

/** The website's database (MySQL, role web_ro, pooled). */
export const webDb = lazyEnv(() => {
  const env = getWebEnv();
  return getDatabaseForRole({
    role: "web_ro",
    url: env.DATABASE_URL,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
  });
});

/**
 * Files of the website in the MySQL `files` collection: recruitment portfolios and pacts,
 * signatures (written), archived letters (read for public verification), and the `/files` and
 * `/private-files` routes.
 */
export const webStorage = lazyEnv(() => {
  const env = getWebEnv();
  return createDbFileStorage({
    db: webDb(),
    baseUrl: env.WEB_URL ?? "",
    secret: env.LINK_SIGNING_SECRET,
  });
});
