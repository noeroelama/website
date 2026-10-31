import "server-only";
import { lazyEnv } from "@website/config/env";
import { createFirestoreVerificationReader } from "@website/db/firestore";
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

/** /verify/<code> (D7): letters by verification code, archived PDFs from private Storage. */
export const verification = lazyEnv(() =>
  createVerification({
    reader: createFirestoreVerificationReader(webDb()),
    readFile: (path) => webStorage().read(path),
  }),
);

/**
 * /certificates (D5-P). Needs SUBSCRIBER_HASH_SECRET and LINK_SIGNING_SECRET (the same values as
 * apps/admin) and ADMIN_URL (the download route lives in admin, where sheets are rendered).
 */
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
    reader: createFirestoreVerificationReader(webDb()),
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
