import "server-only";
import {
  baseEnv,
  captchaEnv,
  fieldEncryptionEnv,
  databaseEnv,
  filesEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  messagingEnv,
  newsletterEnv,
  publicUrlsEnv,
  resendEnv,
  sessionEnv,
} from "@website/config/env";

const webEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(databaseEnv.shape)
  .extend(filesEnv.shape)
  .extend(sessionEnv.shape)
  .extend(captchaEnv.partial().shape)
  .extend(messagingEnv.shape)
  .extend(resendEnv.partial().shape)
  .extend(newsletterEnv.partial().shape)
  .extend(fieldEncryptionEnv.shape)
  .extend(publicUrlsEnv.pick({ WEB_URL: true }).shape);

export const getWebEnv = lazyEnv(() => loadEnv(webEnvSchema, process.env));

export const getAppUrls = lazyEnv(() =>
  loadEnv(baseEnv.extend(publicUrlsEnv.shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);
