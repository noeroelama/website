import { randomInt } from "node:crypto";
import type { Database, Transaction } from "./store";
import type { AuditEvent } from "@website/audit";
import {
  CERTIFICATE_CHUNK,
  certificateId,
  isEditable,
  makeVerificationCode,
  type Certificate,
  type Letter,
} from "@website/domain/documents";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { nextNumbers } from "./counters";
import { toCertificate, toLetter } from "./letters";

export type CertificateAudit = (
  batch: Letter,
  change: { readonly added: number } | { readonly removed: Pick<Certificate, "seq" | "name"> },
) => AuditEvent;

export function createSqlCertificateStore(db: Database, random: (n: number) => number = randomInt) {
  const sheets = db.collection("certificates");
  const codes = db.collection("verificationCodes");
  const audit = createSqlAuditWriter(db);

  async function editableBatch(tx: Transaction, batchId: string): Promise<Letter> {
    const snapshot = await tx.get(db.collection("letters").doc(safeId.parse(batchId)));
    const batch = snapshot.exists
      ? toLetter(snapshot.id, snapshot.data() as Record<string, unknown>)
      : null;
    if (!batch || batch.deletedAt || batch.source !== "certificate") {
      throw new RuleViolationError("This certificate batch does not exist.");
    }
    if (!isEditable(batch)) {
      throw new RuleViolationError("Participants change only before the secretariat passes it.");
    }
    return batch;
  }

  async function freeCodes(tx: Transaction, count: number): Promise<string[]> {
    const chosen = new Set<string>();
    for (let tries = 0; chosen.size < count; tries += 1) {
      if (tries >= 5) throw new Error("No free verification code.");
      const drawn = Array.from({ length: count - chosen.size }, () => makeVerificationCode(random));
      const taken = await Promise.all(drawn.map((code) => tx.get(codes.doc(code))));
      drawn.forEach((code, i) => {
        if (!taken[i]?.exists) chosen.add(code);
      });
    }
    return [...chosen];
  }

  return {
    async list(batchId: string): Promise<Certificate[]> {
      const snapshot = await sheets.where("batchId", "==", safeId.parse(batchId)).get();
      return snapshot.docs.map((d) => toCertificate(d.id, d.data())).sort((a, b) => a.seq - b.seq);
    },

    async get(id: string): Promise<Certificate | null> {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await sheets.doc(id).get();
      return snapshot.exists ? toCertificate(id, snapshot.data() as Record<string, unknown>) : null;
    },

    async add(
      batchId: string,
      participants: readonly Pick<Certificate, "name" | "note" | "emailHash">[],
      auditFor: CertificateAudit,
      now: Date,
    ): Promise<number> {
      if (participants.length === 0) {
        throw new RuleViolationError("No names could be read from that list.");
      }
      for (let start = 0; start < participants.length; start += CERTIFICATE_CHUNK) {
        const chunk = participants.slice(start, start + CERTIFICATE_CHUNK);
        await db.runTransaction(async (tx) => {
          const batch = await editableBatch(tx, batchId);
          const drawn = await freeCodes(tx, chunk.length);
          const log = await audit.begin(tx);
          const { first } = await nextNumbers(
            db,
            tx,
            { collection: "certificateCounters", id: batch.id },
            chunk.length,
          );
          chunk.forEach((person, i) => {
            const seq = first + i;
            const id = certificateId(batch.id, seq);
            const code = drawn[i] as string;
            tx.create(sheets.doc(id), {
              batchId: batch.id,
              periodId: batch.periodId,
              seq,
              name: person.name,
              note: person.note,
              verificationCode: code,
              emailHash: person.emailHash,
              createdAt: now,
            });
            tx.create(codes.doc(code), {
              kind: "certificate",
              letterId: batch.id,
              certificateId: id,
              periodId: batch.periodId,
            });
          });
          log.append(auditFor(batch, { added: chunk.length }));
        });
      }
      return participants.length;
    },

    remove(batchId: string, id: string, auditFor: CertificateAudit): Promise<void> {
      return db.runTransaction(async (tx) => {
        const batch = await editableBatch(tx, batchId);
        const snapshot = await tx.get(sheets.doc(safeId.parse(id)));
        if (!snapshot.exists || snapshot.get("batchId") !== batch.id) {
          throw new RuleViolationError("This participant does not exist.");
        }
        const sheet = toCertificate(id, snapshot.data() as Record<string, unknown>);
        const log = await audit.begin(tx);
        tx.delete(sheets.doc(id));
        tx.delete(codes.doc(sheet.verificationCode));
        log.append(auditFor(batch, { removed: { seq: sheet.seq, name: sheet.name } }));
      });
    },
  };
}

export type SqlCertificateStore = ReturnType<typeof createSqlCertificateStore>;
