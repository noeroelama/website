import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Message, MessageLogEntry, MessageLogStore } from "@website/domain/messaging";
import { safeId } from "@website/security/validation";

/** Document id = sha256(key): keys may contain ":" and stay unique per message. */
export const messageId = (key: string) => createHash("sha256").update(key).digest("hex");

const toDate = (value: unknown): Date => (value as { toDate(): Date }).toDate();
const toEntry = (id: string, data: Record<string, unknown>): MessageLogEntry =>
  ({
    ...data,
    id,
    createdAt: toDate(data["createdAt"]),
    updatedAt: toDate(data["updatedAt"]),
  }) as MessageLogEntry;

/**
 * `messageLog/{sha256(key)}`: key, channel, to, subject, text, html, status, attempts,
 * providerId, lastError, createdAt, updatedAt. Claiming a key is a create-if-absent
 * transaction, so the same message is never sent twice.
 */
export function createFirestoreMessageLog(db: Firestore) {
  const collection = db.collection("messageLog");
  const store: MessageLogStore = {
    claim(key, message: Message, now) {
      const ref = collection.doc(messageId(key));
      return db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return "duplicate";
        tx.create(ref, {
          ...message,
          key,
          status: "queued",
          attempts: 0,
          providerId: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });
        return "new";
      });
    },

    finish(key, { status, providerId, lastError, attempted }, now) {
      const ref = collection.doc(messageId(key));
      return db.runTransaction(async (tx) => {
        // Set to 0 by `claim`, which always runs first.
        const attempts = (await tx.get(ref)).get("attempts") as number;
        tx.update(ref, {
          status,
          providerId: providerId ?? null,
          lastError: lastError ?? null,
          attempts: attempted ? attempts + 1 : attempts,
          updatedAt: now,
        });
      });
    },

    claimRetry(id, now) {
      const ref = collection.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists || snapshot.get("status") !== "failed") return null;
        tx.update(ref, { status: "queued", updatedAt: now });
        return toEntry(id, snapshot.data() as Record<string, unknown>);
      });
    },
  };

  return {
    ...store,
    /** Admin Messages page: failed messages, newest first. */
    async listFailed({ cursor, limit }: { cursor?: string | undefined; limit: number }) {
      let query = collection
        .where("status", "==", "failed")
        .orderBy("createdAt", "desc")
        .orderBy("key", "desc");
      if (cursor !== undefined) {
        const [time = 0, key = ""] = JSON.parse(cursor) as [number, string];
        query = query.startAfter(new Date(time), key);
      }
      const snapshot = await query.limit(limit + 1).get();
      const items = snapshot.docs
        .slice(0, limit)
        .map((doc) => toEntry(doc.id, doc.data() as Record<string, unknown>));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          snapshot.docs.length > limit && last
            ? JSON.stringify([last.createdAt.getTime(), last.key])
            : null,
      };
    },
  };
}

export type FirestoreMessageLog = ReturnType<typeof createFirestoreMessageLog>;
