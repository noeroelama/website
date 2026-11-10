import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "./store";
import type { AuditAppender, AuditEvent, Snapshot } from "@website/audit";
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
import { createSqlAuditWriter } from "./audit";
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

export type AppointmentAudit = (
  appointment: { before: Snapshot | null; after: Snapshot; next: Appointment },
  account: { change: AuditChange; user: UserSummary },
) => AuditEvent[];

const day = (date: Date) => date.toISOString().slice(0, 10);

export interface AppointmentRequest {
  readonly userId: string;
  readonly orgUnitId: string;
  readonly seat: AppointmentSeat;
  readonly title: string;
}

export interface PreparedAppointment {
  readonly appointment: Appointment;
  readonly user: UserSummary;
  readonly added: readonly RoleAssignment[];
}

export async function prepareAppointment(
  db: Database,
  tx: Transaction,
  input: AppointmentRequest,
  checked: readonly DerivedAssignment[],
  now: Date,
): Promise<PreparedAppointment> {
  const docs = db.collection("appointments");
  const settings = db.collection("settings");
  const [active, unitSnapshot, userSnapshot, mapSnapshot, same] = await Promise.all([
    tx.get(settings.doc("activePeriod")),
    tx.get(db.collection("orgUnits").doc(safeId.parse(input.orgUnitId))),
    tx.get(db.collection("users").doc(safeId.parse(input.userId))),
    tx.get(settings.doc("appointmentRoles")),
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
    throw new RuleViolationError("Appointments are made in an active unit of the active period.");
  }
  if (!userSnapshot.exists) throw new RuleViolationError("No account with this e-mail.");
  if (!same.empty) throw new RuleViolationError("This person is already appointed in this unit.");
  const { map } = mapSnapshot.data() as { map: AppointmentRoleMap };
  const derived = derivedAssignments(input.seat, { id: input.orgUnitId, type: unit.type }, map);
  if (JSON.stringify(derived) !== JSON.stringify(checked)) {
    throw new ConcurrencyConflictError("appointment roles changed");
  }
  const user = toUserSummary(input.userId, userSnapshot.data() as Record<string, unknown>);
  const id = randomUUID();
  const appointment: Appointment = {
    ...input,
    id,
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
  const added: RoleAssignment[] = derived.map((d) => ({
    ...d,
    periodId,
    source: "appointment",
    revokedAt: null,
    appointmentId: id,
  }));
  return { appointment, user, added };
}

export function writeAppointment(
  db: Database,
  tx: Transaction,
  log: AuditAppender,
  { appointment, user, added }: PreparedAppointment,
  audit: AppointmentAudit,
): Appointment {
  const next = {
    ...user,
    roleAssignments: [...user.roleAssignments, ...added],
    version: user.version + 1,
  };
  const { id, ...fields } = appointment;
  tx.set(db.collection("appointments").doc(id), fields);
  tx.update(db.collection("users").doc(user.uid), {
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
}

export function createSqlAppointmentStore(db: Database) {
  const docs = db.collection("appointments");
  const users = db.collection("users");
  const settings = db.collection("settings");
  const mapRef = settings.doc("appointmentRoles");
  const auditLog = createSqlAuditWriter(db);

  return {
    async get(id: string): Promise<Appointment | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await docs.doc(id).get();
      return snapshot.exists ? toAppointment(id, snapshot.data() as Record<string, unknown>) : null;
    },

    async listForPeriod(periodId: string): Promise<Appointment[]> {
      const snapshot = await docs.where("periodId", "==", safeId.parse(periodId)).get();
      return snapshot.docs
        .map((doc) => toAppointment(doc.id, doc.data()))
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    },

    /** The user's active appointments in the active period, oldest first. */
    async activeForUser(uid: string): Promise<Appointment[]> {
      const [active, snapshot] = await Promise.all([
        settings.doc("activePeriod").get(),
        docs.where("userId", "==", uid).where("status", "==", "active").get(),
      ]);
      const periodId = active.get("periodId") as string | undefined;
      return snapshot.docs
        .map((doc) => toAppointment(doc.id, doc.data()))
        .filter((a) => a.periodId === periodId)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    },

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

    appoint(
      input: AppointmentRequest,
      checked: readonly DerivedAssignment[],
      audit: AppointmentAudit,
      now: Date,
    ): Promise<Appointment> {
      return db.runTransaction(async (tx) => {
        const prepared = await prepareAppointment(db, tx, input, checked, now);
        const log = await auditLog.begin(tx);
        return writeAppointment(db, tx, log, prepared, audit);
      });
    },

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

export type SqlAppointmentStore = ReturnType<typeof createSqlAppointmentStore>;
