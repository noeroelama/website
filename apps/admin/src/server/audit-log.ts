import "server-only";
import { z } from "zod";
import {
  buildRevertEvent,
  evaluateRevert,
  type AuditEvent,
  type RevertDecision,
} from "@website/audit";
import type { SqlAuditStore, RevertibleCollections } from "@website/db/sql";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { REVERT_REJECTION_LABELS, label } from "../labels";
import { createGuardedAction } from "./guarded-action";

export const REVERTIBLE_COLLECTIONS: RevertibleCollections = {
  content: "content",
  event: "events",
  album: "galleries",
  chapter: "chapters",
  period: "periods",
  orgUnit: "orgUnits",
  campaign: "campaigns",
  subscriber: "subscribers",
  form: "forms",
  recruitment: "recruitments",
};

export interface AuditLogDeps {
  readonly audit: Pick<SqlAuditStore, "revert" | "revertContext">;
  readonly revertible: RevertibleCollections;
  readonly now: () => Date;
  readonly logSecurityEvent: (actorId: string, details: Record<string, unknown>) => void;
}

export function createAuditLogActions(deps: AuditLogDeps) {
  async function revertStatus(entries: readonly AuditEvent[]) {
    const { reverted, versions } = await deps.audit.revertContext(entries, deps.revertible);
    const now = deps.now();
    return new Map<string, RevertDecision>(
      entries.map((entry) => [
        entry.id,
        evaluateRevert({
          event: deps.revertible[entry.resourceType] ? entry : { ...entry, revertible: false },
          existingRevert: reverted.has(entry.id) ? entry : null,
          currentVersion: versions.get(entry.id) ?? null,
          now,
        }),
      ]),
    );
  }

  const revert = createGuardedAction({
    permission: "audit.revert",
    input: z.object({ id: safeId }).strict(),
    recentSignIn: true,
    handler: async ({ id }, principal, audit) => {
      const outcome = await deps.audit.revert(
        id,
        deps.revertible,
        deps.now(),
        (original, version) => {
          const template = audit({
            module: "audit",
            action: "REVERT",
            resourceType: original.resourceType,
            resourceId: original.resourceId,
            title: "revert",
            before: null,
            after: null,
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          });
          return buildRevertEvent({
            original,
            id: template.id,
            operationId: template.operationId,
            actor: template.actor,
            request: template.request,
            now: deps.now(),
            currentVersion: version,
          });
        },
      );
      if (outcome === "missing") throw new RuleViolationError("This entry does not exist.");
      if (outcome !== "reverted") {
        throw new RuleViolationError(label(REVERT_REJECTION_LABELS, outcome));
      }
      deps.logSecurityEvent(principal.userId, { entryId: id });
      return { id };
    },
  });

  return { revertStatus, revert };
}
