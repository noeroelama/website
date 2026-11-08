import type { Database } from "./store";

export const EXPIRING_COLLECTIONS = [
  "rateLimits",
  "webauthnChallenges",
  "webhookEvents",
  "attendanceCodes",
  "whatsappConversations",
  "pageViewVisits",
] as const;

export async function deleteExpired(
  db: Database,
  now: Date,
  limit = 500,
): Promise<Record<(typeof EXPIRING_COLLECTIONS)[number], number>> {
  const deleted = {
    rateLimits: 0,
    webauthnChallenges: 0,
    webhookEvents: 0,
    attendanceCodes: 0,
    whatsappConversations: 0,
    pageViewVisits: 0,
  };
  for (const name of EXPIRING_COLLECTIONS) {
    deleted[name] = await db.runTransaction(async (tx) => {
      const found = await tx.get(db.collection(name).where("expiresAt", "<=", now).limit(limit));
      for (const doc of found.docs) tx.delete(doc.ref);
      return found.size;
    });
  }
  return deleted;
}
