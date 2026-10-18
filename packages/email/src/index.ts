/**
 * Email sending port + adapters. Called synchronously with a timeout; failures are
 * recorded by the caller (email_log) and retried manually from admin. No queue.
 */
export interface EmailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Required: makes retries safe (provider de-duplicates). */
  readonly idempotencyKey: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string }
  | { readonly ok: false; readonly error: "timeout" | "rejected" | "provider_error" };

export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

/** Resend adapter over plain fetch (no SDK dependency). */
export function createResendSender(options: {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async send(message) {
      try {
        const response = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: message.headers,
          }),
        });
        if (response.status >= 400 && response.status < 500)
          return { ok: false, error: "rejected" };
        if (!response.ok) return { ok: false, error: "provider_error" };
        const body = (await response.json()) as { id?: unknown };
        return typeof body.id === "string"
          ? { ok: true, providerMessageId: body.id }
          : { ok: false, error: "provider_error" };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof DOMException && error.name === "TimeoutError"
              ? "timeout"
              : "provider_error",
        };
      }
    },
  };
}

/** Development/test adapter: records messages in memory, sends nothing. */
export function createMemorySender(): EmailSender & { readonly sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve({ ok: true, providerMessageId: `memory-${sent.length}` });
    },
  };
}
export { emailChannel } from "./channel";
