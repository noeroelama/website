import type { Firestore } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import { canActivatePeriod, type Period, type PeriodStatus } from "@website/domain/organizations";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { createSluggedStore, toDate } from "./slugged";

export type PeriodFields = Omit<Period, "id" | "version" | "createdAt" | "updatedAt">;

function toPeriod(id: string, data: Record<string, unknown>): Period {
  return {
    id,
    name: data["name"] as string,
    cabinet: data["cabinet"] as string,
    startsOn: data["startsOn"] as string,
    endsOn: data["endsOn"] as string,
    vision: data["vision"] as string,
    mission: data["mission"] as string,
    lpjDeadlineDays: data["lpjDeadlineDays"] as number,
    status: data["status"] as PeriodStatus,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function periodSnapshot(p: PeriodFields): Snapshot {
  return {
    name: p.name,
    cabinet: p.cabinet,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    vision: p.vision,
    mission: p.mission,
    lpjDeadlineDays: p.lpjDeadlineDays,
    status: p.status,
  };
}

/** Audit entry for one status change of one period (same arguments as `write`'s audit). */
export type PeriodStatusAudit = (
  before: Snapshot,
  after: Snapshot,
  current: Period,
  next: Period,
) => AuditEvent;

/**
 * `periods/{id}` (never deleted) and `settings/activePeriod` ({ periodId }), which the principal
 * loader reads to decide which period-bound role assignments count.
 */
export function createFirestorePeriodStore(db: Firestore) {
  const store = createSluggedStore<Period>(db, {
    collection: "periods",
    slug: null,
    fromDoc: toPeriod,
    snapshot: periodSnapshot,
    fixed: () => ({}),
  });
  const activeRef = db.collection("settings").doc("activePeriod");
  const auditLog = createFirestoreAuditWriter(db);

  return {
    /** Every period, newest first. */
    async listForAdmin(): Promise<Period[]> {
      const snapshot = await store.docs.orderBy("startsOn", "desc").get();
      return snapshot.docs.map((doc) => store.read(doc.id, doc.data()));
    },
    get: store.get,
    write: store.write,

    /**
     * ONE transaction: the draft becomes active, the period that was active becomes archived,
     * `settings/activePeriod` points to the new one, and both changes are audited. Concurrent
     * activations are serialized by the transaction on `settings/activePeriod`.
     */
    activate(id: string, expectedVersion: number, audit: PeriodStatusAudit, now: Date) {
      const ref = store.docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const [snapshot, active] = await Promise.all([tx.get(ref), tx.get(activeRef)]);
        if (!snapshot.exists) throw new RuleViolationError("This item does not exist.");
        const current = store.read(id, snapshot.data());
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("periods version changed");
        }
        if (!canActivatePeriod(current.status)) {
          throw new RuleViolationError("Only a draft period can be activated.");
        }
        const previousId = active.get("periodId") as string | undefined;
        const previousSnapshot = previousId ? await tx.get(store.docs.doc(previousId)) : null;
        const previous = previousSnapshot?.exists
          ? store.read(previousSnapshot.id, previousSnapshot.data())
          : null;
        const log = await auditLog.begin(tx);

        const change = (period: Period, status: PeriodStatus): Period => {
          const next = { ...period, status, version: period.version + 1, updatedAt: now };
          tx.update(store.docs.doc(period.id), { status, version: next.version, updatedAt: now });
          log.append(audit(periodSnapshot(period), periodSnapshot(next), period, next));
          return next;
        };
        const next = change(current, "active");
        if (previous) change(previous, "archived");
        tx.set(activeRef, { periodId: next.id, updatedAt: now });
        return next;
      });
    },
  };
}

export type FirestorePeriodStore = ReturnType<typeof createFirestorePeriodStore>;
