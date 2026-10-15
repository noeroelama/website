import type { Firestore } from "firebase-admin/firestore";
import { safeId } from "@website/security/validation";

const KEEP_DAYS = 30;

/**
 * Webhook de-duplication: `webhookEvents/{provider}_{eventId}` is created in a transaction the
 * first time an event arrives; a replay (or a provider retry) finds it and is ignored.
 * `expiresAt` lets a Firestore TTL policy delete old rows.
 */
export function createFirestoreWebhookEventStore(db: Firestore) {
  return {
    /** true = first time (process it); false = already seen. */
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
