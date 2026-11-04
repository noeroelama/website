import type { Database, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import { orgUnitPath, type OrgUnit, type Period } from "@website/domain/organizations";
import {
  assertOkrWritable,
  type KeyResult,
  type Objective,
  type ObjectiveInput,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
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
