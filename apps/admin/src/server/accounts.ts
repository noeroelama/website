import "server-only";
import { z } from "zod";
import { hasTwoSignInMethods, type AccountAdmin, type PasskeyStore } from "@website/auth";
import type { AuditEvent } from "@website/audit";
import type { AuditChange, Invite, UserSummary } from "@website/db";
import type { FirestoreAccountStore, FirestoreRoleStore } from "@website/db/firestore";
import { RuleViolationError } from "@website/domain/shared";
import { logSecurityEvent, type Logger } from "@website/observability";
import {
  accountChangeRefusal,
  canAssignRole,
  sameScope,
  type AccountChangeRefusal,
  type Principal,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface AccountDeps {
  readonly accounts: Pick<
    FirestoreAccountStore,
    "change" | "get" | "findByEmail" | "findByName" | "searchByPrefix" | "invite" | "cancelInvite"
  >;
  readonly roles: Pick<FirestoreRoleStore, "get">;
  readonly passkeys: Pick<PasskeyStore, "listByUser">;
  readonly authAdmin: AccountAdmin;
  readonly logger: Logger;
  /** E-mails the invite (after the invite is stored); the result is the messenger status. */
  readonly sendInvite: (invite: Invite, roleName: string) => Promise<unknown>;
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
/** "Email or Name" of Add New People: an e-mail (has "@") or an account's exact name. */
const PersonInput = z
  .object({
    person: safeText(120).refine(
      (value) => !value.includes("@") || z.email().safeParse(value).success,
      "Type a valid e-mail address.",
    ),
    roleId: safeId,
  })
  .strict();
const InviteRef = z.object({ email: z.email().max(254) }).strict();

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

/** Role Manager people actions. Wired with the real stores in ./wiring.ts (server actions). */
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

  /** Gives a role to an existing account (all checks; shared by the role popup and Add New People). */
  const give = async (
    input: z.infer<typeof RoleChangeInput>,
    principal: Principal,
    audit: AuditBuilder,
  ) => {
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
  };

  const assignRole = createGuardedAction({
    permission: "users.edit",
    input: RoleChangeInput,
    recentSignIn: true,
    handler: give,
  });

  /**
   * Role Manager → Add New People: the account with this e-mail or exact name gets the role (all
   * chapters, any period); an e-mail without an account is invited instead (stored, e-mailed,
   * applied when that e-mail signs in — see `recordSignIn`).
   */
  const addPerson = createGuardedAction({
    permission: "users.edit",
    input: PersonInput,
    recentSignIn: true,
    handler: async ({ person, roleId }, principal, audit) => {
      const isEmail = person.includes("@");
      const found = isEmail
        ? [await deps.accounts.findByEmail(person)].filter((u) => u !== null)
        : await deps.accounts.findByName(person);
      if (found.length > 1) {
        throw new RuleViolationError("Several accounts have this name. Use the e-mail address.");
      }
      const account = found[0];
      if (account) {
        const scope = { type: "global" } as const;
        await give({ uid: account.uid, version: account.version, roleId, scope }, principal, audit);
        return { invited: false };
      }
      if (!isEmail) {
        throw new RuleViolationError(
          "No account has this name. Invite the person by e-mail instead.",
        );
      }
      const role = await loadRole(roleId);
      if (!canAssignRole(principal, role)) refuse("forbidden");
      const invite = await deps.accounts.invite(
        person,
        role.id,
        principal.userId,
        (change, action, id) =>
          audit({
            module: "users",
            action,
            resourceType: "invite",
            resourceId: id,
            title: person.toLowerCase(),
            ...change,
            revertible: false, // an e-mail goes out; cancel the invite instead
          }),
        new Date(),
      );
      await deps.sendInvite(invite, role.name);
      return { invited: true };
    },
  });

  /**
   * Add New People suggestions while typing (debounced in the browser): name and e-mail of up to
   * 8 accounts whose e-mail or name starts with the text. Only for staff who may add people.
   */
  const findPeople = createGuardedAction({
    permission: "users.edit",
    input: z.object({ query: safeText(120).pipe(z.string().min(2)) }).strict(),
    handler: async ({ query }) =>
      (await deps.accounts.searchByPrefix(query, 8)).map(({ uid, name, email }) => ({
        uid,
        name,
        email,
      })),
  });

  /** Cancels a pending invite (Role Manager, the invited row's popup). */
  const cancelInvite = createGuardedAction({
    permission: "users.edit",
    input: InviteRef,
    recentSignIn: true,
    handler: async ({ email }, _principal, audit) => {
      const invite = await deps.accounts.cancelInvite(
        email,
        (change, id) =>
          audit({
            module: "users",
            action: "DELETE",
            resourceType: "invite",
            resourceId: id,
            title: email.toLowerCase(),
            ...change,
            revertible: false,
          }),
        new Date(),
      );
      return { email: invite.email };
    },
  });

  /**
   * The person popup: sign-in methods of one account (Firebase Auth + passkeys), read on demand.
   * `users.read` for the account's chapter, like the list (A2).
   */
  const personDetails = createGuardedAction({
    permission: "users.read",
    input: z.object({ uid: safeId }).strict(),
    resource: async ({ uid }) => {
      const account = await deps.accounts.get(uid);
      return account?.chapterId ? { chapterId: account.chapterId } : {};
    },
    handler: async ({ uid }) => {
      if ((await deps.accounts.get(uid)) === null) {
        throw new RuleViolationError("This account does not exist.");
      }
      const [methods, passkeys] = await Promise.all([
        deps.authAdmin.signInMethods(uid),
        deps.passkeys.listByUser(uid),
      ]);
      return { ...methods, passkeys: passkeys.length };
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
        (current, superadminsAfter) => {
          refuse(
            accountChangeRefusal({
              actor: principal,
              targetUserId: input.uid,
              role,
              superadminsAfter,
            }),
          );
          // PPIDK: a role from an appointment ends with the appointment, so both tell one story.
          if (
            current.roleAssignments.some(
              (a) => a.source === "appointment" && sameAssignment(a, removed),
            )
          ) {
            throw new RuleViolationError(
              "This role comes from an appointment: end the appointment on the Structure page.",
            );
          }
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

  return {
    assignRole,
    addPerson,
    findPeople,
    cancelInvite,
    personDetails,
    revokeRole,
    setStatus,
  };
}
