import "server-only";
import { lazyEnv } from "@website/config/env";
import { createDiskFileStorage, getDatabaseForRole } from "@website/db/sql";
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
 * Files of the website on the cPanel disk (FILE_STORAGE_DIR): recruitment portfolios and pacts,
 * signatures (written), archived letters (read for public verification), and the `/files` and
 * `/private-files` routes.
 */
export const webStorage = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.FILE_STORAGE_DIR) {
    throw new Error("FILE_STORAGE_DIR is required for files on the website.");
  }
  return createDiskFileStorage({
    root: env.FILE_STORAGE_DIR,
    baseUrl: env.WEB_URL ?? "",
    secret: env.LINK_SIGNING_SECRET,
  });
});
