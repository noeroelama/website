import "server-only";
import { z } from "zod";
import type { FirestoreOrgUnitStore } from "@website/db/firestore";
import { OrgUnitInputSchema, type OrgUnit } from "@website/domain/organizations";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface OrgUnitDeps {
  readonly units: Pick<FirestoreOrgUnitStore, "save" | "move">;
  readonly now: () => Date;
}

const SaveInput = OrgUnitInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
}).strict();
const MoveInput = z
  .object({ id: safeId, version: z.number().int().min(1), parentId: safeId.nullable() })
  .strict();

/**
 * Audit entry for one unit change (module `structure`, resource `orgUnit`). Not revertible: a
 * revert would bring back an old path without rewriting the units below it.
 */
const unitAudit =
  (audit: AuditBuilder) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: OrgUnit | null,
    next: OrgUnit,
  ) =>
    audit({
      module: "structure",
      action: current ? "UPDATE" : "CREATE",
      resourceType: "orgUnit",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

/** Organizations → Period → Structure actions: save (add/edit) and move. Units are deactivated. */
export function createOrgUnitActions(deps: OrgUnitDeps) {
  const save = createGuardedAction({
    permission: "structure.edit",
    input: SaveInput,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.units.save(id ?? null, version, input, unitAudit(audit), deps.now());
      return { id: saved.id, version: saved.version };
    },
  });

  const move = createGuardedAction({
    permission: "structure.edit",
    input: MoveInput,
    handler: async ({ id, version, parentId }, _principal, audit) => {
      const saved = await deps.units.move(id, version, parentId, unitAudit(audit), deps.now());
      return { version: saved.version };
    },
  });

  return { save, move };
}
