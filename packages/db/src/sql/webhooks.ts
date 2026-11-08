import type { Database } from "./store";
import { safeId } from "@website/security/validation";

const KEEP_DAYS = 30;

export function createSqlWebhookEventStore(db: Database) {
  return {
    async record(provider: string, eventId: string, now: Date): Promise<boolean> {
      const ref = db.collection("webhookEvents").doc(safeId.parse(`${provider}_${eventId}`));
      return await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return false;
        tx.create(ref, {
          provider,
          eventId,
          receivedAt: now,
          expiresAt: new Date(now.getTime() + KEEP_DAYS * 24 * 60 * 60 * 1000),
        });
        return true;
      });
    },
  };
}
