import { safeId } from "@website/security/validation";
import type { Database } from "./store";
import { toDate } from "./slugged";

/** A chatbot conversation (C4): the step and what was typed so far. */
export interface Conversation {
  readonly state: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * `whatsappConversations/{keyedHash(phone)}` (C4): the dialogue state of one WhatsApp number,
 * with `expiresAt` (an expired conversation starts over; the `expire` cron job deletes it). The
 * number itself is never stored.
 */
export function createSqlConversationStore(db: Database) {
  const docs = db.collection("whatsappConversations");
  return {
    async get(id: string, now: Date): Promise<Conversation | null> {
      const snapshot = await docs.doc(safeId.parse(id)).get();
      const expiresAt = toDate(snapshot.get("expiresAt"));
      if (!snapshot.exists || !expiresAt || expiresAt.getTime() <= now.getTime()) return null;
      return {
        state: snapshot.get("state") as string,
        data: snapshot.get("data") as Record<string, unknown>,
      };
    },
    async save(id: string, conversation: Conversation | null, expiresAt: Date): Promise<void> {
      const ref = docs.doc(safeId.parse(id));
      await db.runTransaction(async (tx) => {
        if (conversation) tx.set(ref, { ...conversation, expiresAt });
        else tx.delete(ref);
        return Promise.resolve();
      });
    },
  };
}

export type SqlConversationStore = ReturnType<typeof createSqlConversationStore>;
