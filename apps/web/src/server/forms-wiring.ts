import "server-only";
import { lazyEnv } from "@website/config/env";
import { createFirestoreFormWebStore } from "@website/db/firestore";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { createFormSubmission, createPublicFormReader } from "./forms";

const store = lazyEnv(() => createFirestoreFormWebStore(webDb()));

/**
 * /f/{token}. Read per request (not cached): the answer window and the current version must be
 * the ones the answers are checked against.
 */
export const publicFormByToken = lazyEnv(() =>
  createPublicFormReader({ find: (token) => store().findPublic(token, new Date()) }),
);

/** Submit button of /f/{token} (src/app/f/[token]/actions.ts). */
export const submitPublicForm = lazyEnv(() => {
  const env = getWebEnv();
  const verifier = env.RECAPTCHA_SECRET_KEY
    ? createRecaptchaVerifier({ secret: env.RECAPTCHA_SECRET_KEY, fetchImpl: fetch })
    : null;
  return createFormSubmission({
    submit: (token, version, answers, now) => store().submit(token, version, answers, now),
    captcha: (token) =>
      passesCaptcha(
        verifier,
        { minScore: env.RECAPTCHA_MIN_SCORE ?? 0.5, appEnv: env.APP_ENV },
        token,
        "form_submit",
      ),
    now: () => new Date(),
  });
});
