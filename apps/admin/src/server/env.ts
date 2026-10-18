import "server-only";
import {
  baseEnv,
  cronEnv,
  firebaseAdminEnv,
  messagingEnv,
  newsletterEnv,
  lazyEnv,
  loadEnv,
  publicUrlsEnv,
  resendEnv,
  sessionEnv,
  zoomEnv,
} from "@website/config/env";

const adminEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(sessionEnv.shape)
  .extend(cronEnv.shape)
  .extend(messagingEnv.shape)
  .extend(resendEnv.partial().shape)
  .extend(newsletterEnv.pick({ LINK_SIGNING_SECRET: true }).partial().shape)
  .extend(zoomEnv.partial().shape);

export const getAdminEnv = lazyEnv(() => loadEnv(adminEnvSchema, process.env));

/** Our apps' public URLs only (no secrets): the sign-in link works without Firebase config. */
export const getAppUrls = lazyEnv(() =>
  loadEnv(baseEnv.extend(publicUrlsEnv.pick({ WEB_URL: true, ADMIN_URL: true }).shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);
