import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { canonicalJson, type AuditAppender, type AuditEvent } from "@website/audit";
import { safeId } from "@website/security/validation";

/**
 * Append-only audit log: `auditLogs/{id}` entries and the chain head `auditChain/head`
 * ({ hash, seq }). Each entry stores `seq`, `prevHash` and
 * `hash = sha256(prevHash + canonicalJson(event))`, so a changed or missing entry breaks the
 * chain. There is deliberately no update or delete code path for `auditLogs` (tested).
 */
export function createFirestoreAuditWriter(db: Firestore) {
  const logs = db.collection("auditLogs");
  const head = db.collection("auditChain").doc("head");

  /**
   * Binds the writer to the caller's transaction. Call it after the transaction's own reads
   * and before its writes (it reads the chain head); `append` only queues writes, which commit
   * — or roll back — with the record change.
   */
  async function begin(tx: Transaction): Promise<AuditAppender> {
    const snapshot = await tx.get(head);
    const stored = snapshot.exists ? (snapshot.data() as { hash: string; seq: number }) : null;
    let prevHash = stored?.hash ?? null;
    let seq = stored?.seq ?? 0;
    return {
      append(event) {
        const hash = createHash("sha256")
          .update(`${prevHash ?? ""}${canonicalJson({ ...event, prevHash: null, hash: null })}`)
          .digest("hex");
        seq += 1;
        const entry = Object.fromEntries(
          Object.entries({ ...event, prevHash, hash, seq }).filter(([, v]) => v !== undefined),
        );
        tx.create(logs.doc(safeId.parse(event.id)), entry);
        tx.set(head, { hash, seq });
        prevHash = hash;
      },
    };
  }

  return {
    begin,
    /** An entry without a record change (e.g. an upload), in its own transaction. */
    appendAlone(event: AuditEvent): Promise<void> {
      return db.runTransaction(async (tx) => (await begin(tx)).append(event));
    },
  };
}

export type FirestoreAuditWriter = ReturnType<typeof createFirestoreAuditWriter>;
