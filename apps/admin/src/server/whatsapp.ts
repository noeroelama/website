import "server-only";
import type { Message, MessageChannel } from "@website/domain/messaging";

export interface WahaConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly session: string;
}

export const whatsappChatId = (e164: string) => `${e164.replace(/^\+/, "")}@c.us`;

export const whatsappText = (message: Pick<Message, "subject" | "text">) =>
  message.subject ? `*${message.subject}*\n\n${message.text}` : message.text;

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

export function wahaPoll(config: WahaConfig | null, fetchImpl: typeof fetch = fetch) {
  return async (
    e164: string,
    question: string,
    options: readonly string[],
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> => {
    if (!config) return { ok: false, error: "not_configured" };
    try {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/api/sendPoll`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Api-Key": config.apiKey },
        body: JSON.stringify({
          session: config.session,
          chatId: whatsappChatId(e164),
          poll: { name: question, options, multipleAnswers: false },
        }),
      });
      if (!response.ok) return { ok: false, error: `waha_${response.status}` };
      const body = (await response.json().catch(() => ({}))) as {
        id?: string | { _serialized?: string };
      };
      const id = typeof body.id === "string" ? body.id : (body.id?._serialized ?? "");
      return id ? { ok: true, messageId: id } : { ok: false, error: "waha_no_id" };
    } catch {
      return { ok: false, error: "waha_unreachable" };
    }
  };
}
