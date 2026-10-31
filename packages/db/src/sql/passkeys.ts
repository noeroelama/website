import { createHash } from "node:crypto";
import type { Database } from "./store";
import type { PasskeyChallenge, PasskeyCredential, PasskeyStore } from "@website/auth";
import { safeId } from "@website/security/validation";

/** Stored Dates come back as timestamps (`toDate()`). */
const toDate = (value: unknown): Date => (value as { toDate(): Date }).toDate();

function toCredential(data: Record<string, unknown>): PasskeyCredential {
  return {
    id: data["id"] as string,
    userId: data["userId"] as string,
    publicKey: data["publicKey"] as string,
    counter: data["counter"] as number,
    transports: data["transports"] as string[],
    createdAt: toDate(data["createdAt"]),
    lastUsedAt: data["lastUsedAt"] ? toDate(data["lastUsedAt"]) : null,
  };
}

/**
 * Passkey credentials in `passkeys/{sha256(credentialId)}` (credential ids can be longer than a
 * safe document id) and single-use challenges in `webauthnChallenges/{id}` (TTL on `expiresAt`).
 */
export function createSqlPasskeyStore(db: Database): PasskeyStore {
  const credentials = db.collection("passkeys");
  const challenges = db.collection("webauthnChallenges");
  const credentialRef = (id: string) =>
    credentials.doc(createHash("sha256").update(id).digest("hex"));

  return {
    async listByUser(userId) {
      const snapshot = await credentials.where("userId", "==", userId).get();
      return snapshot.docs.map((doc) => toCredential(doc.data()));
    },
    async findById(id) {
      const doc = await credentialRef(id).get();
      return doc.exists ? toCredential(doc.data() as Record<string, unknown>) : null;
    },
    async add(credential) {
      await credentialRef(credential.id).create({
        ...credential,
        transports: [...credential.transports],
      });
    },
    recordUse(id, newCounter, usedAt) {
      const ref = credentialRef(id);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return false;
        const stored = (doc.data() as Record<string, unknown>)["counter"] as number;
        if (!(newCounter > stored || (newCounter === 0 && stored === 0))) return false;
        tx.update(ref, { counter: newCounter, lastUsedAt: usedAt });
        return true;
      });
    },
    async saveChallenge(id, challenge) {
      await challenges.doc(safeId.parse(id)).set({ ...challenge });
    },
    async consumeChallenge(id, now) {
      const ref = challenges.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return null;
        tx.delete(ref);
        const data = doc.data() as Record<string, unknown>;
        const challenge: PasskeyChallenge = {
          challenge: data["challenge"] as string,
          userId: data["userId"] as string | null,
          expiresAt: toDate(data["expiresAt"]),
        };
        return challenge.expiresAt > now ? challenge : null;
      });
    },
  };
}
