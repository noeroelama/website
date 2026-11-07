import "server-only";
import { z } from "zod";
import type { SqlUniversityStore } from "@website/db/sql";
import { UniversityProposalSchema, type University } from "@website/domain/members";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface UniversityDeps {
  readonly universities: Pick<SqlUniversityStore, "review" | "add">;
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

/** Organizations → Universities tab: add a listed campus and review proposed ones (approve, merge, reject). */
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
  const add = createGuardedAction({
    permission: "universities.edit",
    input: UniversityProposalSchema,
    handler: async (proposal, principal, audit) => {
      const saved = await deps.universities.add(
        principal.userId,
        proposal,
        (after, next) =>
          audit({
            module: "universities",
            action: "CREATE",
            resourceType: "university",
            resourceId: next.id,
            title: next.name,
            before: null,
            after,
            versionBefore: null,
            versionAfter: next.version,
            // Not revertible: members may pick the campus right away.
            revertible: false,
          }),
        deps.now(),
      );
      return { id: saved.id };
    },
  });
  return { review, add };
}
