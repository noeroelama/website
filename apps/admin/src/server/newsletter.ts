import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  SqlCampaignStore,
  SqlSubscriberReader,
  SqlSubscriberStore,
  SubscriberRow,
} from "@website/db/sql";
import type { Message, MessageStatus } from "@website/domain/messaging";
import {
  CampaignInputSchema,
  OPTIN_TTL_MS,
  SubscriberInputSchema,
  canChangeCampaign,
  canDeleteCampaign,
  canReceiveCampaigns,
  isDue,
  maskEmail,
  parseSubscriberCsv,
  sendState,
  trackLinks,
  type Campaign,
} from "@website/domain/newsletter";
import { RuleViolationError } from "@website/domain/shared";
import { htmlToText, sanitizeRichText } from "@website/security/html";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface NewsletterDeps {
  readonly campaigns: Pick<SqlCampaignStore, "write" | "get" | "listActive" | "progress">;
  readonly subscribers: Pick<SqlSubscriberReader, "listForAdmin" | "confirmedAfter"> &
    Pick<SqlSubscriberStore, "staffAdd" | "remove">;
  /** Messenger send (idempotent per key: a re-run never mails anyone twice). */
  readonly send: (message: Message, key: string) => Promise<MessageStatus | "duplicate">;
  /** Signed unsubscribe link for one subscriber (web /newsletter/unsubscribe). */
  readonly unsubscribeUrl: (subscriberId: string) => string;
  /** Signed open pixel and click links (web /newsletter/o and /newsletter/c). */
  readonly openUrl: (campaignId: string, subscriberId: string) => string;
  readonly clickUrl: (campaignId: string, subscriberId: string, url: string) => string;
  /** Add / Import: subscriber id (keyed hash, same as web), a random token, the confirm link. */
  readonly subscriberId: (email: string) => string;
  readonly newToken: () => string;
  readonly confirmUrl: (subscriberId: string, token: string) => string;
  /** PPIs (chapters) a subscriber can belong to. */
  readonly chapters: () => Promise<readonly { id: string; name: string }[]>;
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

/**
 * One campaign e-mail for one subscriber, with that subscriber's unsubscribe link and, when
 * `tracking` is given, tracked links and an open pixel (Send Test has neither).
 */
export function campaignMessage(
  campaign: Campaign,
  to: string,
  unsubscribeUrl: string,
  tracking?: { open: string; click: (url: string) => string },
): Message {
  const body = sanitizeRichText(campaign.body);
  const html = tracking ? trackLinks(body, tracking.click) : body;
  const pixel = tracking ? `<img src="${tracking.open}" width="1" height="1" alt="">` : "";
  return {
    channel: "email",
    to,
    subject: campaign.subject,
    html: `${html}<hr><p><a href="${unsubscribeUrl}">Berhenti berlangganan / Unsubscribe</a></p>${pixel}`,
    text: `${htmlToText(body)}\n\n--\nBerhenti berlangganan / Unsubscribe: ${unsubscribeUrl}`,
  };
}

/** Confirmation e-mail for someone staff added (bilingual: admin has no visitor language). */
function optInMessage(to: string, link: string): Message {
  const body =
    "PPIDK Asia-Oseania menambahkan alamat ini ke newsletter kami. Buka tautan di bawah untuk " +
    "mengonfirmasi. / PPIDK Asia-Oseania added this address to our newsletter. Open the link " +
    "below to confirm.";
  const ignore =
    "Abaikan e-mail ini jika Anda tidak ingin berlangganan. / Ignore this e-mail if you do not " +
    "want to subscribe.";
  return {
    channel: "email",
    to,
    subject: "Konfirmasi langganan newsletter / Confirm your newsletter subscription",
    text: `${body}\n\n${link}\n\n${ignore}`,
    html: `<p>${body}</p><p><a href="${link}">Konfirmasi / Confirm</a></p><p>${ignore}</p>`,
  };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

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
          openCount: 0,
          clickCount: 0,
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
        (current) => {
          if (!current || !canDeleteCampaign(current.status)) {
            throw new RuleViolationError("This campaign is being sent; wait until it is done.");
          }
          return { ...current, deletedAt: now };
        },
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

  /**
   * One staff-added address: the double opt-in e-mail goes out after the transaction committed
   * (key newsletter:{id}:optin:{n}, shared with the website, so nobody gets it twice).
   */
  const addOne = async (
    input: { email: string; name: string | null; chapterId: string | null },
    audit: AuditBuilder,
  ) => {
    const id = deps.subscriberId(input.email);
    const token = deps.newToken();
    const now = deps.now();
    const result = await deps.subscribers.staffAdd(
      id,
      input.email,
      { name: input.name, chapterId: input.chapterId },
      sha256(token),
      new Date(now.getTime() + OPTIN_TTL_MS),
      now,
      (after, versionBefore, versionAfter) =>
        audit({
          module: "newsletter",
          action: "CREATE",
          resourceType: "subscriber",
          resourceId: id,
          title: maskEmail(input.email),
          before: null,
          after,
          versionBefore,
          versionAfter,
          // The confirmation e-mail is already out; delete the subscriber instead.
          revertible: false,
        }),
    );
    if (result.outcome === "start") {
      await deps.send(
        optInMessage(input.email, deps.confirmUrl(id, token)),
        `newsletter:${id}:optin:${result.optIn}`,
      );
    }
    return result.outcome;
  };

  const knownChapter = async (chapterId: string | null) => {
    if (chapterId === null) return;
    const chapters = await deps.chapters();
    if (!chapters.some((c) => c.id === chapterId)) {
      throw new RuleViolationError("Choose a PPI from the list.");
    }
  };

  /** "Add New Subscriber" (newsletter.edit): pending until the person confirms by e-mail. */
  const addSubscriber = createGuardedAction({
    permission: "newsletter.edit",
    input: SubscriberInputSchema,
    handler: async ({ email, name, chapterId }, _principal, audit) => {
      await knownChapter(chapterId);
      return { outcome: await addOne({ email, name: name || null, chapterId }, audit) };
    },
  });

  /** "Import CSV" (newsletter.edit): every new address gets its own opt-in e-mail. */
  const importSubscribers = createGuardedAction({
    permission: "newsletter.edit",
    input: z.object({ csv: z.string().max(500_000) }).strict(),
    handler: async ({ csv }, _principal, audit) => {
      const parsed = parseSubscriberCsv(csv);
      if (!parsed.ok) throw new RuleViolationError(parsed.error);
      const byName = new Map((await deps.chapters()).map((c) => [c.name.toLowerCase(), c.id]));
      const counts = { added: 0, existing: 0, unsubscribed: 0 };
      for (const row of parsed.rows) {
        const outcome = await addOne(
          {
            email: row.email,
            name: row.name || null,
            chapterId: byName.get(row.ppi.toLowerCase()) ?? null,
          },
          audit,
        );
        counts[
          outcome === "start" ? "added" : outcome === "exists" ? "existing" : "unsubscribed"
        ]++;
      }
      return { ...counts, invalid: parsed.invalid };
    },
  });

  /** Delete a subscriber (newsletter.edit): soft delete, revertible on the Audit Log. */
  const removeSubscriber = createGuardedAction({
    permission: "newsletter.edit",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, _principal, audit) => {
      await deps.subscribers.remove(id, deps.now(), (email, before, versionBefore, versionAfter) =>
        audit({
          module: "newsletter",
          action: "DELETE",
          resourceType: "subscriber",
          resourceId: id,
          title: maskEmail(email),
          before,
          after: null,
          versionBefore,
          versionAfter,
          revertible: true,
        }),
      );
      return { id };
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
        [
          row.email,
          row.name ?? "",
          row.status,
          row.createdAt.toISOString(),
          row.confirmedAt?.toISOString() ?? "",
        ]
          .map((v) => `"${v.replace(/"/g, '""')}"`)
          .join(",");
      return { csv: ["email,name,status,subscribed,confirmed", ...rows.map(csv)].join("\r\n") };
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
    for (const subscriber of batch.filter(canReceiveCampaigns)) {
      const status = await deps.send(
        campaignMessage(due, subscriber.email, deps.unsubscribeUrl(subscriber.id), {
          open: deps.openUrl(due.id, subscriber.id),
          click: (url) => deps.clickUrl(due.id, subscriber.id, url),
        }),
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

  return {
    save,
    send,
    remove,
    sendTest,
    addSubscriber,
    importSubscribers,
    removeSubscriber,
    exportSubscribers,
    runBatch,
  };
}
