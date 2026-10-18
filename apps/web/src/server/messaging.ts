import "server-only";
import { lazyEnv } from "@website/config/env";
import { createFirestoreMessageLog } from "@website/db/firestore";
import { createMessenger } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { webDb } from "./db";
import { getWebEnv } from "./env";

/**
 * Confirmation e-mails sent by the website, through the same message log as admin (failed ones
 * are retried from the admin Messages page). Call `messenger().send` AFTER the transaction commits.
 */
export const messenger = lazyEnv(() => {
  const env = getWebEnv();
  return createMessenger({
    log: createFirestoreMessageLog(webDb()),
    channels: {
      email: emailChannel(
        env.RESEND_API_KEY ? createResendSender({ apiKey: env.RESEND_API_KEY }) : null,
        env.EMAIL_FROM_TRANSACTIONAL,
      ),
    },
    mode: env.MESSAGING_MODE,
    appEnv: env.APP_ENV,
    testRecipients: env.MESSAGING_TEST_RECIPIENTS,
    now: () => new Date(),
  });
});
