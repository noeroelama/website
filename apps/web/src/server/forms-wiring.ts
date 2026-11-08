import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlFormWebStore } from "@website/db/sql";
import { createRecaptchaVerifier, passesCaptcha } from "./captcha";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { createFormSubmission, createPublicFormReader } from "./forms";

const store = lazyEnv(() => createSqlFormWebStore(webDb()));

export const publicFormByToken = lazyEnv(() =>
  createPublicFormReader({ find: (token) => store().findPublic(token, new Date()) }),
);

export async function publishedPublicForms() {
  "use cache";
  cacheTag("forms");
  cacheLife("minutes");
  return store().listPublished();
}

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
