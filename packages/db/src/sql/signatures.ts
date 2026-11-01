import type { Database } from "./store";
import type { SignatureSettings, UserSignature } from "@website/domain/documents";
import { safeId } from "@website/security/validation";
import { toDate } from "./slugged";

const toSignature = (uid: string, data: Record<string, unknown>): UserSignature => ({
  uid,
  path: data["path"] as string,
  type: data["type"] as UserSignature["type"],
  widthMm: data["widthMm"] as number,
  rotation: data["rotation"] as number,
  updatedAt: toDate(data["updatedAt"]) as Date,
});

/**
 * `userSignatures/{uid}` (D4): where a person's encrypted signature file is, and how it is
 * printed. Written only for the session's own uid (web) and read by letter rendering (admin).
 */
export function createSqlSignatureStore(db: Database) {
  const docs = db.collection("userSignatures");
  const ref = (uid: string) => docs.doc(safeId.parse(uid));
  return {
    async get(uid: string): Promise<UserSignature | null> {
      if (!safeId.safeParse(uid).success) return null;
      const snapshot = await ref(uid).get();
      return snapshot.exists ? toSignature(uid, snapshot.data() as Record<string, unknown>) : null;
    },
    /** Stores the new file's record; returns the previous file to remove (or null). */
    replace(
      uid: string,
      file: { path: string; type: UserSignature["type"] } & SignatureSettings,
      now: Date,
    ): Promise<string | null> {
      return db.runTransaction(async (tx) => {
        const previous = await tx.get(ref(uid));
        tx.set(ref(uid), { ...file, updatedAt: now });
        return previous.exists ? (previous.get("path") as string) : null;
      });
    },
    /** Width and rotation only; false when there is no signature. */
    configure(uid: string, settings: SignatureSettings, now: Date): Promise<boolean> {
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref(uid));
        if (!current.exists) return false;
        tx.update(ref(uid), { ...settings, updatedAt: now });
        return true;
      });
    },
    /** Deletes the record; returns the file to remove (or null). */
    remove(uid: string): Promise<string | null> {
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref(uid));
        if (!current.exists) return null;
        tx.delete(ref(uid));
        return current.get("path") as string;
      });
    },
  };
}

export type SqlSignatureStore = ReturnType<typeof createSqlSignatureStore>;
