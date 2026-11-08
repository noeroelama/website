import type { Database } from "./store";
import type { PersonalityScore } from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { getDocumentsByIds } from "./batch";
import { toDate } from "./slugged";

export type PersonalityResult = PersonalityScore & { readonly completedAt: Date };

const toResult = (data: Record<string, unknown>): PersonalityResult => ({
  code: data["code"] as string,
  identity: data["identity"] as string,
  full: data["full"] as string,
  axes: data["axes"] as PersonalityScore["axes"],
  completedAt: toDate(data["completedAt"]) as Date,
});

export function createSqlPersonalityStore(db: Database) {
  const results = db.collection("personalityResults");
  return {
    async get(uid: string): Promise<PersonalityResult | null> {
      if (!safeId.safeParse(uid).success) return null;
      const snapshot = await results.doc(uid).get();
      return snapshot.exists ? toResult(snapshot.data() as Record<string, unknown>) : null;
    },

    async getMany(uids: readonly string[]): Promise<Map<string, PersonalityResult>> {
      const found = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "personalityResults",
        uids,
      );
      return new Map(
        [...found.entries()].flatMap(([uid, data]) => (data ? [[uid, toResult(data)]] : [])),
      );
    },

    saveOnce(uid: string, score: PersonalityScore, now: Date): Promise<PersonalityResult> {
      const ref = results.doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) {
          throw new RuleViolationError("The test was already taken.");
        }
        const result = { ...score, completedAt: now };
        tx.create(ref, result);
        return result;
      });
    },
  };
}

export type SqlPersonalityStore = ReturnType<typeof createSqlPersonalityStore>;
