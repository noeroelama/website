import type { EmailSender } from "./index";

export function emailChannel(sender: EmailSender | null, from: string | undefined) {
  return {
    async send(
      message: { readonly to: string | null; subject: string; text: string; html: string },
      key: string,
    ): Promise<{ ok: true; providerId: string } | { ok: false; error: string }> {
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
