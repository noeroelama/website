import type { Database } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  confirmDecision,
  optInDecision,
  staffOptInDecision,
  type SubscriptionStatus,
} from "@website/domain/newsletter";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { toDate } from "./slugged";

/** Audit snapshot of a subscriber: no address and no name (the title carries a masked address). */
export function subscriberSnapshot(data: {
  status: SubscriptionStatus;
  chapterId: string | null;
}): Snapshot {
  return { status: data.status, chapterId: data.chapterId };
}

/**
 * Newsletter subscribers: `subscribers/{emailHash}` (HMAC of the normalised address, so the id
 * never reveals it). Holds the address (needed to send), status, confirmedAt, the SHA-256 of the
 * current confirmation token and its expiry, how many opt-in e-mails were sent (`optIns`, part of
 * the message key), and — when staff added the person — `name` and `chapterId`. `version` and
 * `deletedAt` make a staff deletion revertible on the Audit Log. Every change is one transaction
 * and moves `version` on (so an old deletion is never reverted over a newer change).
 */
export function createSqlSubscriberStore(db: Database) {
  const subscribers = db.collection("subscribers");
  const audit = createSqlAuditWriter(db);
  const ref = (id: string) => subscribers.doc(safeId.parse(id));
  const read = (data: Record<string, unknown> | undefined) =>
    data
      ? {
          status: data["status"] as SubscriptionStatus,
          tokenHash: (data["tokenHash"] as string | null) ?? null,
          tokenExpiresAt: toDate(data["tokenExpiresAt"]),
          optIns: data["optIns"] as number,
          name: (data["name"] as string | null | undefined) ?? null,
          chapterId: (data["chapterId"] as string | null | undefined) ?? null,
          version: (data["version"] as number | undefined) ?? 0,
          deletedAt: toDate(data["deletedAt"]),
        }
      : null;
  type Current = ReturnType<typeof read>;

  /** A new or restarted opt-in (pending, fresh token); keeps an existing name and PPI. */
  const pending = (
    id: string,
    email: string,
    current: Current,
    createdAt: unknown,
    profile: { name: string | null; chapterId: string | null } | null,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ) => ({
    subscriberId: id,
    email,
    status: "pending" as const,
    confirmedAt: null,
    tokenHash,
    tokenExpiresAt: expiresAt,
    optIns: (current?.optIns ?? 0) + 1,
    name: profile?.name ?? current?.name ?? null,
    chapterId: profile?.chapterId ?? current?.chapterId ?? null,
    version: (current?.version ?? 0) + 1,
    deletedAt: null,
    createdAt: current && !current.deletedAt ? createdAt : now,
    updatedAt: now,
  });

  return {
    /** Sign-up: returns the opt-in number to send, or null when nothing was written. */
    startOptIn(
      id: string,
      email: string,
      tokenHash: string,
      expiresAt: Date,
      now: Date,
    ): Promise<{ optIn: number } | null> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const current = read(snapshot.data());
        if (optInDecision(current, now) === "nothing") return null;
        const fields = pending(
          id,
          email,
          current,
          snapshot.get("createdAt"),
          null,
          tokenHash,
          expiresAt,
          now,
        );
        tx.set(ref(id), fields);
        return { optIn: fields.optIns };
      });
    },

    /**
     * Staff "Add New Subscriber" / "Import CSV": the same opt-in (pending + confirmation e-mail)
     * with name and PPI, plus an audit entry in the same transaction. Nothing is written when the
     * address is already subscribed or pending, or when the person unsubscribed.
     */
    staffAdd(
      id: string,
      email: string,
      profile: { name: string | null; chapterId: string | null },
      tokenHash: string,
      expiresAt: Date,
      now: Date,
      auditFor: (after: Snapshot, versionBefore: number | null, versionAfter: number) => AuditEvent,
    ): Promise<{ outcome: "start"; optIn: number } | { outcome: "exists" | "unsubscribed" }> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const current = read(snapshot.data());
        const outcome = staffOptInDecision(current, now);
        if (outcome !== "start") return { outcome };
        const log = await audit.begin(tx);
        const fields = pending(
          id,
          email,
          current,
          snapshot.get("createdAt"),
          profile,
          tokenHash,
          expiresAt,
          now,
        );
        tx.set(ref(id), fields);
        log.append(auditFor(subscriberSnapshot(fields), current?.version ?? null, fields.version));
        return { outcome, optIn: fields.optIns };
      });
    },

    /** Staff delete (soft): hidden from the list and never mailed; revertible on the Audit Log. */
    remove(
      id: string,
      now: Date,
      auditFor: (
        email: string,
        before: Snapshot,
        versionBefore: number,
        versionAfter: number,
      ) => AuditEvent,
    ): Promise<void> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const current = read(snapshot.data());
        if (!current || current.deletedAt) {
          throw new RuleViolationError("This subscriber does not exist.");
        }
        const log = await audit.begin(tx);
        const version = current.version + 1;
        tx.update(ref(id), { deletedAt: now, version, updatedAt: now });
        log.append(
          auditFor(
            snapshot.get("email") as string,
            subscriberSnapshot(current),
            current.version,
            version,
          ),
        );
      });
    },

    /** Confirmation link: single use (the token is cleared). */
    confirm(id: string, tokenHash: string, now: Date) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const current = read(snapshot.data());
        const outcome = confirmDecision(current, tokenHash, now);
        if (current && outcome === "confirmed") {
          tx.update(ref(id), {
            status: "confirmed",
            confirmedAt: now,
            tokenHash: null,
            tokenExpiresAt: null,
            version: current.version + 1,
            updatedAt: now,
          });
        }
        return outcome;
      });
    },

    /** Signed unsubscribe link from a campaign: always ends as unsubscribed (idempotent). */
    unsubscribe(id: string, now: Date): Promise<boolean> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const current = read(snapshot.data());
        if (!current) return false;
        tx.update(ref(id), {
          status: "unsubscribed",
          tokenHash: null,
          tokenExpiresAt: null,
          version: current.version + 1,
          updatedAt: now,
        });
        return true;
      });
    },
  };
}

/** A subscriber row for the admin list and the campaign sender. */
export interface SubscriberRow {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly chapterId: string | null;
  readonly status: SubscriptionStatus;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly deletedAt: Date | null;
}

const toRow = (data: Record<string, unknown>): SubscriberRow => ({
  id: data["subscriberId"] as string,
  email: data["email"] as string,
  name: (data["name"] as string | null | undefined) ?? null,
  chapterId: (data["chapterId"] as string | null | undefined) ?? null,
  status: data["status"] as SubscriptionStatus,
  createdAt: toDate(data["createdAt"]) as Date,
  confirmedAt: toDate(data["confirmedAt"]),
  deletedAt: toDate(data["deletedAt"]),
});

/** Admin list and campaign delivery (role admin_rw). */
export function createSqlSubscriberReader(db: Database) {
  const subscribers = db.collection("subscribers");
  return {
    /** Live (not deleted) subscribers, newest first. */
    async listForAdmin(limit = 2000): Promise<SubscriberRow[]> {
      const snapshot = await subscribers.orderBy("createdAt", "desc").limit(limit).get();
      return snapshot.docs.map((doc) => toRow(doc.data())).filter((row) => !row.deletedAt);
    },

    /**
     * The next `limit` confirmed subscribers after `cursor` (stable id order, for batches). Deleted
     * ones are included (the batch size must stay stable); the sender skips them.
     */
    async confirmedAfter(cursor: string | null, limit: number): Promise<SubscriberRow[]> {
      let query = subscribers.where("status", "==", "confirmed").orderBy("subscriberId");
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => toRow(doc.data()));
    },
  };
}

export type SqlSubscriberReader = ReturnType<typeof createSqlSubscriberReader>;

export type SqlSubscriberStore = ReturnType<typeof createSqlSubscriberStore>;
