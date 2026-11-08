import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlMessageLog } from "@website/db/sql";
import { createMessenger } from "@website/domain/messaging";
import { createResendSender, emailChannel } from "@website/email";
import { webDb } from "./db";
import { getWebEnv } from "./env";

export const messenger = lazyEnv(() => {
  const env = getWebEnv();
  return createMessenger({
    log: createSqlMessageLog(webDb()),
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
