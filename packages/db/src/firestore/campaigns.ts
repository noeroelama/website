import type { Firestore } from "firebase-admin/firestore";
import type { Snapshot } from "@website/audit";
import {
  isPublicCampaign,
  type Campaign,
  type CampaignSegment,
  type CampaignStatus,
  type TrackingKind,
} from "@website/domain/newsletter";
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
    // Campaigns from before tracking have no counters.
    openCount: (data["openCount"] as number | undefined) ?? 0,
    clickCount: (data["clickCount"] as number | undefined) ?? 0,
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
    fixed: (c) => ({
      cursor: c.cursor,
      sentCount: c.sentCount,
      sentAt: c.sentAt,
      openCount: c.openCount,
      clickCount: c.clickCount,
    }),
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

/**
 * The website's side of campaigns: the public archive page and open/click tracking. A tracking
 * marker `campaignTracking/{kind}_{campaignId}_{subscriberId}` is written once per subscriber, and
 * the campaign's `openCount` / `clickCount` grow only when a marker is new (one transaction). A
 * click also counts as an open (images may be blocked).
 */
export function createFirestoreCampaignWebStore(db: Firestore) {
  const campaigns = db.collection("campaigns");
  const markers = db.collection("campaignTracking");

  return {
    async findPublic(id: string): Promise<Campaign | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await campaigns.doc(id).get();
      if (!snapshot.exists) return null;
      const campaign = toCampaign(id, snapshot.data() as Record<string, unknown>);
      return isPublicCampaign(campaign) ? campaign : null;
    },

    /** False when the campaign is unknown, not public (deleted) or the ids are invalid. */
    track(
      kind: TrackingKind,
      campaignId: string,
      subscriberId: string,
      now: Date,
    ): Promise<boolean> {
      const ref = campaigns.doc(safeId.parse(campaignId));
      const marker = (k: TrackingKind) =>
        markers.doc(safeId.parse(`${k}_${campaignId}_${subscriberId}`));
      const kinds: TrackingKind[] = kind === "click" ? ["open", "click"] : ["open"];
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const seen = await Promise.all(kinds.map((k) => tx.get(marker(k))));
        if (!snapshot.exists) return false;
        const campaign = toCampaign(campaignId, snapshot.data() as Record<string, unknown>);
        if (!isPublicCampaign(campaign)) return false;
        const fresh = kinds.filter((_, i) => !seen[i]?.exists);
        if (fresh.length === 0) return true;
        for (const k of fresh) tx.set(marker(k), { kind: k, campaignId, subscriberId, at: now });
        tx.update(ref, {
          openCount: campaign.openCount + (fresh.includes("open") ? 1 : 0),
          clickCount: campaign.clickCount + (fresh.includes("click") ? 1 : 0),
        });
        return true;
      });
    },
  };
}

export type FirestoreCampaignWebStore = ReturnType<typeof createFirestoreCampaignWebStore>;
