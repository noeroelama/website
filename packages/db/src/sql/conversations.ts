import { safeId } from "@website/security/validation";
import type { Database } from "./store";
import { toDate } from "./slugged";

export interface Conversation {
  readonly state: string;
  readonly data: Readonly<Record<string, unknown>>;
}

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
