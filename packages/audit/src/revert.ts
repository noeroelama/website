import type { AuditActor, AuditEvent, AuditRequestMeta } from "./types";

export const REVERT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const REVERT_REJECTIONS = [
  "not_revertible",
  "window_expired",
  "already_reverted",
  "is_revert",
  "version_conflict",
] as const;
export type RevertRejection = (typeof REVERT_REJECTIONS)[number];

export type RevertDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: RevertRejection };

/**
 * Server-side revert policy. The client never decides; it can only ask.
 * `currentVersion` must be read inside the same transaction that applies the revert.
 */
export function evaluateRevert(input: {
  event: AuditEvent;
  existingRevert: AuditEvent | null;
  currentVersion: number | null;
  now: Date;
}): RevertDecision {
  const { event, existingRevert, currentVersion, now } = input;
  if (!event.revertible) return { allowed: false, reason: "not_revertible" };
  if (event.revertOf !== null) return { allowed: false, reason: "is_revert" };
  if (existingRevert !== null) return { allowed: false, reason: "already_reverted" };
  if (now.getTime() - event.occurredAt.getTime() > REVERT_WINDOW_MS) {
    return { allowed: false, reason: "window_expired" };
  }
  // Optimistic concurrency: only revert if nobody edited the entity since this event.
  if (currentVersion !== event.versionAfter) return { allowed: false, reason: "version_conflict" };
  return { allowed: true };
}

/**
 * Builds the NEW audit event that records a revert. The original is never modified.
 * Restoring `before` (or un-deleting when `after` was null) is done by the caller's
 * repository in the same transaction.
 */
export function buildRevertEvent(input: {
  original: AuditEvent;
  id: string;
  operationId: string;
  actor: AuditActor;
  request: AuditRequestMeta;
  now: Date;
  currentVersion: number;
}): AuditEvent {
  const { original } = input;
  return {
    id: input.id,
    occurredAt: input.now,
    actor: input.actor,
    action: "REVERT",
    ...(original.module === undefined ? {} : { module: original.module }),
    ...(original.title === undefined ? {} : { title: original.title }),
    resourceType: original.resourceType,
    resourceId: original.resourceId,
    operationId: input.operationId,
    before: original.after,
    after: original.before,
    versionBefore: input.currentVersion,
    versionAfter: input.currentVersion + 1,
    revertible: false,
    revertOf: original.id,
    request: input.request,
    prevHash: null,
    hash: null,
  };
}
