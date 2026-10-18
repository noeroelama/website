import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  assertNoCycle,
  inTreeOrder,
  movedPath,
  ORG_UNIT_MOVE_LIMIT,
  placeOrgUnit,
  type OrgUnit,
  type OrgUnitInput,
  type OrgUnitType,
  type PeriodStatus,
} from "@website/domain/organizations";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";

export type OrgUnitFields = Omit<OrgUnit, "id" | "version" | "createdAt" | "updatedAt">;

function toOrgUnit(id: string, data: Record<string, unknown>): OrgUnit {
  return {
    id,
    periodId: data["periodId"] as string,
    parentId: data["parentId"] as string | null,
    path: data["path"] as string[],
    name: data["name"] as string,
    code: data["code"] as string,
    type: data["type"] as OrgUnitType,
    description: data["description"] as string,
    sort: data["sort"] as number,
    active: data["active"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function orgUnitSnapshot(u: OrgUnitFields): Snapshot {
  return {
    periodId: u.periodId,
    parentId: u.parentId,
    path: [...u.path],
    name: u.name,
    code: u.code,
    type: u.type,
    description: u.description,
    sort: u.sort,
    active: u.active,
  };
}

/** Same arguments as the audit callback of the other stores (`before` is null on create). */
export type OrgUnitAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: OrgUnit | null,
  next: OrgUnit,
) => AuditEvent;

/**
 * `orgUnits/{id}` with the code index `orgUnitCodes/{periodId}_{code}` (unique per period).
 * Every write reads the period and the parent in the same transaction, so a unit is never placed
 * under a parent that moved meanwhile or in a period that was archived meanwhile.
 */
export function createFirestoreOrgUnitStore(db: Firestore) {
  const store = createSluggedStore<OrgUnit>(db, {
    collection: "orgUnits",
    slug: {
      collection: "orgUnitCodes",
      key: (u) => `${u.periodId}_${u.code}`,
      taken: "This code is already used by another unit of this period.",
    },
    fromDoc: toOrgUnit,
    snapshot: orgUnitSnapshot,
    fixed: () => ({}),
  });
  const periods = db.collection("periods");
  const auditLog = createFirestoreAuditWriter(db);

  const periodIn = async (tx: Transaction, id: string) => {
    const snapshot = await tx.get(periods.doc(safeId.parse(id)));
    return snapshot.exists ? { status: snapshot.get("status") as PeriodStatus } : null;
  };
  const unitIn = async (tx: Transaction, id: string | null) => {
    if (id === null) return null;
    const snapshot = await tx.get(store.docs.doc(safeId.parse(id)));
    return snapshot.exists ? store.read(id, snapshot.data()) : null;
  };

  return {
    get: store.get,

    /** Every unit of one period, in tree order. */
    async listForPeriod(periodId: string): Promise<OrgUnit[]> {
      const snapshot = await store.docs.where("periodId", "==", safeId.parse(periodId)).get();
      return inTreeOrder(
        snapshot.docs.map((doc) => store.read(doc.id, doc.data())).filter((u) => !u.deletedAt),
      );
    },

    /** Every unit below this one (one `array-contains` query on `path`). */
    async descendants(id: string): Promise<OrgUnit[]> {
      const snapshot = await store.docs.where("path", "array-contains", safeId.parse(id)).get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },

    /** Create or edit. The period and parent never change here (that is `move`). */
    save(
      id: string | null,
      expectedVersion: number | null,
      input: OrgUnitInput,
      audit: OrgUnitAudit,
      now: Date,
    ): Promise<OrgUnit> {
      return store.write(
        id,
        expectedVersion,
        async (current, tx) => {
          if (
            current &&
            (current.periodId !== input.periodId || current.parentId !== input.parentId)
          ) {
            throw new RuleViolationError("Use Move to put the unit under another unit.");
          }
          const [period, parent] = await Promise.all([
            periodIn(tx, input.periodId),
            unitIn(tx, input.parentId),
          ]);
          const path = placeOrgUnit(input.periodId, period, input.parentId, parent);
          return { ...input, path, deletedAt: null };
        },
        audit,
        now,
      );
    },

    /**
     * Puts the unit under another parent (or at the top level) and rewrites the paths of the
     * whole subtree in ONE transaction. A move inside its own subtree is refused.
     */
    move(
      id: string,
      expectedVersion: number,
      parentId: string | null,
      audit: OrgUnitAudit,
      now: Date,
    ): Promise<OrgUnit> {
      const ref = store.docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const current = await unitIn(tx, id);
        if (!current || current.deletedAt)
          throw new RuleViolationError("This item does not exist.");
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("orgUnits version changed");
        }
        const [period, parent, subtree] = await Promise.all([
          periodIn(tx, current.periodId),
          unitIn(tx, parentId),
          tx.get(store.docs.where("path", "array-contains", id)),
        ]);
        assertNoCycle(id, parent);
        const path = placeOrgUnit(current.periodId, period, parentId, parent);
        if (subtree.size + 1 > ORG_UNIT_MOVE_LIMIT) {
          throw new RuleViolationError(`At most ${ORG_UNIT_MOVE_LIMIT} units can move at once.`);
        }
        const next: OrgUnit = {
          ...current,
          parentId,
          path,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await auditLog.begin(tx);
        tx.update(ref, { parentId, path, version: next.version, updatedAt: now });
        for (const doc of subtree.docs) {
          const below = store.read(doc.id, doc.data());
          tx.update(store.docs.doc(doc.id), {
            path: movedPath(below.path, id, path),
            updatedAt: now,
          });
        }
        log.append(audit(orgUnitSnapshot(current), orgUnitSnapshot(next), current, next));
        return next;
      });
    },
  };
}

export type FirestoreOrgUnitStore = ReturnType<typeof createFirestoreOrgUnitStore>;
