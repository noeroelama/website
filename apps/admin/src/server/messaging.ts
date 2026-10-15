import "server-only";
import { z } from "zod";
import type { Messenger, MessageChannel } from "@website/domain/messaging";
import { RuleViolationError } from "@website/domain/shared";
import type { EmailSender } from "@website/email";
import { safeId } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

/** E-mail channel over the Resend sender (`@website/email`); the message key is the idempotency key. */
export function emailChannel(sender: EmailSender | null, from: string | undefined): MessageChannel {
  return {
    async send(message, key) {
      if (!sender || !from || !message.to) return { ok: false, error: "not_configured" };
      const result = await sender.send({
        to: message.to,
        from,
        subject: message.subject,
        text: message.text,
        html: message.html,
        idempotencyKey: key,
      });
      return result.ok
        ? { ok: true, providerId: result.providerMessageId }
        : { ok: false, error: result.error };
    },
  };
}

/** Admin Messages page: one more attempt for a failed message (`messages.edit`). */
export function createMessageActions(deps: { messenger: Pick<Messenger, "retry"> }) {
  const retry = createGuardedAction({
    permission: "messages.edit",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }) => {
      const status = await deps.messenger.retry(id);
      if (status === null) throw new RuleViolationError("Only failed messages can be retried.");
      return { status };
    },
  });
  return { retry };
}
