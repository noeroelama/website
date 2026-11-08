export const MESSAGE_CHANNELS = ["email", "whatsapp"] as const;
export type MessageChannelName = (typeof MESSAGE_CHANNELS)[number];

export interface Message {
  readonly channel: MessageChannelName;
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

export interface MessageLogStore {
  claim(key: string, message: Message, now: Date): Promise<"new" | "duplicate">;
  finish(
    key: string,
    outcome: { status: MessageStatus; providerId?: string; lastError?: string; attempted: boolean },
    now: Date,
  ): Promise<void>;
  claimRetry(id: string, now: Date): Promise<MessageLogEntry | null>;
}

export interface Contact {
  readonly email: string | null;
  readonly phone: string | null;
}

export function messageTo(
  contact: Contact | null,
  content: Pick<Message, "subject" | "text" | "html">,
): Message {
  return contact?.phone
    ? { channel: "whatsapp", to: contact.phone, ...content }
    : { channel: "email", to: contact?.email ?? null, ...content };
}

export function isValidMessageKey(key: string): boolean {
  return key.length <= 300 && /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_.@-]+)*$/.test(key);
}

export type MessagingMode = "log" | "live";

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

export function createMessenger(deps: {
  log: MessageLogStore;
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

    async retry(id: string): Promise<MessageStatus | null> {
      const entry = await deps.log.claimRetry(id, deps.now());
      return entry ? deliver(entry, entry.key) : null;
    },
  };
}

export type Messenger = ReturnType<typeof createMessenger>;

export const SURVEY_SOURCES = ["finance", "lpj", "recruitment"] as const;
export type SurveySource = (typeof SURVEY_SOURCES)[number];
export const SURVEY_SOURCE_LABELS: Record<SurveySource, string> = {
  finance: "Finance requests (paid)",
  lpj: "LPJ (approved)",
  recruitment: "Recruitment (confirmed)",
};

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
  readonly pollMessageId: string | null;
  readonly options: Readonly<Record<string, number>>;
  readonly stars: number | null;
  readonly sentAt: Date;
  readonly votedAt: Date | null;
}

export function starsOf(
  survey: Pick<Survey, "options">,
  selected: readonly string[],
): number | null {
  const label = selected[0];
  return label !== undefined && Object.hasOwn(survey.options, label)
    ? (survey.options[label] as number)
    : null;
}

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
