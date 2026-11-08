import type { PasskeyChallenge, PasskeyCredential, PasskeyStore } from "@website/auth";
import { safeId } from "@website/security/validation";

export function createMemoryPasskeyStore(): PasskeyStore {
  const credentials = new Map<string, PasskeyCredential>();
  const challenges = new Map<string, PasskeyChallenge>();
  return {
    listByUser(userId) {
      return Promise.resolve([...credentials.values()].filter((c) => c.userId === userId));
    },
    findById(id) {
      return Promise.resolve(credentials.get(id) ?? null);
    },
    add(credential) {
      if (credentials.has(credential.id))
        return Promise.reject(new Error("Credential already exists"));
      credentials.set(credential.id, credential);
      return Promise.resolve();
    },
    recordUse(id, newCounter, usedAt) {
      const stored = credentials.get(id);
      if (!stored || !(newCounter > stored.counter || (newCounter === 0 && stored.counter === 0))) {
        return Promise.resolve(false);
      }
      credentials.set(id, { ...stored, counter: newCounter, lastUsedAt: usedAt });
      return Promise.resolve(true);
    },
    saveChallenge(id, challenge) {
      return Promise.resolve().then(() => {
        challenges.set(safeId.parse(id), challenge);
      });
    },
    consumeChallenge(id, now) {
      return Promise.resolve().then(() => {
        const key = safeId.parse(id);
        const challenge = challenges.get(key);
        challenges.delete(key);
        return challenge && challenge.expiresAt > now ? challenge : null;
      });
    },
  };
}
