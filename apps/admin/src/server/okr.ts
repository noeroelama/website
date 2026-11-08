import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { ObjectiveAudit, SqlObjectiveStore, SqlPeriodStore } from "@website/db/sql";
import type { Period } from "@website/domain/organizations";
import {
  assertOkrWritable,
  KeyResultInputSchema,
  ObjectiveInputSchema,
  removeKeyResult,
  upsertKeyResult,
  VisionInputSchema,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import { can, type ResourceContext } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface OkrDeps {
  readonly objectives: Pick<SqlObjectiveStore, "get" | "create" | "update" | "change">;
  readonly periods: Pick<SqlPeriodStore, "write">;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const version = z.number().int().min(1);
const SaveObjective = ObjectiveInputSchema.extend({
  id: safeId.optional(),
  version: version.nullable(),
  periodId: safeId,
}).strict();
const Ref = z.object({ id: safeId, version }).strict();
const SaveKeyResult = KeyResultInputSchema.extend({
  objectiveId: safeId,
  version,
  keyResultId: safeId.optional(),
}).strict();
const RemoveKeyResult = z.object({ objectiveId: safeId, version, keyResultId: safeId }).strict();
const SaveVision = VisionInputSchema.extend({ periodId: safeId, version }).strict();

const objectiveAudit =
  (audit: AuditBuilder, action: AuditAction): ObjectiveAudit =>
  (before, after, current, next) =>
    audit({
      module: "okr",
      action,
      resourceType: "objective",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export function createOkrActions(deps: OkrDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.objectives.get(id))?.orgUnitPath ?? [],
  });
  const unitScope = async (orgUnitId: string | null): Promise<ResourceContext> => ({
    orgUnitPath: orgUnitId === null ? [] : ((await deps.unitPath(orgUnitId)) ?? []),
  });

  const saveObjective = createGuardedAction({
    permission: "okr.edit",
    input: SaveObjective,
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.orgUnitId)),
    handler: async ({ id, version, periodId, ...input }, principal, audit) => {
      const now = deps.now();
      if (!id) {
        const saved = await deps.objectives.create(
          periodId,
          input,
          objectiveAudit(audit, "CREATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      if (!can(principal, "okr.edit", await unitScope(input.orgUnitId))) {
        throw new RuleViolationError("You can only plan objectives of your own unit.");
      }
      const saved = await deps.objectives.update(
        id,
        version as number,
        input,
        objectiveAudit(audit, "UPDATE"),
        now,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const removeObjective = createGuardedAction({
    permission: "okr.edit",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.objectives.change(
        id,
        version,
        (objective) => ({ ...objective, deletedAt: now }),
        objectiveAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  const saveKeyResult = createGuardedAction({
    permission: "okr.edit",
    input: SaveKeyResult,
    resource: ({ objectiveId }) => scopeOf({ id: objectiveId }),
    handler: async ({ objectiveId, version, keyResultId, ...input }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.objectives.change(
        objectiveId,
        version,
        (objective) => upsertKeyResult(objective, keyResultId ?? deps.uuid(), input, now),
        objectiveAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version };
    },
  });

  const deleteKeyResult = createGuardedAction({
    permission: "okr.edit",
    input: RemoveKeyResult,
    resource: ({ objectiveId }) => scopeOf({ id: objectiveId }),
    handler: async ({ objectiveId, version, keyResultId }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.objectives.change(
        objectiveId,
        version,
        (objective) => removeKeyResult(objective, keyResultId),
        objectiveAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version };
    },
  });

  const saveVision = createGuardedAction({
    permission: "okr.edit",
    input: SaveVision,
    handler: async ({ periodId, version, vision, mission }, _principal, audit) => {
      const saved = await deps.periods.write(
        periodId,
        version,
        (current) => {
          const period = current as Period;
          assertOkrWritable(period);
          return { ...period, vision, mission };
        },
        (before, after, _current, next) =>
          audit({
            module: "okr",
            action: "UPDATE",
            resourceType: "period",
            resourceId: next.id,
            title: next.name,
            before,
            after,
            versionBefore: next.version - 1,
            versionAfter: next.version,
            revertible: false,
          }),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  return { saveObjective, removeObjective, saveKeyResult, deleteKeyResult, saveVision };
}
