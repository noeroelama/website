import "server-only";
import type { Message, MessageChannel } from "@website/domain/messaging";

export interface WahaConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly session: string;
}

/** `+6281234567890` → `6281234567890@c.us` (WAHA's chat id for a phone number). */
export const whatsappChatId = (e164: string) => `${e164.replace(/^\+/, "")}@c.us`;

/** One WhatsApp text: the subject in bold (WhatsApp markup), then the plain text. */
export const whatsappText = (message: Pick<Message, "subject" | "text">) =>
  message.subject ? `*${message.subject}*\n\n${message.text}` : message.text;

/**
 * WhatsApp channel over WAHA (`POST {base}/api/sendText`, `X-Api-Key`) for proactive messages
 * (J1). Never throws: no config → `not_configured`, HTTP error → `waha_<status>`, network
 * error or timeout → `waha_unreachable` (the message log keeps it for a retry).
 */
export function wahaChannel(
  config: WahaConfig | null,
  fetchImpl: typeof fetch = fetch,
): MessageChannel {
  return {
    async send(message) {
      if (!config || !message.to) return { ok: false, error: "not_configured" };
      try {
        const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/api/sendText`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
          body: JSON.stringify({
            session: config.session,
            chatId: whatsappChatId(message.to),
            text: whatsappText(message),
          }),
        });
        if (!response.ok) return { ok: false, error: `waha_${response.status}` };
        const body = (await response.json().catch(() => ({}))) as {
          id?: string | { _serialized?: string };
        };
        const id = typeof body.id === "string" ? body.id : (body.id?._serialized ?? "");
        return { ok: true, providerId: id };
      } catch {
        return { ok: false, error: "waha_unreachable" };
      }
    },
  };
}
