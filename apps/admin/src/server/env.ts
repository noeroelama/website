import "server-only";
import {
  baseEnv,
  cronEnv,
  documentsEnv,
  fieldEncryptionEnv,
  databaseEnv,
  filesEnv,
  firebaseAdminEnv,
  messagingEnv,
  newsletterEnv,
  lazyEnv,
  loadEnv,
  publicUrlsEnv,
  resendEnv,
  sessionEnv,
  wahaEnv,
  anthropicEnv,
  shortLinkEnv,
  zoomEnv,
} from "@website/config/env";

const adminEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(databaseEnv.shape)
  .extend(filesEnv.shape)
  .extend(sessionEnv.shape)
  .extend(cronEnv.shape)
  .extend(messagingEnv.shape)
  .extend(wahaEnv.shape)
  .extend(anthropicEnv.shape)
  .extend(shortLinkEnv.shape)
  .extend(resendEnv.partial().shape)
  .extend(newsletterEnv.partial().shape)
  .extend(zoomEnv.partial().shape)
  .extend(documentsEnv.shape)
  .extend(fieldEncryptionEnv.shape)
  .extend(publicUrlsEnv.pick({ WEB_URL: true }).shape);

export const getAdminEnv = lazyEnv(() => loadEnv(adminEnvSchema, process.env));

/** Our apps' public URLs only (no secrets): the sign-in link works without Firebase config. */
export const getAppUrls = lazyEnv(() =>
  loadEnv(baseEnv.extend(publicUrlsEnv.pick({ WEB_URL: true, ADMIN_URL: true }).shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);
