import { randomUUID } from "node:crypto";
import type { CollectionReference, Database, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import { parseAnswers, versionDocId, type Answers, type FileAnswer } from "@website/domain/forms";
import {
  applicationId,
  assertTransition,
  checkChoices,
  isRecruitmentOpen,
  offerExpired,
  portfolioRequired,
  revisionDocId,
  seatCounterId,
  takeSeat,
  assertBookable,
  slotTimes,
  type InterviewSlot,
  type SlotPlan,
  type Offer,
  type RevisionRound,
  type Application,
  type ApplicationStatus,
  type Recruitment,
  type RecruitmentInput,
  type RecruitmentUnit,
} from "@website/domain/recruitment";
import type { Appointment, DerivedAssignment } from "@website/domain/organizations";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { prepareAppointment, writeAppointment, type AppointmentAudit } from "./appointments";
import { createSqlAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";

export type RecruitmentFields = Omit<Recruitment, "id" | "version" | "createdAt" | "updatedAt">;

function toRecruitment(id: string, data: Record<string, unknown>): Recruitment {
  return {
    id,
    periodId: data["periodId"] as string,
    title: data["title"] as string,
    description: data["description"] as string,
    opensAt: toDate(data["opensAt"]) as Date,
    closesAt: toDate(data["closesAt"]) as Date,
    maxChoices: data["maxChoices"] as number,
    units: data["units"] as RecruitmentUnit[],
    offerDays: data["offerDays"] as number,
    formId: data["formId"] as string,
    formVersion: data["formVersion"] as number,
    pactTemplateUrl: (data["pactTemplateUrl"] as string | null | undefined) ?? null,
    published: data["published"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function recruitmentSnapshot(r: RecruitmentFields): Snapshot {
  return {
    periodId: r.periodId,
    title: r.title,
    description: r.description,
    opensAt: r.opensAt.toISOString(),
    closesAt: r.closesAt.toISOString(),
    maxChoices: r.maxChoices,
    units: r.units.map((u) => ({ ...u })),
    offerDays: r.offerDays,
    formId: r.formId,
    formVersion: r.formVersion,
    pactTemplateUrl: r.pactTemplateUrl,
    published: r.published,
  };
}

export function toApplication(id: string, data: Record<string, unknown>): Application {
  const offer = data["offer"] as { orgUnitId: string; expiresAt: unknown } | null | undefined;
  const interview = data["interview"] as { slotId: string; startsAt: unknown } | null | undefined;
  return {
    id,
    recruitmentId: data["recruitmentId"] as string,
    userId: data["userId"] as string,
    status: data["status"] as ApplicationStatus,
    choices: data["choices"] as string[],
    answers: data["answers"] as Answers,
    portfolio: (data["portfolio"] as FileAnswer | null | undefined) ?? null,
    revisionRound: data["revisionRound"] as number,
    offer: offer
      ? { orgUnitId: offer.orgUnitId, expiresAt: toDate(offer.expiresAt) as Date }
      : null,
    interview: interview
      ? { slotId: interview.slotId, startsAt: toDate(interview.startsAt) as Date }
      : null,
    pacts: (data["pacts"] as FileAnswer[] | undefined) ?? [],
    pactNote: (data["pactNote"] as string | null | undefined) ?? null,
    appointmentId: (data["appointmentId"] as string | null | undefined) ?? null,
    submittedAt: toDate(data["submittedAt"]),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
  };
}

export function applicationSnapshot(a: Application): Snapshot {
  return {
    status: a.status,
    choices: [...a.choices],
    revisionRound: a.revisionRound,
    offer: a.offer
      ? { orgUnitId: a.offer.orgUnitId, expiresAt: a.offer.expiresAt.toISOString() }
      : null,
    portfolio: a.portfolio ? a.portfolio.name : null,
    pacts: a.pacts.map((p) => p.name),
    appointmentId: a.appointmentId,
  };
}

const applicationDoc = (a: Application) => ({
  recruitmentId: a.recruitmentId,
  userId: a.userId,
  status: a.status,
  choices: a.choices,
  answers: a.answers,
  portfolio: a.portfolio,
  revisionRound: a.revisionRound,
  offer: a.offer,
  interview: a.interview,
  pacts: a.pacts,
  pactNote: a.pactNote,
  appointmentId: a.appointmentId,
  submittedAt: a.submittedAt,
  version: a.version,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

function toRevision(data: Record<string, unknown>): RevisionRound {
  return {
    applicationId: data["applicationId"] as string,
    round: data["round"] as number,
    request: data["request"] as string,
    requestedAt: toDate(data["requestedAt"]) as Date,
    requestedBy: data["requestedBy"] as string,
    resubmittedAt: toDate(data["resubmittedAt"]),
  };
}

const listRevisions = async (
  revisions: CollectionReference,
  id: string,
): Promise<RevisionRound[]> => {
  const snapshot = await revisions.where("applicationId", "==", id).get();
  return snapshot.docs.map((doc) => toRevision(doc.data())).sort((a, b) => a.round - b.round);
};

function toSlot(id: string, data: Record<string, unknown>): InterviewSlot {
  return {
    id,
    recruitmentId: data["recruitmentId"] as string,
    startsAt: toDate(data["startsAt"]) as Date,
    durationMinutes: data["durationMinutes"] as number,
    capacity: data["capacity"] as number,
    booked: data["booked"] as number,
    location: data["location"] as string,
    deletedAt: toDate(data["deletedAt"]),
  };
}

const listSlots = async (slots: CollectionReference, recruitmentId: string) => {
  const snapshot = await slots.where("recruitmentId", "==", safeId.parse(recruitmentId)).get();
  return snapshot.docs
    .map((doc) => toSlot(doc.id, doc.data()))
    .filter((slot) => !slot.deletedAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
};

export interface Decision {
  readonly status: ApplicationStatus;
  readonly offer?: Offer;
  readonly revision?: { readonly request: string; readonly requestedBy: string };
  readonly pactNote?: string;
}

const submittedTime = (a: Application) => a.submittedAt?.getTime() ?? 0;

export type ApplicationAudit = (
  before: Snapshot,
  after: Snapshot,
  current: Application,
  next: Application,
  recruitmentTitle: string,
) => AuditEvent;

export type RecruitmentAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Recruitment | null,
  next: Recruitment,
) => AuditEvent;

export function createSqlRecruitmentStore(db: Database) {
  const store = createSluggedStore<Recruitment>(db, {
    collection: "recruitments",
    slug: null,
    fromDoc: toRecruitment,
    snapshot: recruitmentSnapshot,
    fixed: () => ({}),
  });
  const counters = db.collection("seatCounters");
  const auditLog = createSqlAuditWriter(db);

  return {
    get: store.get,
    write: store.write,

    async listForAdmin(): Promise<Recruitment[]> {
      const snapshot = await store.docs.orderBy("opensAt", "desc").get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data())).filter((r) => !r.deletedAt);
    },

    async seats(
      recruitmentIds: readonly string[],
    ): Promise<Map<string, Map<string, { quota: number; filled: number }>>> {
      const result = new Map<string, Map<string, { quota: number; filled: number }>>();
      for (let i = 0; i < recruitmentIds.length; i += 30) {
        const chunk = recruitmentIds.slice(i, i + 30);
        const snapshot = await counters.where("recruitmentId", "in", chunk).get();
        for (const doc of snapshot.docs) {
          const id = doc.get("recruitmentId") as string;
          const units = result.get(id) ?? new Map<string, { quota: number; filled: number }>();
          units.set(doc.get("orgUnitId") as string, {
            quota: doc.get("quota") as number,
            filled: doc.get("filled") as number,
          });
          result.set(id, units);
        }
      }
      return result;
    },

    save(
      id: string | null,
      expectedVersion: number | null,
      input: RecruitmentInput,
      audit: RecruitmentAudit,
      now: Date,
    ): Promise<Recruitment> {
      const ref = store.docs.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = id === null ? null : await tx.get(ref);
        if (id !== null && !snapshot?.exists) {
          throw new RuleViolationError("This item does not exist.");
        }
        const current = snapshot?.exists ? store.read(ref.id, snapshot.data()) : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError("recruitments version changed");
        }
        if (current?.deletedAt) throw new RuleViolationError("This item is in the trash.");
        if (current && current.periodId !== input.periodId) {
          throw new RuleViolationError("A recruitment stays in its board period.");
        }
        const removed = (current?.units ?? []).filter(
          (u) => !input.units.some((i) => i.orgUnitId === u.orgUnitId),
        );
        const unitIds = [
          ...input.units.map((u) => u.orgUnitId),
          ...removed.map((u) => u.orgUnitId),
        ];
        const [period, form, units, seats] = await Promise.all([
          tx.get(db.collection("periods").doc(input.periodId)),
          tx.get(db.collection("forms").doc(input.formId)),
          Promise.all(input.units.map((u) => tx.get(db.collection("orgUnits").doc(u.orgUnitId)))),
          Promise.all(unitIds.map((u) => tx.get(counters.doc(seatCounterId(ref.id, u))))),
        ]);
        if (!period.exists || period.get("deletedAt")) {
          throw new RuleViolationError("Choose an existing board period.");
        }
        if (period.get("status") === "archived") {
          throw new RuleViolationError("This period is archived and can no longer be changed.");
        }
        if (!form.exists || form.get("deletedAt") || form.get("usage") !== "recruitment") {
          throw new RuleViolationError("Choose a recruitment form.");
        }
        const filled = new Map(
          seats
            .filter((s) => s.exists)
            .map((s) => [s.get("orgUnitId") as string, s.get("filled") as number]),
        );
        const recruitmentUnits = input.units.map((u, i): RecruitmentUnit => {
          const unit = units[i];
          if (!unit?.exists || unit.get("deletedAt") || unit.get("periodId") !== input.periodId) {
            throw new RuleViolationError("Choose units of this board period.");
          }
          const name = unit.get("name") as string;
          if ((filled.get(u.orgUnitId) ?? 0) > u.quota) {
            throw new RuleViolationError(`${name} already has more accepted seats than that.`);
          }
          return {
            orgUnitId: u.orgUnitId,
            name,
            quota: u.quota,
            portfolioRequired: u.portfolioRequired,
          };
        });
        const taken = removed.find((u) => (filled.get(u.orgUnitId) ?? 0) > 0);
        if (taken) throw new RuleViolationError(`${taken.name} has accepted seats; keep it.`);

        const next: Recruitment = {
          id: ref.id,
          periodId: input.periodId,
          title: input.title,
          description: input.description,
          opensAt: input.opensAt,
          closesAt: input.closesAt,
          maxChoices: input.maxChoices,
          units: recruitmentUnits,
          offerDays: input.offerDays,
          formId: input.formId,
          formVersion: form.get("currentVersion") as number,
          pactTemplateUrl: input.pactTemplateUrl,
          published: current?.published ?? false,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, {
          ...recruitmentSnapshot(next),
          version: next.version,
          createdAt: next.createdAt,
          updatedAt: now,
          deletedAt: null,
        });
        for (const unit of recruitmentUnits) {
          tx.set(counters.doc(seatCounterId(ref.id, unit.orgUnitId)), {
            recruitmentId: ref.id,
            orgUnitId: unit.orgUnitId,
            quota: unit.quota,
            filled: filled.get(unit.orgUnitId) ?? 0,
          });
        }
        for (const unit of removed) tx.delete(counters.doc(seatCounterId(ref.id, unit.orgUnitId)));
        log.append(
          audit(current && recruitmentSnapshot(current), recruitmentSnapshot(next), current, next),
        );
        return next;
      });
    },
  };
}

export type SqlRecruitmentStore = ReturnType<typeof createSqlRecruitmentStore>;

export function createSqlApplicationStore(db: Database) {
  const recruitments = db.collection("recruitments");
  const applications = db.collection("applications");
  const revisions = db.collection("applicationRevisions");
  const counters = db.collection("seatCounters");
  const auditLog = createSqlAuditWriter(db);

  return {
    async listForRecruitment(recruitmentId: string): Promise<Application[]> {
      const snapshot = await applications
        .where("recruitmentId", "==", safeId.parse(recruitmentId))
        .get();
      return snapshot.docs
        .map((doc) => toApplication(doc.id, doc.data()))
        .filter((a) => a.status !== "draft")
        .sort((a, b) => submittedTime(a) - submittedTime(b));
    },

    async interviewsBetween(from: Date, to: Date): Promise<Application[]> {
      const snapshot = await applications
        .where("interview.startsAt", ">=", from)
        .where("interview.startsAt", "<", to)
        .get();
      return snapshot.docs
        .map((doc) => toApplication(doc.id, doc.data()))
        .filter((a) => a.status === "interview");
    },

    async get(id: string): Promise<Application | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await applications.doc(id).get();
      return snapshot.exists
        ? toApplication(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
    },

    revisions: (id: string) => listRevisions(revisions, safeId.parse(id)),

    async revisionsForRecruitment(recruitmentId: string): Promise<RevisionRound[]> {
      const snapshot = await revisions
        .where("recruitmentId", "==", safeId.parse(recruitmentId))
        .get();
      return snapshot.docs.map((doc) => toRevision(doc.data())).sort((a, b) => a.round - b.round);
    },

    ratify(
      id: string,
      expectedVersion: number,
      appointment: { readonly title: string },
      checked: readonly DerivedAssignment[],
      audits: { readonly appointment: AppointmentAudit; readonly application: ApplicationAudit },
      now: Date,
    ): Promise<{ application: Application; appointment: Appointment }> {
      const ref = applications.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This application does not exist.");
        const current = toApplication(snapshot.id, snapshot.data() as Record<string, unknown>);
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("applications version changed");
        }
        assertTransition(current.status, "confirmed");
        const rSnapshot = await tx.get(recruitments.doc(current.recruitmentId));
        const recruitment = toRecruitment(
          rSnapshot.id,
          rSnapshot.data() as Record<string, unknown>,
        );
        const orgUnitId = (current.offer as Offer).orgUnitId;
        const prepared = await prepareAppointment(
          db,
          tx,
          { userId: current.userId, orgUnitId, seat: "member", title: appointment.title },
          checked,
          now,
        );
        const next: Application = {
          ...current,
          status: "confirmed",
          appointmentId: prepared.appointment.id,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, applicationDoc(next));
        const created = writeAppointment(db, tx, log, prepared, audits.appointment);
        log.append(
          audits.application(
            applicationSnapshot(current),
            applicationSnapshot(next),
            current,
            next,
            recruitment.title,
          ),
        );
        return { application: next, appointment: created };
      });
    },

    decide(
      id: string,
      expectedVersion: number,
      decide: (application: Application, recruitment: Recruitment) => Decision,
      audit: ApplicationAudit,
      now: Date,
    ): Promise<Application> {
      const ref = applications.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This application does not exist.");
        const current = toApplication(snapshot.id, snapshot.data() as Record<string, unknown>);
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("applications version changed");
        }
        const rSnapshot = await tx.get(recruitments.doc(current.recruitmentId));
        const recruitment = toRecruitment(
          rSnapshot.id,
          rSnapshot.data() as Record<string, unknown>,
        );
        const decision = decide(current, recruitment);
        assertTransition(current.status, decision.status);
        const offerCounter = decision.offer
          ? counters.doc(seatCounterId(recruitment.id, decision.offer.orgUnitId))
          : null;
        const releaseCounter =
          current.status === "accepted" && current.offer
            ? counters.doc(seatCounterId(recruitment.id, current.offer.orgUnitId))
            : null;
        const [offerSeat, releaseSeat] = await Promise.all([
          offerCounter && tx.get(offerCounter),
          releaseCounter && tx.get(releaseCounter),
        ]);
        if (offerSeat) {
          takeSeat(
            offerSeat.exists
              ? {
                  quota: offerSeat.get("quota") as number,
                  filled: offerSeat.get("filled") as number,
                }
              : null,
          );
        }
        const round = decision.revision ? current.revisionRound + 1 : current.revisionRound;
        const next: Application = {
          ...current,
          status: decision.status,
          offer: decision.offer ?? current.offer,
          pactNote: decision.pactNote ?? current.pactNote,
          revisionRound: round,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await auditLog.begin(tx);
        tx.set(ref, applicationDoc(next));
        if (decision.revision) {
          tx.create(revisions.doc(revisionDocId(current.id, round)), {
            applicationId: current.id,
            recruitmentId: current.recruitmentId,
            round,
            request: decision.revision.request,
            requestedAt: now,
            requestedBy: decision.revision.requestedBy,
            resubmittedAt: null,
          });
        }
        if (releaseSeat?.exists) {
          tx.update(releaseCounter as NonNullable<typeof releaseCounter>, {
            filled: Math.max(0, (releaseSeat.get("filled") as number) - 1),
          });
        }
        log.append(
          audit(
            applicationSnapshot(current),
            applicationSnapshot(next),
            current,
            next,
            recruitment.title,
          ),
        );
        return next;
      });
    },
  };
}

export type SqlApplicationStore = ReturnType<typeof createSqlApplicationStore>;

export function createSqlInterviewStore(db: Database) {
  const slots = db.collection("interviewSlots");
  const recruitments = db.collection("recruitments");
  const auditLog = createSqlAuditWriter(db);

  return {
    listForRecruitment: (recruitmentId: string) => listSlots(slots, recruitmentId),

    createPlan(
      recruitmentId: string,
      plan: SlotPlan,
      audit: (created: readonly InterviewSlot[], title: string) => AuditEvent,
      now: Date,
    ): Promise<InterviewSlot[]> {
      return db.runTransaction(async (tx) => {
        const r = await tx.get(recruitments.doc(safeId.parse(recruitmentId)));
        if (!r.exists || r.get("deletedAt")) {
          throw new RuleViolationError("This recruitment does not exist.");
        }
        const created = slotTimes(plan)
          .filter((startsAt) => startsAt > now)
          .map((startsAt): InterviewSlot => ({
            id: randomUUID(),
            recruitmentId: r.id,
            startsAt,
            durationMinutes: plan.durationMinutes,
            capacity: plan.capacity,
            booked: 0,
            location: plan.location,
            deletedAt: null,
          }));
        if (created.length === 0)
          throw new RuleViolationError("No interview time is in the future.");
        const log = await auditLog.begin(tx);
        for (const { id, ...slot } of created) tx.create(slots.doc(id), slot);
        log.append(audit(created, r.get("title") as string));
        return created;
      });
    },

    remove(id: string, audit: (slot: InterviewSlot) => AuditEvent, now: Date): Promise<void> {
      const ref = slots.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const slot = snapshot.exists
          ? toSlot(snapshot.id, snapshot.data() as Record<string, unknown>)
          : null;
        if (!slot || slot.deletedAt)
          throw new RuleViolationError("This interview time does not exist.");
        if (slot.booked > 0) throw new RuleViolationError("Someone booked this time; it stays.");
        const log = await auditLog.begin(tx);
        tx.update(ref, { deletedAt: now });
        log.append(audit(slot));
      });
    },
  };
}

export type SqlInterviewStore = ReturnType<typeof createSqlInterviewStore>;

export type ApplyOutcome =
  | { readonly ok: true; readonly application: Application }
  | {
      readonly ok: false;
      readonly error: "closed" | "locked" | "refused";
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly error: "answers";
      readonly fields: Readonly<Record<string, string>>;
    };

const applicantAudit = (
  uid: string,
  now: Date,
  title: string,
  before: Application | null,
  after: Application,
): AuditEvent => ({
  id: randomUUID(),
  occurredAt: now,
  actor: { type: "member", id: uid },
  action: before ? "UPDATE" : "CREATE",
  module: "recruitment",
  title,
  resourceType: "application",
  resourceId: after.id,
  operationId: randomUUID(),
  before: before && applicationSnapshot(before),
  after: applicationSnapshot(after),
  versionBefore: before?.version ?? null,
  versionAfter: after.version,
  revertible: false,
  revertOf: null,
  request: { requestId: randomUUID() },
  prevHash: null,
  hash: null,
});

export function createSqlRecruitmentWebStore(db: Database) {
  const recruitments = db.collection("recruitments");
  const applications = db.collection("applications");
  const versions = db.collection("formVersions");
  const revisions = db.collection("applicationRevisions");
  const counters = db.collection("seatCounters");
  const slotsCollection = db.collection("interviewSlots");
  const auditLog = createSqlAuditWriter(db);

  const readRecruitment = async (tx: Transaction, id: string) => {
    const snapshot = await tx.get(recruitments.doc(safeId.parse(id)));
    const r = snapshot.exists
      ? toRecruitment(snapshot.id, snapshot.data() as Record<string, unknown>)
      : null;
    return r && !r.deletedAt ? r : null;
  };

  const change = (
    recruitmentId: string,
    uid: string,
    now: Date,
    apply: (
      r: Recruitment,
      current: Application | null,
      questions: Parameters<typeof parseAnswers>[0],
    ) => Application | Exclude<ApplyOutcome, { ok: true }>,
    markAnswered = false,
    also?: (tx: Transaction, current: Application | null, next: Application) => void,
  ): Promise<ApplyOutcome> =>
    db.runTransaction(async (tx): Promise<ApplyOutcome> => {
      const r = await readRecruitment(tx, recruitmentId);
      if (!r) return { ok: false, error: "closed" };
      const ref = applications.doc(applicationId(r.id, safeId.parse(uid)));
      const versionRef = versions.doc(versionDocId(r.formId, r.formVersion));
      const [snapshot, version] = await Promise.all([tx.get(ref), tx.get(versionRef)]);
      const current = snapshot.exists
        ? toApplication(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
      const questions = version.exists
        ? (version.get("questions") as Parameters<typeof parseAnswers>[0])
        : [];
      const result = apply(r, current, questions);
      if ("ok" in result) return result;
      const log = await auditLog.begin(tx);
      tx.set(ref, applicationDoc(result));
      also?.(tx, current, result);
      if (markAnswered && version.exists && !version.get("answered")) {
        tx.update(versionRef, { answered: true });
      }
      log.append(applicantAudit(uid, now, r.title, current, result));
      return { ok: true, application: result };
    });

  const editable = (current: Application | null) =>
    current === null || current.status === "draft" || current.status === "revision";

  const base = (r: Recruitment, uid: string, current: Application | null, now: Date) =>
    current ?? {
      id: applicationId(r.id, uid),
      recruitmentId: r.id,
      userId: uid,
      status: "draft" as const,
      choices: [],
      answers: {},
      portfolio: null,
      revisionRound: 0,
      offer: null,
      interview: null,
      pacts: [],
      pactNote: null,
      appointmentId: null,
      submittedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

  const bump = (a: Application, now: Date, patch: Partial<Application>): Application => ({
    ...a,
    ...patch,
    version: a.version + 1,
    updatedAt: now,
  });

  return {
    async listPublished(): Promise<Recruitment[]> {
      const snapshot = await recruitments.where("published", "==", true).get();
      return snapshot.docs
        .map((doc) => toRecruitment(doc.id, doc.data()))
        .filter((r) => !r.deletedAt)
        .sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime());
    },

    async getVisible(id: string): Promise<Recruitment | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await recruitments.doc(id).get();
      const r = snapshot.exists
        ? toRecruitment(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
      return r && !r.deletedAt ? r : null;
    },

    async getPublished(id: string): Promise<Recruitment | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await recruitments.doc(id).get();
      const r = snapshot.exists
        ? toRecruitment(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
      return r && r.published && !r.deletedAt ? r : null;
    },

    async questions(r: Recruitment) {
      const snapshot = await versions.doc(versionDocId(r.formId, r.formVersion)).get();
      return snapshot.exists
        ? (snapshot.get("questions") as Parameters<typeof parseAnswers>[0])
        : [];
    },

    async ownApplication(recruitmentId: string, uid: string): Promise<Application | null> {
      if (!safeId.safeParse(recruitmentId).success || !safeId.safeParse(uid).success) return null;
      const snapshot = await applications.doc(applicationId(recruitmentId, uid)).get();
      return snapshot.exists
        ? toApplication(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
    },

    saveDraft(
      recruitmentId: string,
      uid: string,
      draft: { choices: string[]; answers: Readonly<Record<string, unknown>> },
      now: Date,
    ) {
      return change(recruitmentId, uid, now, (r, current, questions) => {
        if (!isRecruitmentOpen(r, now)) return { ok: false, error: "closed" };
        if (!editable(current)) return { ok: false, error: "locked" };
        let choices: string[] = [];
        try {
          choices = draft.choices.length === 0 ? [] : checkChoices(r, draft.choices);
        } catch (error) {
          return { ok: false, error: "refused", message: (error as Error).message };
        }
        const fileIds = new Set(questions.filter((q) => q.type === "file").map((q) => q.id));
        const sent = Object.fromEntries(
          Object.entries(draft.answers).filter(([id]) => !fileIds.has(id)),
        );
        const parsed = parseAnswers(
          questions.filter((q) => !fileIds.has(q.id)).map((q) => ({ ...q, required: false })),
          sent,
        );
        if (!parsed.ok) return { ok: false, error: "answers", fields: parsed.fields };
        const application = base(r, uid, current, now);
        const files = Object.fromEntries(
          Object.entries(application.answers).filter(([id]) => fileIds.has(id)),
        );
        return bump(application, now, { choices, answers: { ...parsed.answers, ...files } });
      });
    },

    setPortfolio(recruitmentId: string, uid: string, file: FileAnswer, now: Date) {
      return change(recruitmentId, uid, now, (r, current) => {
        if (!isRecruitmentOpen(r, now)) return { ok: false, error: "closed" };
        if (!editable(current)) return { ok: false, error: "locked" };
        return bump(base(r, uid, current, now), now, { portfolio: file });
      });
    },

    setPact(recruitmentId: string, uid: string, file: FileAnswer, now: Date) {
      return change(recruitmentId, uid, now, (_r, current) => {
        if (!current || current.status !== "approved") return { ok: false, error: "locked" };
        return bump(current, now, {
          status: "pakta_review",
          pacts: [...current.pacts, file],
          pactNote: null,
        });
      });
    },

    setAnswerFile(
      recruitmentId: string,
      uid: string,
      questionId: string,
      file: FileAnswer,
      now: Date,
    ) {
      return change(recruitmentId, uid, now, (r, current, questions) => {
        if (!isRecruitmentOpen(r, now)) return { ok: false, error: "closed" };
        if (!editable(current)) return { ok: false, error: "locked" };
        if (!questions.some((q) => q.id === questionId && q.type === "file")) {
          return { ok: false, error: "refused", message: "Unknown question." };
        }
        const application = base(r, uid, current, now);
        return bump(application, now, { answers: { ...application.answers, [questionId]: file } });
      });
    },

    submit(recruitmentId: string, uid: string, now: Date) {
      return change(
        recruitmentId,
        uid,
        now,
        (r, current, questions) => {
          if (!isRecruitmentOpen(r, now)) return { ok: false, error: "closed" };
          if (!current || !editable(current)) return { ok: false, error: "locked" };
          try {
            checkChoices(r, current.choices);
          } catch (error) {
            return { ok: false, error: "refused", message: (error as Error).message };
          }
          if (portfolioRequired(r, current.choices) && !current.portfolio) {
            return { ok: false, error: "refused", message: "Upload your portfolio (PDF)." };
          }
          const parsed = parseAnswers(questions, current.answers);
          if (!parsed.ok) return { ok: false, error: "answers", fields: parsed.fields };
          assertTransition(current.status, "submitted");
          return bump(current, now, { status: "submitted", submittedAt: now });
        },
        true,
        (tx, current, next) => {
          if (current?.status === "revision") {
            tx.update(revisions.doc(revisionDocId(next.id, current.revisionRound)), {
              resubmittedAt: now,
            });
          }
        },
      );
    },

    slots: (recruitmentId: string) => listSlots(slotsCollection, recruitmentId),

    bookInterview(
      recruitmentId: string,
      uid: string,
      slotId: string,
      now: Date,
    ): Promise<ApplyOutcome> {
      return db.runTransaction(async (tx): Promise<ApplyOutcome> => {
        const r = await readRecruitment(tx, recruitmentId);
        if (!r) return { ok: false, error: "closed" };
        const ref = applications.doc(applicationId(r.id, safeId.parse(uid)));
        const newRef = slotsCollection.doc(safeId.parse(slotId));
        const [snapshot, chosen] = await Promise.all([tx.get(ref), tx.get(newRef)]);
        const current = snapshot.exists
          ? toApplication(snapshot.id, snapshot.data() as Record<string, unknown>)
          : null;
        if (!current || current.status !== "interview") return { ok: false, error: "locked" };
        if (current.interview?.slotId === slotId) return { ok: true, application: current };
        const oldRef = current.interview ? slotsCollection.doc(current.interview.slotId) : null;
        const old = oldRef ? await tx.get(oldRef) : null;
        const found = chosen.exists
          ? toSlot(chosen.id, chosen.data() as Record<string, unknown>)
          : null;
        let slot: InterviewSlot;
        try {
          slot = assertBookable(found?.recruitmentId === r.id ? found : null, now);
        } catch (error) {
          return { ok: false, error: "refused", message: (error as Error).message };
        }
        const next = bump(current, now, { interview: { slotId, startsAt: slot.startsAt } });
        const log = await auditLog.begin(tx);
        tx.set(ref, applicationDoc(next));
        tx.update(newRef, { booked: slot.booked + 1 });
        if (oldRef && old?.exists) {
          tx.update(oldRef, { booked: Math.max(0, (old.get("booked") as number) - 1) });
        }
        log.append(applicantAudit(uid, now, r.title, current, next));
        return { ok: true, application: next };
      });
    },

    async ownRevisions(recruitmentId: string, uid: string): Promise<RevisionRound[]> {
      return listRevisions(
        revisions,
        applicationId(safeId.parse(recruitmentId), safeId.parse(uid)),
      );
    },

    respondOffer(
      recruitmentId: string,
      uid: string,
      accept: boolean,
      now: Date,
    ): Promise<ApplyOutcome> {
      return db.runTransaction(async (tx): Promise<ApplyOutcome> => {
        const r = await readRecruitment(tx, recruitmentId);
        if (!r) return { ok: false, error: "closed" };
        const ref = applications.doc(applicationId(r.id, safeId.parse(uid)));
        const snapshot = await tx.get(ref);
        const current = snapshot.exists
          ? toApplication(snapshot.id, snapshot.data() as Record<string, unknown>)
          : null;
        if (!current || current.status !== "offered" || !current.offer) {
          return { ok: false, error: "locked" };
        }
        if (offerExpired(current.offer, now)) {
          return { ok: false, error: "refused", message: "This offer has expired." };
        }
        const counterRef = counters.doc(seatCounterId(r.id, current.offer.orgUnitId));
        let filled = 0;
        if (accept) {
          const counter = await tx.get(counterRef);
          try {
            filled = takeSeat(
              counter.exists
                ? { quota: counter.get("quota") as number, filled: counter.get("filled") as number }
                : null,
            );
          } catch (error) {
            return { ok: false, error: "refused", message: (error as Error).message };
          }
        }
        const next = bump(current, now, { status: accept ? "accepted" : "declined" });
        const log = await auditLog.begin(tx);
        tx.set(ref, applicationDoc(next));
        if (accept) tx.update(counterRef, { filled });
        log.append(applicantAudit(uid, now, r.title, current, next));
        return { ok: true, application: next };
      });
    },

    withdraw(recruitmentId: string, uid: string, now: Date) {
      return change(recruitmentId, uid, now, (_r, current) => {
        if (!current || !["draft", "submitted", "revision", "interview"].includes(current.status)) {
          return { ok: false, error: "locked" };
        }
        return bump(current, now, { status: "withdrawn" });
      });
    },
  };
}

export type SqlRecruitmentWebStore = ReturnType<typeof createSqlRecruitmentWebStore>;
