import "server-only";
import { z } from "zod";
import type { FirestoreUniversityStore } from "@website/db/firestore";
import type { University } from "@website/domain/members";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface UniversityDeps {
  readonly universities: Pick<FirestoreUniversityStore, "review">;
  readonly now: () => Date;
}

const ReviewInput = z
  .object({
    id: safeId,
    version: z.number().int().min(1),
    decision: z.discriminatedUnion("type", [
      z.object({ type: z.literal("approve") }).strict(),
      z.object({ type: z.literal("merge"), into: safeId }).strict(),
      z.object({ type: z.literal("reject"), note: safeText(500) }).strict(),
    ]),
  })
  .strict();

/** Universities page: the review queue of proposed campuses (approve, merge, reject). */
export function createUniversityActions(deps: UniversityDeps) {
  const review = createGuardedAction({
    permission: "universities.edit",
    input: ReviewInput,
    handler: async ({ id, version, decision }, principal, audit) => {
      const saved = await deps.universities.review(
        id,
        version,
        decision,
        principal.userId,
        // Not revertible: profiles moved with the decision would not move back.
        (before, after, current: University, next: University) =>
          audit({
            module: "universities",
            action: "UPDATE",
            resourceType: "university",
            resourceId: next.id,
            title: current.name,
            before,
            after,
            versionBefore: current.version,
            versionAfter: next.version,
            revertible: false,
          }),
        deps.now(),
      );
      return { version: saved.version };
    },
  });
  return { review };
}
