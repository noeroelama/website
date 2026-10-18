import "server-only";
import { z } from "zod";
import { hasTwoSignInMethods, type AccountAdmin, type PasskeyStore } from "@website/auth";
import type { AuditEvent } from "@website/audit";
import type { AuditChange, UserSummary } from "@website/db";
import type { FirestoreAccountStore, FirestoreRoleStore } from "@website/db/firestore";
import { RuleViolationError } from "@website/domain/shared";
import { logSecurityEvent, type Logger } from "@website/observability";
import {
  accountChangeRefusal,
  sameScope,
  type AccountChangeRefusal,
  type Principal,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface AccountDeps {
  readonly accounts: Pick<FirestoreAccountStore, "change">;
  readonly roles: Pick<FirestoreRoleStore, "get">;
  readonly passkeys: Pick<PasskeyStore, "listByUser">;
  readonly authAdmin: AccountAdmin;
  readonly logger: Logger;
}

const REFUSAL_MESSAGE: Record<AccountChangeRefusal, string> = {
  self: "You cannot change your own account. Ask another administrator.",
  forbidden: "You can only give or remove roles whose permissions you hold yourself.",
  last_superadmin: "This is the last active superadmin. Make someone else superadmin first.",
};

const ScopeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("chapter"), chapterId: safeId }).strict(),
  z.object({ type: z.literal("orgUnit"), orgUnitId: safeId }).strict(),
]);
const RoleChangeInput = z
  .object({
    uid: safeId,
    version: z.number().int().min(0),
    roleId: safeId,
    scope: ScopeInput,
    /** Board period the role is for; null/absent = independent of periods. */
    periodId: safeId.nullable().optional(),
  })
  .strict();
const StatusInput = z
  .object({ uid: safeId, version: z.number().int().min(0), status: z.enum(["active", "inactive"]) })
  .strict();

/** Same role, same place and same period (a revoked assignment no longer counts). */
const sameAssignment = (a: RoleAssignment, b: RoleAssignment) =>
  a.roleId === b.roleId &&
  sameScope(a.scope, b.scope) &&
  (a.periodId ?? null) === (b.periodId ?? null) &&
  !a.revokedAt &&
  !b.revokedAt;

/** A role that opens admin pages needs two sign-in methods on the account first (B2). */
const isStaffRole = (role: RoleDefinition) => role.permissions.length > 0;

/** Audit entry for an account change; role changes go through these rules, never through revert. */
const accountAudit =
  (audit: AuditBuilder) =>
  (change: AuditChange, current: UserSummary): AuditEvent =>
    audit({
      module: "users",
      action: "UPDATE",
      resourceType: "user",
      resourceId: current.uid,
      title: current.email ?? current.uid,
      ...change,
      revertible: false,
    });

/** Admin Users page actions. Wired with the real stores in ./users-actions (server actions). */
export function createAccountActions(deps: AccountDeps) {
  const refuse = (reason: AccountChangeRefusal | null) => {
    if (reason) throw new RuleViolationError(REFUSAL_MESSAGE[reason]);
  };
  const loadRole = async (roleId: string) => {
    const role = await deps.roles.get(roleId);
    if (!role) throw new RuleViolationError("This role does not exist.");
    return role;
  };
  /** After the commit: the account must sign in again so the new roles/status apply everywhere. */
  const afterChange = async (actor: Principal, target: UserSummary, details: object) => {
    await deps.authAdmin.revokeSessions(target.uid);
    logSecurityEvent(deps.logger, {
      type: "staff.role_changed",
      actorId: actor.userId,
      details: { targetId: target.uid, ...details },
    });
  };

  const assignRole = createGuardedAction({
    permission: "users.edit",
    input: RoleChangeInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const role = await loadRole(input.roleId);
      if (isStaffRole(role)) {
        const [methods, passkeys] = await Promise.all([
          deps.authAdmin.signInMethods(input.uid),
          deps.passkeys.listByUser(input.uid),
        ]);
        if (!hasTwoSignInMethods({ ...methods, passkeys: passkeys.length })) {
          throw new RuleViolationError(
            "This account needs a second sign-in method first: two-step verification, or a passkey plus Google or a password (web → Your account).",
          );
        }
      }
      const added: RoleAssignment = {
        roleId: role.id,
        scope: input.scope,
        periodId: input.periodId ?? null,
        source: "manual",
        revokedAt: null,
      };
      const updated = await deps.accounts.change(
        input.uid,
        input.version,
        (current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({
              actor: principal,
              targetUserId: input.uid,
              role,
              superadminsAfter,
            }),
          );
          if (current.roleAssignments.some((a) => sameAssignment(a, added))) {
            throw new RuleViolationError("The account already has this role in this scope.");
          }
        },
        { roleAssignmentsFrom: (current) => [...current.roleAssignments, added] },
        accountAudit(audit),
      );
      await afterChange(principal, updated, { added: role.id, scope: input.scope.type });
      return { version: updated.version };
    },
  });

  const revokeRole = createGuardedAction({
    permission: "users.edit",
    input: RoleChangeInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const role = await loadRole(input.roleId);
      const removed: RoleAssignment = {
        roleId: role.id,
        scope: input.scope,
        periodId: input.periodId ?? null,
      };
      const updated = await deps.accounts.change(
        input.uid,
        input.version,
        (_current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({
              actor: principal,
              targetUserId: input.uid,
              role,
              superadminsAfter,
            }),
          );
        },
        {
          roleAssignmentsFrom: (current) =>
            current.roleAssignments.filter((a) => !sameAssignment(a, removed)),
        },
        accountAudit(audit),
      );
      await afterChange(principal, updated, { removed: role.id, scope: input.scope.type });
      return { version: updated.version };
    },
  });

  const setStatus = createGuardedAction({
    permission: "users.edit",
    input: StatusInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const updated = await deps.accounts.change(
        input.uid,
        input.version,
        (_current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({ actor: principal, targetUserId: input.uid, superadminsAfter }),
          );
        },
        { status: input.status },
        accountAudit(audit),
      );
      // Firebase Auth: a deactivated account cannot sign in again; its sessions end now.
      await deps.authAdmin.setDisabled(input.uid, input.status === "inactive");
      await afterChange(principal, updated, { status: input.status });
      return { version: updated.version };
    },
  });

  return { assignRole, revokeRole, setStatus };
}
