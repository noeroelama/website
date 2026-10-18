import "server-only";
import { z } from "zod";
import type { FirestorePeriodStore } from "@website/db/firestore";
import {
  canChangePeriod,
  PeriodInputSchema,
  withPeriodDates,
  type Period,
} from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface PeriodDeps {
  readonly periods: Pick<FirestorePeriodStore, "write" | "activate">;
  readonly now: () => Date;
}

const SaveInput = withPeriodDates(
  PeriodInputSchema.extend({
    id: safeId.optional(),
    version: z.number().int().min(1).nullable(),
  }).strict(),
);

/**
 * Audit entry for one period change (module `periods`, resource `period`). Not revertible: a
 * revert could bring back a second active period or change an archived one.
 */
const periodAudit =
  (audit: AuditBuilder) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Period | null,
    next: Period,
  ) =>
    audit({
      module: "periods",
      action: current ? "UPDATE" : "CREATE",
      resourceType: "period",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

/** Organizations → Period actions: save (add/edit) and activate. Periods are never deleted. */
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
          return { ...input, status: current?.status ?? "draft", deletedAt: null };
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

  return { save, activate };
}
