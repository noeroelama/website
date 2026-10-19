import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  derivedAssignments,
  type Appointment,
  type AppointmentRoleMap,
  type AppointmentSeat,
  type DerivedAssignment,
  type OrgUnit,
} from "@website/domain/organizations";
import { studyStatus } from "@website/domain/members";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import type { RoleAssignment } from "@website/permissions";
import { safeId } from "@website/security/validation";
import {
  accountSnapshot,
  plainAssignments,
  roleIdsOf,
  toUserSummary,
  type AuditChange,
  type UserSummary,
} from "../users";
import { createFirestoreAuditWriter } from "./audit";
import { getDocumentsByIds } from "./batch";
import { toDate } from "./slugged";

function toAppointment(id: string, data: Record<string, unknown>): Appointment {
  return {
    ...(data as Omit<Appointment, "id" | "createdAt" | "updatedAt" | "deletedAt">),
    id,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export const appointmentSnapshot = (a: Appointment): Snapshot => ({
  userId: a.userId,
  periodId: a.periodId,
  orgUnitId: a.orgUnitId,
  seat: a.seat,
  title: a.title,
  status: a.status,
  endsOn: a.endsOn,
});

/** The audit entries of one appointment change: the appointment's and the account's. */
export type AppointmentAudit = (
  appointment: { before: Snapshot | null; after: Snapshot; next: Appointment },
  account: { change: AuditChange; user: UserSummary },
) => AuditEvent[];

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * `appointments/{id}` and the roles they give (`users/{uid}.roleAssignments`, source
 * "appointment", bound to the period, linked by `appointmentId`), changed together in ONE
 * transaction so nobody keeps a role after their appointment ended. The seat → role mapping is
 * the settings document `settings/appointmentRoles` ({ map, version }).
 */
export function createFirestoreAppointmentStore(db: Firestore) {
  const docs = db.collection("appointments");
  const users = db.collection("users");
  const units = db.collection("orgUnits");
  const settings = db.collection("settings");
  const mapRef = settings.doc("appointmentRoles");
  const auditLog = createFirestoreAuditWriter(db);

  return {
    async get(id: string): Promise<Appointment | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await docs.doc(id).get();
      return snapshot.exists ? toAppointment(id, snapshot.data() as Record<string, unknown>) : null;
    },

    /** Every appointment of a period (active and ended), oldest first. */
    async listForPeriod(periodId: string): Promise<Appointment[]> {
      const snapshot = await docs.where("periodId", "==", safeId.parse(periodId)).get();
      return snapshot.docs
        .map((doc) => toAppointment(doc.id, doc.data()))
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    },

    /**
     * Officers of the active period who already graduated (B5, §67): a dashboard item for whoever
     * may end appointments. Graduation never ends an appointment by itself.
     */
    async graduatedOfficers(today: string): Promise<Array<Appointment & { graduatedOn: string }>> {
      const active = await settings.doc("activePeriod").get();
      const periodId = active.get("periodId") as string | undefined;
      if (!periodId) return [];
      const snapshot = await docs
        .where("periodId", "==", periodId)
        .where("status", "==", "active")
        .get();
      const list = snapshot.docs.map((doc) => toAppointment(doc.id, doc.data()));
      const profiles = await getDocumentsByIds<Record<string, unknown>>(db, "memberProfiles", [
        ...new Set(list.map((a) => a.userId)),
      ]);
      return list.flatMap((a) => {
        const on = profiles.get(a.userId)?.["graduatedOn"];
        return typeof on === "string" && studyStatus(on, today) === "alumni"
          ? [{ ...a, graduatedOn: on }]
          : [];
      });
    },

    async getRoleMap(): Promise<{ map: AppointmentRoleMap; version: number } | null> {
      const snapshot = await mapRef.get();
      return snapshot.exists
        ? (snapshot.data() as { map: AppointmentRoleMap; version: number })
        : null;
    },

    saveRoleMap(
      map: AppointmentRoleMap,
      expectedVersion: number | null,
      audit: (before: Snapshot | null, after: Snapshot, version: number) => AuditEvent,
      now: Date,
    ): Promise<number> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(mapRef);
        const current = snapshot.exists
          ? (snapshot.data() as { map: AppointmentRoleMap; version: number })
          : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("appointmentRoles version changed");
        }
        const version = (current?.version ?? 0) + 1;
        const log = await auditLog.begin(tx);
        tx.set(mapRef, { map, version, updatedAt: now });
        log.append(audit(current && { ...current.map }, { ...map }, version));
        return version;
      });
    },

    /**
     * Appoints `userId` to a seat of a unit of the ACTIVE period and gives the derived roles.
     * `checked` is what the caller vetted (escalation, second factor); if the unit or the mapping
     * changed meanwhile, the roles would differ and the appointment is refused as a conflict.
     */
    appoint(
      input: { userId: string; orgUnitId: string; seat: AppointmentSeat; title: string },
      checked: readonly DerivedAssignment[],
      audit: AppointmentAudit,
      now: Date,
    ): Promise<Appointment> {
      const ref = docs.doc(randomUUID());
      const userRef = users.doc(safeId.parse(input.userId));
      return db.runTransaction(async (tx) => {
        const [active, unitSnapshot, userSnapshot, mapSnapshot, same] = await Promise.all([
          tx.get(settings.doc("activePeriod")),
          tx.get(units.doc(safeId.parse(input.orgUnitId))),
          tx.get(userRef),
          tx.get(mapRef),
          tx.get(
            docs
              .where("userId", "==", input.userId)
              .where("orgUnitId", "==", input.orgUnitId)
              .where("status", "==", "active"),
          ),
        ]);
        const unit = unitSnapshot.data() as Omit<OrgUnit, "id"> | undefined;
        const periodId = active.get("periodId") as string;
        if (!unit || !unit.active || unit.deletedAt || unit.periodId !== periodId) {
          throw new RuleViolationError(
            "Appointments are made in an active unit of the active period.",
          );
        }
        if (!userSnapshot.exists) throw new RuleViolationError("No account with this e-mail.");
        if (!same.empty)
          throw new RuleViolationError("This person is already appointed in this unit.");
        const { map } = mapSnapshot.data() as { map: AppointmentRoleMap };
        const derived = derivedAssignments(
          input.seat,
          { id: input.orgUnitId, type: unit.type },
          map,
        );
        if (JSON.stringify(derived) !== JSON.stringify(checked)) {
          throw new ConcurrencyConflictError("appointment roles changed");
        }

        const user = toUserSummary(input.userId, userSnapshot.data() as Record<string, unknown>);
        const fields: Omit<Appointment, "id"> = {
          ...input,
          name: user.name ?? user.email ?? input.userId,
          periodId,
          status: "active",
          startsOn: day(now),
          endsOn: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        const appointment: Appointment = { id: ref.id, ...fields };
        const added: RoleAssignment[] = derived.map((d) => ({
          ...d,
          periodId,
          source: "appointment",
          revokedAt: null,
          appointmentId: ref.id,
        }));
        const next = {
          ...user,
          roleAssignments: [...user.roleAssignments, ...added],
          version: user.version + 1,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, fields);
        tx.update(userRef, {
          roleAssignments: plainAssignments(next.roleAssignments),
          roleIds: roleIdsOf(next.roleAssignments),
          version: next.version,
        });
        const change = {
          before: accountSnapshot(user),
          after: accountSnapshot(next),
          versionBefore: user.version,
          versionAfter: next.version,
        };
        for (const event of audit(
          { before: null, after: appointmentSnapshot(appointment), next: appointment },
          { change, user },
        )) {
          log.append(event);
        }
        return appointment;
      });
    },

    /**
     * Ends an appointment ("ended" at the end of the term, "revoked" in between) and revokes
     * exactly the roles it gave (`revokedAt`; kept for history). `decide` may refuse (throw).
     */
    end(
      id: string,
      expectedVersion: number,
      status: "ended" | "revoked",
      decide: (appointment: Appointment) => void,
      audit: AppointmentAudit,
      now: Date,
    ): Promise<Appointment> {
      const ref = docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This item does not exist.");
        const current = toAppointment(id, snapshot.data() as Record<string, unknown>);
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("appointments version changed");
        }
        if (current.status !== "active") {
          throw new RuleViolationError("This appointment has already ended.");
        }
        decide(current);
        const userRef = users.doc(current.userId);
        const userSnapshot = await tx.get(userRef);
        const user = toUserSummary(current.userId, userSnapshot.data() as Record<string, unknown>);
        const next: Appointment = {
          ...current,
          status,
          endsOn: day(now),
          version: current.version + 1,
          updatedAt: now,
        };
        const nextUser = {
          ...user,
          roleAssignments: user.roleAssignments.map((a) =>
            a.appointmentId === id && !a.revokedAt ? { ...a, revokedAt: now } : a,
          ),
          version: user.version + 1,
        };
        const log = await auditLog.begin(tx);
        tx.update(ref, { status, endsOn: next.endsOn, version: next.version, updatedAt: now });
        tx.update(userRef, {
          roleAssignments: plainAssignments(nextUser.roleAssignments),
          version: nextUser.version,
        });
        const change = {
          before: accountSnapshot(user),
          after: accountSnapshot(nextUser),
          versionBefore: user.version,
          versionAfter: nextUser.version,
        };
        for (const event of audit(
          { before: appointmentSnapshot(current), after: appointmentSnapshot(next), next },
          { change, user },
        )) {
          log.append(event);
        }
        return next;
      });
    },
  };
}

export type FirestoreAppointmentStore = ReturnType<typeof createFirestoreAppointmentStore>;
