import type { Firestore } from "firebase-admin/firestore";
import type { Snapshot } from "@website/audit";
import type { Campaign, CampaignSegment, CampaignStatus } from "@website/domain/newsletter";
import { safeId } from "@website/security/validation";
import { createSluggedStore, toDate } from "./slugged";

export type CampaignFields = Omit<Campaign, "id" | "version" | "createdAt" | "updatedAt">;

function toCampaign(id: string, data: Record<string, unknown>): Campaign {
  return {
    id,
    subject: data["subject"] as string,
    body: data["body"] as string,
    segment: data["segment"] as CampaignSegment,
    status: data["status"] as CampaignStatus,
    sendAt: toDate(data["sendAt"]),
    cursor: data["cursor"] as string | null,
    sentCount: data["sentCount"] as number,
    sentAt: toDate(data["sentAt"]),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function campaignSnapshot(c: CampaignFields): Snapshot {
  return {
    subject: c.subject,
    body: c.body,
    segment: c.segment,
    status: c.status,
    sendAt: iso(c.sendAt),
  };
}

/**
 * `campaigns/{id}`. Staff changes go through `write` (version check + audit); the cron job moves a
 * campaign forward with `progress` (system bookkeeping: cursor, count, sent).
 */
export function createFirestoreCampaignStore(db: Firestore) {
  const store = createSluggedStore<Campaign>(db, {
    collection: "campaigns",
    slug: null,
    fromDoc: toCampaign,
    snapshot: campaignSnapshot,
    fixed: (c) => ({ cursor: c.cursor, sentCount: c.sentCount, sentAt: c.sentAt }),
  });

  return {
    async listForAdmin(limit = 500): Promise<Campaign[]> {
      const snapshot = await store.docs.orderBy("updatedAt", "desc").limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((c) => c.deletedAt === null);
    },
    get: store.get,
    write: store.write,

    /** Scheduled or sending campaigns (the cron job picks the due ones). */
    async listActive(): Promise<Campaign[]> {
      const snapshot = await store.docs.where("status", "in", ["scheduled", "sending"]).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((c) => c.deletedAt === null);
    },

    /** After one batch: remember where it stopped; `done` marks the campaign sent. */
    progress(
      id: string,
      update: { cursor: string | null; sent: number; done: boolean },
      now: Date,
    ): Promise<void> {
      const ref = store.docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = toCampaign(id, snapshot.data() as Record<string, unknown>);
        tx.update(ref, {
          status: update.done ? "sent" : "sending",
          cursor: update.cursor ?? current.cursor,
          sentCount: current.sentCount + update.sent,
          sentAt: update.done ? now : null,
          updatedAt: now,
        });
      });
    },
  };
}

export type FirestoreCampaignStore = ReturnType<typeof createFirestoreCampaignStore>;
