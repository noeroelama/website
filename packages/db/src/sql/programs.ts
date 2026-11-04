import type { Database, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import { orgUnitPath, type OrgUnit, type Period } from "@website/domain/organizations";
import {
  assertCanCheckIn,
  assertOkrWritable,
  assertPlanEditable,
  checkinId,
  type Checkin,
  type CheckinInput,
  type Health,
  type KeyResult,
  type Milestone,
  type Objective,
  type ObjectiveInput,
  type Program,
  type ProgramInput,
  type ProgramStatus,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type ObjectiveFields = Omit<Objective, Meta>;

export type ObjectiveAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Objective | null,
  next: Objective,
) => AuditEvent;

const toObjective = (id: string, data: Record<string, unknown>): Objective => ({
  id,
  periodId: data["periodId"] as string,
  orgUnitId: data["orgUnitId"] as string | null,
  orgUnitPath: data["orgUnitPath"] as string[],
  title: data["title"] as string,
  description: data["description"] as string,
  sort: data["sort"] as number,
  keyResults: (data["keyResults"] as Array<Record<string, unknown>>).map((kr) => ({
    ...(kr as unknown as KeyResult),
    measuredAt: toDate(kr["measuredAt"]),
  })),
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

export function objectiveSnapshot(o: ObjectiveFields): Snapshot {
  return {
    orgUnitId: o.orgUnitId,
    title: o.title,
    description: o.description,
    sort: o.sort,
    keyResults: o.keyResults.map((kr) => ({
      id: kr.id,
      title: kr.title,
      unit: kr.unit,
      baseline: kr.baseline,
      target: kr.target,
      current: kr.current,
      direction: kr.direction,
    })),
  };
}

/** The period, which must exist and not be archived (read in the write's transaction). */
async function readWritablePeriod(db: Database, tx: Transaction, periodId: string) {
  const snapshot = await tx.get(db.collection("periods").doc(safeId.parse(periodId)));
  const period = snapshot.data() as Pick<Period, "status" | "deletedAt"> | undefined;
  assertOkrWritable(period ? { status: period.status, deletedAt: toDate(period.deletedAt) } : null);
}

/** `orgUnitPath` of a live unit of the period ([] for none); refuses a unit of another period. */
export async function readUnitPath(
  db: Database,
  tx: Transaction,
  orgUnitId: string | null,
  periodId: string,
): Promise<string[]> {
  if (orgUnitId === null) return [];
  const snapshot = await tx.get(db.collection("orgUnits").doc(safeId.parse(orgUnitId)));
  const unit = snapshot.data() as Omit<OrgUnit, "id"> | undefined;
  if (!unit || unit.deletedAt || unit.periodId !== periodId) {
    throw new RuleViolationError("Choose a unit of this board period.");
  }
  return orgUnitPath({ id: snapshot.id, path: unit.path });
}

/**
 * `objectives/{id}` (E1) with their key results inside (at most 20, so one document). Every write
 * is ONE transaction that reads the period and refuses an archived one, then writes the
 * objective and its audit entry. Deleted softly.
 */
export function createSqlObjectiveStore(db: Database) {
  const store = createSluggedStore<Objective>(db, {
    collection: "objectives",
    slug: null,
    fromDoc: toObjective,
    snapshot: objectiveSnapshot,
    fixed: (o) => ({
      periodId: o.periodId,
      orgUnitPath: o.orgUnitPath,
      keyResults: o.keyResults,
    }),
  });
  return {
    get: store.get,

    /** The live objectives of a period, in order. */
    async listForPeriod(periodId: string): Promise<Objective[]> {
      const snapshot = await store.docs
        .where("periodId", "==", periodId)
        .where("deletedAt", "==", null)
        .get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
    },

    create(periodId: string, input: ObjectiveInput, audit: ObjectiveAudit, now: Date) {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          await readWritablePeriod(db, tx, periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, periodId);
          return { ...input, periodId, orgUnitPath: path, keyResults: [], deletedAt: null };
        },
        audit,
        now,
      );
    },

    /** Edits the fields (the period stays); moving to another unit re-reads its path. */
    update(id: string, version: number, input: ObjectiveInput, audit: ObjectiveAudit, now: Date) {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const objective = current as Objective;
          await readWritablePeriod(db, tx, objective.periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, objective.periodId);
          return { ...objective, ...input, orgUnitPath: path };
        },
        audit,
        now,
      );
    },

    /** A change decided by a pure domain function (key results, delete). */
    change(
      id: string,
      version: number,
      step: (objective: Objective) => Objective,
      audit: ObjectiveAudit,
      now: Date,
    ) {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const objective = current as Objective;
          await readWritablePeriod(db, tx, objective.periodId);
          return step(objective);
        },
        audit,
        now,
      );
    },
  };
}

export type SqlObjectiveStore = ReturnType<typeof createSqlObjectiveStore>;

/* ---- Work programmes (E2) and weekly check-ins (E3) ---- */

export type ProgramFields = Omit<Program, Meta>;
export type ProgramAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Program | null,
  next: Program,
) => AuditEvent;
/** Audit of a check-in (`before` null for the week's first one). */
export type CheckinAudit = (
  before: Snapshot | null,
  after: Snapshot,
  program: Program,
  checkin: Checkin,
) => AuditEvent;

const toMilestone = (m: Record<string, unknown>): Milestone => ({
  ...(m as unknown as Milestone),
  completedAt: toDate(m["completedAt"]),
});

export const toProgram = (id: string, data: Record<string, unknown>): Program => {
  const health = data["health"] as (Omit<Health, "at"> & { at: unknown }) | null;
  return {
    id,
    periodId: data["periodId"] as string,
    orgUnitId: data["orgUnitId"] as string,
    orgUnitPath: data["orgUnitPath"] as string[],
    objectiveId: data["objectiveId"] as string | null,
    keyResultId: data["keyResultId"] as string | null,
    name: data["name"] as string,
    goal: data["goal"] as string,
    description: data["description"] as string,
    plannedStart: data["plannedStart"] as string | null,
    plannedEnd: data["plannedEnd"] as string | null,
    budgets: data["budgets"] as Program["budgets"],
    pics: data["pics"] as string[],
    status: data["status"] as ProgramStatus,
    progressPercent: data["progressPercent"] as number,
    milestones: (data["milestones"] as Array<Record<string, unknown>>).map(toMilestone),
    health: health ? { ...health, at: toDate(health.at) as Date } : null,
    reviewNote: data["reviewNote"] as string | null,
    approvedBy: data["approvedBy"] as string | null,
    approvedAt: toDate(data["approvedAt"]),
    startedAt: toDate(data["startedAt"]),
    finishedAt: toDate(data["finishedAt"]),
    cancelledAt: toDate(data["cancelledAt"]),
    cancelReason: data["cancelReason"] as string | null,
    createdBy: data["createdBy"] as string,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
};

/** Audit snapshot: the plan and the state (milestones as title, weight and done). */
export function programSnapshot(p: ProgramFields): Snapshot {
  return {
    orgUnitId: p.orgUnitId,
    keyResultId: p.keyResultId,
    name: p.name,
    goal: p.goal,
    description: p.description,
    plannedStart: p.plannedStart,
    plannedEnd: p.plannedEnd,
    budgets: p.budgets.map((b) => `${b.currency} ${b.amountMinor}`),
    pics: [...p.pics],
    status: p.status,
    progressPercent: p.progressPercent,
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      weight: m.weight,
      done: m.completedAt !== null,
    })),
    health: p.health && `${p.health.status}: ${p.health.reason}`,
    reviewNote: p.reviewNote,
    cancelReason: p.cancelReason,
  };
}

/** Everything stored besides the snapshot (the snapshot has lossy forms of some fields). */
const stored = (p: Program) => ({
  periodId: p.periodId,
  orgUnitPath: p.orgUnitPath,
  objectiveId: p.objectiveId,
  budgets: p.budgets,
  pics: p.pics,
  milestones: p.milestones,
  health: p.health,
  approvedBy: p.approvedBy,
  approvedAt: p.approvedAt,
  startedAt: p.startedAt,
  finishedAt: p.finishedAt,
  cancelledAt: p.cancelledAt,
  createdBy: p.createdBy,
});

/** The key result must be one of an objective of the same period (or none). */
async function checkKeyResult(
  db: Database,
  tx: Transaction,
  input: Pick<ProgramInput, "objectiveId" | "keyResultId">,
  periodId: string,
) {
  if (input.objectiveId === null) return;
  const snapshot = await tx.get(db.collection("objectives").doc(safeId.parse(input.objectiveId)));
  const objective = snapshot.data() as
    { periodId: string; deletedAt: unknown; keyResults: Array<{ id: string }> } | undefined;
  if (
    !objective ||
    objective.deletedAt ||
    objective.periodId !== periodId ||
    !objective.keyResults.some((kr) => kr.id === input.keyResultId)
  ) {
    throw new RuleViolationError("Choose a key result of this period.");
  }
}

const toCheckin = (id: string, data: Record<string, unknown>): Checkin => ({
  id,
  programId: data["programId"] as string,
  periodId: data["periodId"] as string,
  weekStart: data["weekStart"] as string,
  userId: data["userId"] as string,
  achievements: data["achievements"] as string,
  blockers: data["blockers"] as string,
  nextPlan: data["nextPlan"] as string,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
});

const checkinSnapshot = (c: CheckinInput): Snapshot => ({
  achievements: c.achievements,
  blockers: c.blockers,
  nextPlan: c.nextPlan,
});

/**
 * `programs/{id}` (E2): plan writes and workflow steps through the versioned-document
 * transaction (read, version check, rule, write + audit). Milestones live in the programme, so a
 * milestone change and the recomputed `progressPercent` are one write. Check-ins
 * (`programCheckins/{programId}_{weekStartUtc}`) are one per programme per UTC week: sending
 * again updates that week's report.
 */
export function createSqlProgramStore(db: Database) {
  const store = createSluggedStore<Program>(db, {
    collection: "programs",
    slug: null,
    fromDoc: toProgram,
    snapshot: programSnapshot,
    fixed: stored,
  });
  const checkins = db.collection("programCheckins");
  const audit = createSqlAuditWriter(db);
  return {
    get: store.get,

    /** Every live programme of a period, newest first (a period has a few hundred at most). */
    async listForPeriod(periodId: string): Promise<Program[]> {
      const snapshot = await store.docs
        .where("periodId", "==", periodId)
        .where("deletedAt", "==", null)
        .orderBy("createdAt", "desc")
        .get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },

    /** A proposal of a unit, in a period that is not archived. */
    create(
      periodId: string,
      input: ProgramInput,
      pics: readonly string[],
      createdBy: string,
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          await readWritablePeriod(db, tx, periodId);
          const path = await readUnitPath(db, tx, input.orgUnitId, periodId);
          await checkKeyResult(db, tx, input, periodId);
          return {
            ...input,
            periodId,
            orgUnitPath: path,
            pics: [...pics],
            status: "proposed",
            progressPercent: 0,
            milestones: [],
            health: null,
            reviewNote: null,
            approvedBy: null,
            approvedAt: null,
            startedAt: null,
            finishedAt: null,
            cancelledAt: null,
            cancelReason: null,
            createdBy,
            deletedAt: null,
          };
        },
        auditFor,
        now,
      );
    },

    /** Plan edits (until it is finished or cancelled); the status stays. */
    update(
      id: string,
      version: number,
      input: ProgramInput,
      pics: readonly string[],
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const program = current as Program;
          assertPlanEditable(program);
          const path = await readUnitPath(db, tx, input.orgUnitId, program.periodId);
          await checkKeyResult(db, tx, input, program.periodId);
          return { ...program, ...input, orgUnitPath: path, pics: [...pics] };
        },
        auditFor,
        now,
      );
    },

    /** A step decided by a pure domain function (status, health, milestones). */
    transition(
      id: string,
      version: number,
      step: (program: Program) => Program,
      auditFor: ProgramAudit,
      now: Date,
    ): Promise<Program> {
      return store.write(id, version, (current) => step(current as Program), auditFor, now);
    },

    /** This week's check-in (created, or updated when the week already has one). */
    checkIn(
      programId: string,
      weekStart: string,
      input: CheckinInput,
      userId: string,
      auditFor: CheckinAudit,
      now: Date,
    ): Promise<Checkin> {
      const programRef = store.docs.doc(safeId.parse(programId));
      const ref = checkins.doc(checkinId(programRef.id, weekStart));
      return db.runTransaction(async (tx) => {
        const [programDoc, existing] = await Promise.all([tx.get(programRef), tx.get(ref)]);
        if (!programDoc.exists) throw new RuleViolationError("This item does not exist.");
        const program = store.read(programRef.id, programDoc.data());
        assertCanCheckIn(program);
        const previous = existing.exists
          ? toCheckin(ref.id, existing.data() as Record<string, unknown>)
          : null;
        const checkin: Checkin = {
          ...input,
          id: ref.id,
          programId: program.id,
          periodId: program.periodId,
          weekStart,
          userId,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, {
          programId: checkin.programId,
          periodId: checkin.periodId,
          weekStart,
          userId,
          ...checkinSnapshot(checkin),
          createdAt: checkin.createdAt,
          updatedAt: now,
        });
        log.append(
          auditFor(
            previous && checkinSnapshot(previous),
            checkinSnapshot(checkin),
            program,
            checkin,
          ),
        );
        return checkin;
      });
    },

    /** A programme's check-ins, newest week first. */
    async listCheckins(programId: string): Promise<Checkin[]> {
      const snapshot = await checkins.where("programId", "==", programId).get();
      return snapshot.docs
        .map((doc) => toCheckin(doc.id, doc.data()))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    },
  };
}

export type SqlProgramStore = ReturnType<typeof createSqlProgramStore>;
