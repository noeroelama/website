/**
 * Messaging (J1): one port for every outgoing message, an outbox-style log with an idempotency
 * key per message, and the rules that keep test environments from messaging real people (all
 * environments share the live data). E-mail (Resend) and WhatsApp (WAHA, proactive messages).
 */
export const MESSAGE_CHANNELS = ["email", "whatsapp"] as const;
export type MessageChannelName = (typeof MESSAGE_CHANNELS)[number];

export interface Message {
  readonly channel: MessageChannelName;
  /** E-mail address, or E.164 phone for WhatsApp. null/empty = nothing to send to → "skipped". */
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

/** Where a person can be reached: the account e-mail and the profile's WhatsApp number. */
export interface Contact {
  readonly email: string | null;
  /** E.164 (`memberProfiles.whatsappNumber`); null when there is no profile. */
  readonly phone: string | null;
}

/** The person's channel (J1): WhatsApp when a number exists, else e-mail. */
export function messageTo(
  contact: Contact | null,
  content: Pick<Message, "subject" | "text" | "html">,
): Message {
  return contact?.phone
    ? { channel: "whatsapp", to: contact.phone, ...content }
    : { channel: "email", to: contact?.email ?? null, ...content };
}

/** `<topic>:<id>:<event>…` — letters, digits and `_ - . @` per part, max 300 characters. */
export function isValidMessageKey(key: string): boolean {
  return key.length <= 300 && /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_.@-]+)*$/.test(key);
}

export type MessagingMode = "log" | "live";

/**
 * - `log`: record only, never call a provider (default outside production).
 * - `live` in production: send.
 * - `live` elsewhere: send only to MESSAGING_TEST_RECIPIENTS (e-mails or E.164 numbers), block
 *   everyone else.
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
 * from the admin Email page (`retry`).
 */
export function createMessenger(deps: {
  log: MessageLogStore;
  /** A channel left out (the website has no WhatsApp) fails its messages as `not_configured`. */
  channels: Readonly<Partial<Record<MessageChannelName, MessageChannel>>>;
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
    const channel = deps.channels[message.channel];
    const result = channel
      ? await channel.send({ ...message, to }, key)
      : { ok: false as const, error: "not_configured" };
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

/* ---------------------------------------------------------------- satisfaction polls (J3) */

/** What a WhatsApp poll asks after selected notifications (one per source event and person). */
export const SURVEY_SOURCES = ["finance", "lpj", "recruitment"] as const;
export type SurveySource = (typeof SURVEY_SOURCES)[number];
export const SURVEY_SOURCE_LABELS: Record<SurveySource, string> = {
  finance: "Finance requests (paid)",
  lpj: "LPJ (approved)",
  recruitment: "Recruitment (confirmed)",
};

/** The poll's options, frozen on every survey: label → stars. */
export const STAR_OPTIONS: Readonly<Record<string, number>> = {
  "⭐⭐⭐⭐⭐ Sangat puas / Very satisfied": 5,
  "⭐⭐⭐⭐ Puas / Satisfied": 4,
  "⭐⭐⭐ Cukup / Okay": 3,
  "⭐⭐ Kurang / Unsatisfied": 2,
  "⭐ Sangat kurang / Very unsatisfied": 1,
};
export const POLL_QUESTION =
  "Seberapa puas kamu dengan layanan ini? / How satisfied are you with this service?";

export interface Survey {
  readonly id: string;
  readonly source: SurveySource;
  readonly sourceId: string;
  readonly uid: string;
  /** WAHA message id of the poll (votes refer to it); null until sent. */
  readonly pollMessageId: string | null;
  readonly options: Readonly<Record<string, number>>;
  readonly stars: number | null;
  readonly sentAt: Date;
  readonly votedAt: Date | null;
}

/** Stars of a vote by the survey's FROZEN options (renamed options later change nothing). */
export function starsOf(
  survey: Pick<Survey, "options">,
  selected: readonly string[],
): number | null {
  // Single-answer polls: no selection = the vote was withdrawn.
  const label = selected[0];
  return label !== undefined && Object.hasOwn(survey.options, label)
    ? (survey.options[label] as number)
    : null;
}

/** Per source: polls sent, answered, average stars (one decimal), stars → count. */
export function surveySummary(surveys: ReadonlyArray<Pick<Survey, "source" | "stars">>) {
  return SURVEY_SOURCES.map((source) => {
    const mine = surveys.filter((s) => s.source === source);
    const voted = mine.flatMap((s) => (s.stars === null ? [] : [s.stars]));
    const distribution = [1, 2, 3, 4, 5].map((stars) => voted.filter((v) => v === stars).length);
    return {
      source,
      sent: mine.length,
      answered: voted.length,
      average: voted.length
        ? Math.round((voted.reduce((a, b) => a + b, 0) / voted.length) * 10) / 10
        : null,
      distribution,
    };
  });
}
