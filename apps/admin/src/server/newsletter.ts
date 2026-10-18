import "server-only";
import { z } from "zod";
import type {
  FirestoreCampaignStore,
  FirestoreSubscriberReader,
  SubscriberRow,
} from "@website/db/firestore";
import type { Message, MessageStatus } from "@website/domain/messaging";
import {
  CampaignInputSchema,
  canChangeCampaign,
  isDue,
  sendState,
  type Campaign,
} from "@website/domain/newsletter";
import { RuleViolationError } from "@website/domain/shared";
import { htmlToText, sanitizeRichText } from "@website/security/html";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface NewsletterDeps {
  readonly campaigns: Pick<FirestoreCampaignStore, "write" | "get" | "listActive" | "progress">;
  readonly subscribers: Pick<FirestoreSubscriberReader, "listForAdmin" | "confirmedAfter">;
  /** Messenger send (idempotent per key: a re-run never mails anyone twice). */
  readonly send: (message: Message, key: string) => Promise<MessageStatus | "duplicate">;
  /** Signed unsubscribe link for one subscriber (web /newsletter/unsubscribe). */
  readonly unsubscribeUrl: (subscriberId: string) => string;
  /** The signed-in staff member's e-mail (Send Test goes there only). */
  readonly staffEmail: (userId: string) => Promise<string | null>;
  /** Security event for every subscriber export. */
  readonly logExport: (actorId: string, rows: number) => void;
  readonly now: () => Date;
  /** Recipients per cron run (100 in production). */
  readonly batchSize: number;
}

const NOT_CHANGEABLE = "This campaign is being sent or was sent; it cannot be changed.";
const SaveInput = CampaignInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
}).strict();
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

type Action = "CREATE" | "UPDATE" | "SEND" | "DELETE";

/** Audit entry for one campaign change (module `newsletter`, resource `campaign`). */
const campaignAudit =
  (audit: AuditBuilder, action: Action, revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Campaign | null,
    next: Campaign,
  ) =>
    audit({
      module: "newsletter",
      action,
      resourceType: "campaign",
      resourceId: next.id,
      title: next.subject,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

const changeable = (current: Campaign | null): Campaign => {
  if (!current || !canChangeCampaign(current.status)) throw new RuleViolationError(NOT_CHANGEABLE);
  return current;
};

/** One campaign e-mail for one subscriber, with that subscriber's unsubscribe link. */
export function campaignMessage(campaign: Campaign, to: string, unsubscribeUrl: string): Message {
  const body = sanitizeRichText(campaign.body);
  return {
    channel: "email",
    to,
    subject: campaign.subject,
    html: `${body}<hr><p><a href="${unsubscribeUrl}">Berhenti berlangganan / Unsubscribe</a></p>`,
    text: `${htmlToText(body)}\n\n--\nBerhenti berlangganan / Unsubscribe: ${unsubscribeUrl}`,
  };
}

/** Admin Newsletter page actions, subscriber export and the "newsletter-send" cron job. */
export function createNewsletterActions(deps: NewsletterDeps) {
  const save = createGuardedAction({
    permission: "newsletter.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.campaigns.write(
        id ?? null,
        version,
        (current) => ({
          ...input,
          body: sanitizeRichText(input.body),
          status: current ? changeable(current).status : "draft",
          sendAt: current?.sendAt ?? null,
          cursor: null,
          sentCount: 0,
          sentAt: null,
          deletedAt: null,
        }),
        (before, after, current, next) =>
          campaignAudit(audit, current ? "UPDATE" : "CREATE")(before, after, current, next),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  /** Send now or schedule (newsletter.send). Audited SEND; e-mails cannot be taken back. */
  const send = createGuardedAction({
    permission: "newsletter.send",
    input: RefInput.extend({ sendAt: z.coerce.date().nullable() }).strict(),
    handler: async ({ id, version, sendAt }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.campaigns.write(
        id,
        version,
        (current) => {
          const campaign = changeable(current);
          if (!htmlToText(campaign.body)) throw new RuleViolationError("Write the content first.");
          return { ...campaign, ...sendState(sendAt, now) };
        },
        campaignAudit(audit, "SEND", false),
        now,
      );
      return { version: saved.version, status: saved.status };
    },
  });

  const remove = createGuardedAction({
    permission: "newsletter.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.campaigns.write(
        id,
        version,
        (current) => ({ ...changeable(current), deletedAt: now }),
        campaignAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  /** Send Test: the saved campaign, to the signed-in staff member only. */
  const sendTest = createGuardedAction({
    permission: "newsletter.edit",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal) => {
      const [campaign, to] = await Promise.all([
        deps.campaigns.get(id),
        deps.staffEmail(principal.userId),
      ]);
      if (!campaign || campaign.deletedAt) throw new RuleViolationError("Save the campaign first.");
      if (!to) throw new RuleViolationError("Your account has no e-mail address.");
      const now = deps.now();
      const status = await deps.send(
        campaignMessage({ ...campaign, subject: `[TEST] ${campaign.subject}` }, to, "#"),
        `newsletter:${id}:test:${now.getTime()}`,
      );
      return { status };
    },
  });

  /** CSV of the subscriber list (newsletter.export), logged as a security event. */
  const exportSubscribers = createGuardedAction({
    permission: "newsletter.export",
    input: z.object({}).strict(),
    handler: async (_input, principal) => {
      const rows = await deps.subscribers.listForAdmin();
      deps.logExport(principal.userId, rows.length);
      const csv = (row: SubscriberRow) =>
        [row.email, row.status, row.createdAt.toISOString(), row.confirmedAt?.toISOString() ?? ""]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(",");
      return { csv: ["email,status,subscribed,confirmed", ...rows.map(csv)].join("\r\n") };
    },
  });

  /**
   * Cron job "newsletter-send": the next batch (default 100) of confirmed subscribers of the
   * oldest due campaign. Each e-mail has the key newsletter:{campaignId}:{subscriberId}, so a run
   * that crashed half-way repeats its batch without mailing anyone twice.
   */
  const runBatch = async (): Promise<Record<string, unknown>> => {
    const now = deps.now();
    const limit = deps.batchSize;
    const [due] = (await deps.campaigns.listActive())
      .filter((c) => isDue(c, now))
      .sort((a, b) => Number(a.sendAt) - Number(b.sendAt));
    if (!due) return { processed: 0 };
    const batch = await deps.subscribers.confirmedAfter(due.cursor, limit);
    let sent = 0;
    for (const subscriber of batch) {
      const status = await deps.send(
        campaignMessage(due, subscriber.email, deps.unsubscribeUrl(subscriber.id)),
        `newsletter:${due.id}:${subscriber.id}`,
      );
      if (status !== "duplicate") sent++;
    }
    await deps.campaigns.progress(
      due.id,
      { cursor: batch.at(-1)?.id ?? null, sent, done: batch.length < limit },
      now,
    );
    return { campaign: due.id, processed: batch.length };
  };

  return { save, send, remove, sendTest, exportSubscribers, runBatch };
}
