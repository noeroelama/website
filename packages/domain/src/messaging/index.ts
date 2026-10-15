/**
 * Messaging (J1): one port for every outgoing message, an outbox-style log with an idempotency
 * key per message, and the rules that keep test environments from messaging real people (all
 * environments share the live data). Email first; WhatsApp is added as a second channel later.
 */
export const MESSAGE_CHANNELS = ["email"] as const;
export type MessageChannelName = (typeof MESSAGE_CHANNELS)[number];

export interface Message {
  readonly channel: MessageChannelName;
  /** E-mail address (or, later, E.164 phone). null/empty = nothing to send to → "skipped". */
  readonly to: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "failed",
  "skipped",
  "logged",
  "blocked",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** A channel adapter (Resend for e-mail). Must not throw; failures come back as `error`. */
export interface MessageChannel {
  send(
    message: Message,
    key: string,
  ): Promise<{ ok: true; providerId: string } | { ok: false; error: string }>;
}

export interface MessageLogEntry extends Message {
  readonly id: string;
  readonly key: string;
  readonly status: MessageStatus;
  readonly attempts: number;
  readonly providerId: string | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Storage port (`messageLog` in @website/db). */
export interface MessageLogStore {
  /** Creates the entry (status queued) unless the key exists: "new" | "duplicate". Atomic. */
  claim(key: string, message: Message, now: Date): Promise<"new" | "duplicate">;
  /** Records the outcome of one delivery attempt. */
  finish(
    key: string,
    outcome: { status: MessageStatus; providerId?: string; lastError?: string; attempted: boolean },
    now: Date,
  ): Promise<void>;
  /** A failed entry, claimed for one more attempt (null when it is not failed). Atomic. */
  claimRetry(id: string, now: Date): Promise<MessageLogEntry | null>;
}

/** `<topic>:<id>:<event>…` — letters, digits and `_ - . @` per part, max 300 characters. */
export function isValidMessageKey(key: string): boolean {
  return key.length <= 300 && /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_.@-]+)*$/.test(key);
}

export type MessagingMode = "log" | "live";

/**
 * - `log`: record only, never call a provider (default outside production).
 * - `live` in production: send.
 * - `live` elsewhere: send only to MESSAGING_TEST_RECIPIENTS, block everyone else.
 */
export function deliveryDecision(input: {
  mode: MessagingMode;
  appEnv: string;
  recipient: string;
  testRecipients: readonly string[];
}): "send" | "log" | "block" {
  if (input.mode === "log") return "log";
  if (input.appEnv === "production") return "send";
  const recipient = input.recipient.toLowerCase();
  return input.testRecipients.some((r) => r.toLowerCase() === recipient) ? "send" : "block";
}

/**
 * Sends a message at most once per key. Call it AFTER the transaction that caused the message
 * has committed: the log entry is claimed first (a duplicate key returns "duplicate" and sends
 * nothing), then the channel is called and the outcome recorded. Failed entries are retried
 * from the admin Messages page (`retry`).
 */
export function createMessenger(deps: {
  log: MessageLogStore;
  channels: Readonly<Record<MessageChannelName, MessageChannel>>;
  mode: MessagingMode;
  appEnv: string;
  testRecipients: readonly string[];
  now: () => Date;
}) {
  async function deliver(message: Message, key: string): Promise<MessageStatus> {
    const to = message.to?.trim();
    if (!to) {
      await deps.log.finish(key, { status: "skipped", attempted: false }, deps.now());
      return "skipped";
    }
    const decision = deliveryDecision({
      mode: deps.mode,
      appEnv: deps.appEnv,
      recipient: to,
      testRecipients: deps.testRecipients,
    });
    if (decision !== "send") {
      const status = decision === "log" ? "logged" : "blocked";
      await deps.log.finish(key, { status, attempted: false }, deps.now());
      return status;
    }
    const result = await deps.channels[message.channel].send({ ...message, to }, key);
    await deps.log.finish(
      key,
      result.ok
        ? { status: "sent", providerId: result.providerId, attempted: true }
        : { status: "failed", lastError: result.error, attempted: true },
      deps.now(),
    );
    return result.ok ? "sent" : "failed";
  }

  return {
    async send(message: Message, key: string): Promise<MessageStatus | "duplicate"> {
      if (!isValidMessageKey(key)) throw new Error("Invalid message key.");
      if ((await deps.log.claim(key, message, deps.now())) === "duplicate") return "duplicate";
      return deliver(message, key);
    },

    /** One more attempt for a FAILED entry; null when the entry is missing or not failed. */
    async retry(id: string): Promise<MessageStatus | null> {
      const entry = await deps.log.claimRetry(id, deps.now());
      return entry ? deliver(entry, entry.key) : null;
    },
  };
}

export type Messenger = ReturnType<typeof createMessenger>;
