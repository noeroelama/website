import "server-only";
import { z } from "zod";
import { hasTwoSignInMethods, type AccountAdmin, type PasskeyStore } from "@website/auth";
import type {
  AppointmentAudit,
  FirestoreAccountStore,
  FirestoreAppointmentStore,
  FirestoreRoleStore,
} from "@website/db/firestore";
import {
  AppointmentInputSchema,
  AppointmentRoleMapSchema,
  derivedAssignments,
  type AppointmentRoleMap,
  type OrgUnit,
} from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { logSecurityEvent, type Logger } from "@website/observability";
import { canAppointInto, isSystemRoleId, type Principal } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface AppointmentDeps {
  readonly appointments: Pick<
    FirestoreAppointmentStore,
    "getRoleMap" | "saveRoleMap" | "appoint" | "end"
  >;
  readonly accounts: Pick<FirestoreAccountStore, "findByEmail">;
  readonly units: { get(id: string): Promise<OrgUnit | null> };
  readonly roles: Pick<FirestoreRoleStore, "getMany">;
  readonly passkeys: Pick<PasskeyStore, "listByUser">;
  readonly authAdmin: AccountAdmin;
  readonly logger: Logger;
  readonly now: () => Date;
}

const SELF = "You cannot change your own appointment or roles. Ask another officer.";

/** The appointment's entry (module `appointments`) and the account's (module `users`). */
const appointmentAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE"): AppointmentAudit =>
  (appointment, account) => [
    audit({
      module: "appointments",
      action,
      resourceType: "appointment",
      resourceId: appointment.next.id,
      title: `${appointment.next.title} — ${appointment.next.name}`,
      before: appointment.before,
      after: appointment.after,
      versionBefore: action === "CREATE" ? null : appointment.next.version - 1,
      versionAfter: appointment.next.version,
      revertible: false,
    }),
    audit({
      module: "users",
      action: "UPDATE",
      resourceType: "user",
      resourceId: account.user.uid,
      title: account.user.email ?? account.user.uid,
      ...account.change,
      revertible: false,
    }),
  ];

/**
 * Appointments → roles (B7, PPIDK PenugasanService). Appointing someone to a seat gives the roles
 * of `settings/appointmentRoles` (period-bound, source "appointment") in the same transaction;
 * ending the appointment revokes exactly those. The same rules as a role change on the Users
 * page apply: no escalation, nothing on your own account, a second sign-in method for staff
 * roles, a recent sign-in, sessions ended afterwards.
 */
export function createAppointmentActions(deps: AppointmentDeps) {
  const afterChange = async (actor: Principal, uid: string, details: object) => {
    await deps.authAdmin.revokeSessions(uid);
    logSecurityEvent(deps.logger, {
      type: "staff.role_changed",
      actorId: actor.userId,
      details: { targetId: uid, ...details },
    });
  };

  /** The seat → role mapping is data: only existing custom roles (never a built-in one). */
  const saveRoleMap = createGuardedAction({
    permission: "roles.edit",
    input: z
      .object({ map: AppointmentRoleMapSchema, version: z.number().int().min(1).nullable() })
      .strict(),
    recentSignIn: true,
    handler: async ({ map, version }, principal, audit) => {
      const ids = [map.officer, map.unitHead, map.unitSecretary, ...Object.values(map.core)];
      const builtIn = ids.find(isSystemRoleId);
      if (builtIn)
        throw new RuleViolationError(`Built-in roles (${builtIn}) cannot be given here.`);
      const roles = await deps.roles.getMany(ids);
      const missing = ids.find((id) => !roles.has(id));
      if (missing) throw new RuleViolationError(`The role "${missing}" does not exist.`);
      const saved = await deps.appointments.saveRoleMap(
        map as AppointmentRoleMap,
        version,
        (before, after, next) =>
          audit({
            module: "roles",
            action: before ? "UPDATE" : "CREATE",
            resourceType: "appointmentRoles",
            resourceId: "appointmentRoles",
            title: "Roles from appointments",
            before,
            after,
            versionBefore: next - 1 || null,
            versionAfter: next,
            revertible: false,
          }),
        deps.now(),
      );
      return { version: saved };
    },
  });

  const appoint = createGuardedAction({
    permission: "appointments.edit",
    input: AppointmentInputSchema,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const [user, unit, stored] = await Promise.all([
        deps.accounts.findByEmail(input.email),
        deps.units.get(input.orgUnitId),
        deps.appointments.getRoleMap(),
      ]);
      if (!user)
        throw new RuleViolationError("No account with this e-mail (they sign in once first).");
      if (user.uid === principal.userId) throw new RuleViolationError(SELF);
      if (!stored) {
        throw new RuleViolationError("Set the appointment roles first (Roles from appointments).");
      }
      if (!unit) throw new RuleViolationError("This unit does not exist.");
      const derived = derivedAssignments(input.seat, unit, stored.map);
      const roles = await deps.roles.getMany(derived.map((d) => d.roleId));
      for (const { roleId } of derived) {
        const role = roles.get(roleId);
        if (!role) throw new RuleViolationError(`The role "${roleId}" does not exist.`);
        if (!canAppointInto(principal, role)) {
          throw new RuleViolationError(
            "You can only give roles whose permissions you hold yourself.",
          );
        }
      }
      if ([...roles.values()].some((role) => role.permissions.length > 0)) {
        const [methods, passkeys] = await Promise.all([
          deps.authAdmin.signInMethods(user.uid),
          deps.passkeys.listByUser(user.uid),
        ]);
        if (!hasTwoSignInMethods({ ...methods, passkeys: passkeys.length })) {
          throw new RuleViolationError(
            "This account needs a second sign-in method first: two-step verification, or a passkey plus Google or a password (web → Your account).",
          );
        }
      }
      const appointment = await deps.appointments.appoint(
        { userId: user.uid, orgUnitId: unit.id, seat: input.seat, title: input.title },
        derived,
        appointmentAudit(audit, "CREATE"),
        deps.now(),
      );
      await afterChange(principal, user.uid, { appointment: appointment.id });
      return { id: appointment.id };
    },
  });

  const end = createGuardedAction({
    permission: "appointments.edit",
    input: z
      .object({
        id: safeId,
        version: z.number().int().min(1),
        status: z.enum(["ended", "revoked"]),
      })
      .strict(),
    recentSignIn: true,
    handler: async ({ id, version, status }, principal, audit) => {
      const ended = await deps.appointments.end(
        id,
        version,
        status,
        (appointment) => {
          if (appointment.userId === principal.userId) throw new RuleViolationError(SELF);
        },
        appointmentAudit(audit, "UPDATE"),
        deps.now(),
      );
      await afterChange(principal, ended.userId, { endedAppointment: id });
      return { version: ended.version };
    },
  });

  return { saveRoleMap, appoint, end };
}
