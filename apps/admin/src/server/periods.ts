import "server-only";
import { z } from "zod";
import type { FirestorePeriodStore } from "@website/db/firestore";
import {
  canChangePeriod,
  canDeletePeriod,
  periodDatesFromName,
  PeriodFormSchema,
  type Period,
} from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface PeriodDeps {
  readonly periods: Pick<FirestorePeriodStore, "write" | "activate">;
  readonly now: () => Date;
}

const SaveInput = PeriodFormSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
}).strict();

/**
 * Audit entry for one period change (module `periods`, resource `period`). Not revertible: a
 * revert could bring back a second active period or change an archived one. A DELETE is
 * revertible (it only clears `deletedAt` again; the active period is never deleted).
 */
const periodAudit =
  (audit: AuditBuilder, deleting = false) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Period | null,
    next: Period,
  ) =>
    audit({
      module: "periods",
      action: deleting ? "DELETE" : current ? "UPDATE" : "CREATE",
      resourceType: "period",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: deleting,
    });

/** Organizations → Period actions: save (add/edit), activate and delete (soft, not the active one). */
export function createPeriodActions(deps: PeriodDeps) {
  const save = createGuardedAction({
    permission: "periods.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.periods.write(
        id ?? null,
        version,
        (current) => {
          if (current && !canChangePeriod(current.status)) {
            throw new RuleViolationError("This period is archived and can no longer be changed.");
          }
          // The form has only the years and the cabinet: the dates follow the years (kept when
          // the years did not change, e.g. imported dates), the notes keep their values.
          const dates =
            current?.name === input.name
              ? { startsOn: current.startsOn, endsOn: current.endsOn }
              : (periodDatesFromName(input.name) as { startsOn: string; endsOn: string });
          return {
            ...input,
            ...dates,
            vision: current?.vision ?? "",
            mission: current?.mission ?? "",
            lpjDeadlineDays: current?.lpjDeadlineDays ?? 30,
            status: current?.status ?? "draft",
            deletedAt: null,
          };
        },
        periodAudit(audit),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  /** Makes a draft the active period; the period that was active is archived. */
  const activate = createGuardedAction({
    permission: "periods.edit",
    input: z.object({ id: safeId, version: z.number().int().min(1) }).strict(),
    handler: async ({ id, version }, _principal, audit) => {
      const saved = await deps.periods.activate(id, version, periodAudit(audit), deps.now());
      return { version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "periods.edit",
    input: z.object({ id: safeId, version: z.number().int().min(1) }).strict(),
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.periods.write(
        id,
        version,
        (current) => {
          const period = current as Period;
          if (!canDeletePeriod(period.status)) {
            throw new RuleViolationError("The active period cannot be deleted.");
          }
          return { ...period, deletedAt: now };
        },
        periodAudit(audit, true),
        now,
      );
      return { version: saved.version };
    },
  });

  return { save, activate, remove };
}
