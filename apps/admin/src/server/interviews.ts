import "server-only";
import { z } from "zod";
import type { SqlInterviewStore } from "@website/db/sql";
import { SlotPlanSchema } from "@website/domain/recruitment";
import { safeId } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface InterviewDeps {
  readonly interviews: Pick<SqlInterviewStore, "createPlan" | "remove">;
  readonly now: () => Date;
}

export function createInterviewActions(deps: InterviewDeps) {
  const createPlan = createGuardedAction({
    permission: "recruitment.review",
    input: z.object({ recruitmentId: safeId, plan: SlotPlanSchema }).strict(),
    handler: async ({ recruitmentId, plan }, _principal, audit) => {
      const created = await deps.interviews.createPlan(
        recruitmentId,
        plan,
        (slots, title) =>
          audit({
            module: "recruitment",
            action: "CREATE",
            resourceType: "interviewSlot",
            resourceId: recruitmentId,
            title: `${title}: ${slots.length} interview times on ${plan.date}`,
            before: null,
            after: {
              date: plan.date,
              timeZone: plan.timeZone,
              slots: slots.map((s) => s.startsAt.toISOString()),
              capacity: plan.capacity,
            },
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        deps.now(),
      );
      return { created: created.length };
    },
  });

  const removeSlot = createGuardedAction({
    permission: "recruitment.review",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, _principal, audit) => {
      await deps.interviews.remove(
        id,
        (slot) =>
          audit({
            module: "recruitment",
            action: "DELETE",
            resourceType: "interviewSlot",
            resourceId: slot.id,
            title: `Interview time ${slot.startsAt.toISOString()}`,
            before: { startsAt: slot.startsAt.toISOString(), capacity: slot.capacity },
            after: null,
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        deps.now(),
      );
      return { id };
    },
  });

  return { createPlan, removeSlot };
}
