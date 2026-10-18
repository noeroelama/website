import type { Firestore } from "firebase-admin/firestore";
import {
  confirmDecision,
  optInDecision,
  type SubscriptionStatus,
} from "@website/domain/newsletter";
import { safeId } from "@website/security/validation";
import { toDate } from "./slugged";

/**
 * Newsletter subscribers: `subscribers/{emailHash}` (HMAC of the normalised address, so the id
 * never reveals it). Holds the address (needed to send), status, confirmedAt, the SHA-256 of the
 * current confirmation token and its expiry, and how many opt-in e-mails were sent (`optIns`,
 * part of the message key). Every change is one transaction.
 */
export function createFirestoreSubscriberStore(db: Firestore) {
  const subscribers = db.collection("subscribers");
  const ref = (id: string) => subscribers.doc(safeId.parse(id));
  const read = (data: Record<string, unknown> | undefined) =>
    data
      ? {
          status: data["status"] as SubscriptionStatus,
          tokenHash: (data["tokenHash"] as string | null) ?? null,
          tokenExpiresAt: toDate(data["tokenExpiresAt"]),
          optIns: data["optIns"] as number,
        }
      : null;

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
        const optIn = (current?.optIns ?? 0) + 1;
        tx.set(ref(id), {
          subscriberId: id,
          email,
          status: "pending",
          confirmedAt: null,
          tokenHash,
          tokenExpiresAt: expiresAt,
          optIns: optIn,
          createdAt: snapshot.exists ? (snapshot.get("createdAt") as unknown) : now,
          updatedAt: now,
        });
        return { optIn };
      });
    },

    /** Confirmation link: single use (the token is cleared). */
    confirm(id: string, tokenHash: string, now: Date) {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref(id));
        const outcome = confirmDecision(read(snapshot.data()), tokenHash, now);
        if (outcome === "confirmed") {
          tx.update(ref(id), {
            status: "confirmed",
            confirmedAt: now,
            tokenHash: null,
            tokenExpiresAt: null,
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
        if (!snapshot.exists) return false;
        tx.update(ref(id), {
          status: "unsubscribed",
          tokenHash: null,
          tokenExpiresAt: null,
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
  readonly status: SubscriptionStatus;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
}

const toRow = (data: Record<string, unknown>): SubscriberRow => ({
  id: data["subscriberId"] as string,
  email: data["email"] as string,
  status: data["status"] as SubscriptionStatus,
  createdAt: toDate(data["createdAt"]) as Date,
  confirmedAt: toDate(data["confirmedAt"]),
});

/** Admin list and campaign delivery (role admin_rw). */
export function createFirestoreSubscriberReader(db: Firestore) {
  const subscribers = db.collection("subscribers");
  return {
    async listForAdmin(limit = 2000): Promise<SubscriberRow[]> {
      const snapshot = await subscribers.orderBy("createdAt", "desc").limit(limit).get();
      return snapshot.docs.map((doc) => toRow(doc.data()));
    },

    /** The next `limit` confirmed subscribers after `cursor` (stable id order, for batches). */
    async confirmedAfter(cursor: string | null, limit: number): Promise<SubscriberRow[]> {
      let query = subscribers.where("status", "==", "confirmed").orderBy("subscriberId");
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => toRow(doc.data()));
    },
  };
}

export type FirestoreSubscriberReader = ReturnType<typeof createFirestoreSubscriberReader>;

export type FirestoreSubscriberStore = ReturnType<typeof createFirestoreSubscriberStore>;
