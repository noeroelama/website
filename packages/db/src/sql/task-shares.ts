import { boardShareId } from "@website/domain/tasks";
import { safeId } from "@website/security/validation";
import type { AuditEvent } from "@website/audit";
import { createSqlAuditWriter } from "./audit";
import type { Database } from "./store";

/**
 * `taskBoardShares/{orgUnitId}_{uid}` (G1): a unit board shared with one person, VIEW ONLY. A
 * share grants no permission: source links still need the viewer's own access.
 */
export function createSqlTaskShareStore(db: Database) {
  const docs = db.collection("taskBoardShares");
  const audit = createSqlAuditWriter(db);
  return {
    async has(orgUnitId: string, uid: string): Promise<boolean> {
      if (!safeId.safeParse(orgUnitId).success || !safeId.safeParse(uid).success) return false;
      return (await docs.doc(boardShareId(orgUnitId, uid)).get()).exists;
    },
    async listForUnit(orgUnitId: string): Promise<string[]> {
      const snapshot = await docs.where("orgUnitId", "==", orgUnitId).get();
      return snapshot.docs.map((d) => d.get("uid") as string);
    },
    async listForUser(uid: string): Promise<string[]> {
      const snapshot = await docs.where("uid", "==", uid).get();
      return snapshot.docs.map((d) => d.get("orgUnitId") as string);
    },
    /** Shares or unshares, with its audit entry in the same transaction. */
    async set(
      orgUnitId: string,
      uid: string,
      shared: boolean,
      by: string,
      now: Date,
      auditEvent: AuditEvent,
    ): Promise<void> {
      const ref = docs.doc(boardShareId(safeId.parse(orgUnitId), safeId.parse(uid)));
      await db.runTransaction(async (tx) => {
        const log = await audit.begin(tx);
        if (shared) tx.set(ref, { orgUnitId, uid, by, at: now });
        else tx.delete(ref);
        log.append(auditEvent);
      });
    },
  };
}

export type SqlTaskShareStore = ReturnType<typeof createSqlTaskShareStore>;
