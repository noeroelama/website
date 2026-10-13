import "server-only";
import {
  baseEnv,
  captchaEnv,
  firebaseAdminEnv,
  lazyEnv,
  loadEnv,
  publicUrlsEnv,
  sessionEnv,
} from "@website/config/env";

/** Public content, member self-service, sign-in and CAPTCHA. Validated lazily at first use, not at build. */
const webEnvSchema = baseEnv
  .extend(firebaseAdminEnv.shape)
  .extend(sessionEnv.shape)
  .extend(captchaEnv.partial().shape)
  .extend(publicUrlsEnv.pick({ WEB_URL: true }).shape);

export const getWebEnv = lazyEnv(() => loadEnv(webEnvSchema, process.env));

/**
 * Our apps' public URLs only (no secrets), for the sign-in return target. Loaded separately so
 * the static sign-in page works without Firebase configuration.
 */
export const getAppUrls = lazyEnv(() =>
  loadEnv(baseEnv.extend(publicUrlsEnv.shape), {
    APP_ENV: process.env["NODE_ENV"] === "development" ? "development" : undefined,
    ...process.env,
  }),
);
