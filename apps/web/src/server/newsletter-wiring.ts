import "server-only";
import { randomBytes } from "node:crypto";
import { lazyEnv } from "@website/config/env";
import { createFirestoreSubscriberStore } from "@website/db/firestore";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { messenger } from "./messaging";
import { createNewsletter } from "./newsletter";

/** Newsletter field, confirm and unsubscribe pages (needs SUBSCRIBER_HASH_SECRET, LINK_SIGNING_SECRET). */
export const newsletter = lazyEnv(() => {
  const env = getWebEnv();
  if (!env.SUBSCRIBER_HASH_SECRET || !env.LINK_SIGNING_SECRET || !env.WEB_URL) {
    throw new Error("SUBSCRIBER_HASH_SECRET, LINK_SIGNING_SECRET and WEB_URL are required.");
  }
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createNewsletter({
    store: createFirestoreSubscriberStore(webDb()),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "newsletter",
      ),
    send: (message, key) => messenger().send(message, key),
    newToken: () => randomBytes(32).toString("base64url"),
    hashSecret: env.SUBSCRIBER_HASH_SECRET,
    linkSecret: env.LINK_SIGNING_SECRET,
    webUrl: env.WEB_URL,
    now: () => new Date(),
  });
});
