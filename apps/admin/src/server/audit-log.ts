import "server-only";
import { z } from "zod";
import {
  buildRevertEvent,
  evaluateRevert,
  type AuditEvent,
  type RevertDecision,
} from "@website/audit";
import type { FirestoreAuditStore, RevertibleCollections } from "@website/db/firestore";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { REVERT_REJECTION_LABELS, label } from "../labels";
import { createGuardedAction } from "./guarded-action";

/**
 * How each module's records are reverted: resourceType → Firestore collection. A module adds
 * its row when its records become revertible. Role and account
 * changes, uploads and sends are never listed here.
 */
export const REVERTIBLE_COLLECTIONS: RevertibleCollections = {
  // News (Article page): fields of content/{id}; a changed URL is never revertible.
  content: "content",
  // Event page: fields of events/{id}; a changed URL is never revertible.
  event: "events",
  // Gallery page: fields of galleries/{id}; a changed URL is never revertible.
  album: "galleries",
  // Organizations → PPI: fields of chapters/{id}; a changed URL is never revertible.
  chapter: "chapters",
};

export interface AuditLogDeps {
  readonly audit: Pick<FirestoreAuditStore, "revert" | "revertContext">;
  readonly revertible: RevertibleCollections;
  readonly now: () => Date;
  /** `audit.revert` security event (observability logger in production). */
  readonly logSecurityEvent: (actorId: string, details: Record<string, unknown>) => void;
}

export function createAuditLogActions(deps: AuditLogDeps) {
  /** What each entry's REVERT button may do (disabled with this reason otherwise). */
  async function revertStatus(entries: readonly AuditEvent[]) {
    const { reverted, versions } = await deps.audit.revertContext(entries, deps.revertible);
    const now = deps.now();
    return new Map<string, RevertDecision>(
      entries.map((entry) => [
        entry.id,
        evaluateRevert({
          event: deps.revertible[entry.resourceType] ? entry : { ...entry, revertible: false },
          // Only "is there one" matters for the decision.
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
          // `audit` supplies the id, actor, request and operation of THIS action.
          const template = audit({
            module: "audit",
            action: "REVERT",
            resourceType: original.resourceType,
            resourceId: original.resourceId,
            title: "revert", // not used: buildRevertEvent keeps the original title
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
