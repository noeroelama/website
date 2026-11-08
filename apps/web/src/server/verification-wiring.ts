import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlVerificationReader } from "@website/db/sql";
import {
  CERTIFICATE_EMAIL_PURPOSE,
  CERTIFICATE_PICKUP_LINK_MS,
  CERTIFICATE_PICKUP_PURPOSE,
} from "@website/domain/documents";
import { keyedHash, signLink } from "@website/security";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb, webStorage } from "./db";
import { getAppUrls, getWebEnv } from "./env";
import { createCertificatePickup, createVerification } from "./verification";

export const verification = lazyEnv(() =>
  createVerification({
    reader: createSqlVerificationReader(webDb()),
    readFile: (path) => webStorage().read(path),
  }),
);

export const certificatePickup = lazyEnv(() => {
  const env = getWebEnv();
  const admin = getAppUrls().ADMIN_URL;
  const { SUBSCRIBER_HASH_SECRET: hashSecret, LINK_SIGNING_SECRET: linkSecret } = env;
  if (!hashSecret || !linkSecret || !admin) {
    throw new Error("SUBSCRIBER_HASH_SECRET, LINK_SIGNING_SECRET and ADMIN_URL are required.");
  }
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createCertificatePickup({
    reader: createSqlVerificationReader(webDb()),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "certificate_pickup",
      ),
    hashEmail: (email) => keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, hashSecret),
    link: (code) =>
      `${admin}/certificates/pickup?t=${signLink(
        { purpose: CERTIFICATE_PICKUP_PURPOSE, code },
        linkSecret,
        new Date(Date.now() + CERTIFICATE_PICKUP_LINK_MS),
      )}`,
  });
});
