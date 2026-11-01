import { randomUUID } from "node:crypto";
import type { Database } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  agendaNumber,
  type Disposition,
  type IncomingInput,
  type IncomingLetter,
  type IncomingStatus,
  type ScanFile,
} from "@website/domain/documents";
import { RuleViolationError } from "@website/domain/shared";
import { createSqlAuditWriter } from "./audit";
import { nextNumbers } from "./counters";
import { createSluggedStore, toDate } from "./slugged";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type IncomingFields = Omit<IncomingLetter, Meta>;

function toIncoming(id: string, data: Record<string, unknown>): IncomingLetter {
  return {
    id,
    periodId: data["periodId"] as string,
    agendaNumber: data["agendaNumber"] as string,
    sender: data["sender"] as string,
    originNumber: data["originNumber"] as string,
    subject: data["subject"] as string,
    letterDate: data["letterDate"] as string | null,
    receivedDate: data["receivedDate"] as string,
    summary: data["summary"] as string,
    status: data["status"] as IncomingStatus,
    scan: data["scan"] as ScanFile | null,
    recordedBy: data["recordedBy"] as string,
    dispositions: (data["dispositions"] as Array<Record<string, unknown>>).map((d) => ({
      ...(d as unknown as Disposition),
      createdAt: toDate(d["createdAt"]) as Date,
      completedAt: toDate(d["completedAt"]),
    })),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

/** Audit snapshot: the record and each disposition's target and state (not the scan bytes). */
export function incomingSnapshot(l: IncomingFields): Snapshot {
  return {
    agendaNumber: l.agendaNumber,
    sender: l.sender,
    originNumber: l.originNumber,
    subject: l.subject,
    letterDate: l.letterDate,
    receivedDate: l.receivedDate,
    summary: l.summary,
    status: l.status,
    scan: l.scan?.name ?? null,
    dispositions: l.dispositions.map(
      (d) =>
        `${d.id}:${d.toOrgUnitId ?? d.toUserId}:${d.status}${d.parentId ? `<${d.parentId}` : ""}`,
    ),
  };
}

const stored = (l: IncomingFields) => ({
  periodId: l.periodId,
  agendaNumber: l.agendaNumber,
  sender: l.sender,
  originNumber: l.originNumber,
  subject: l.subject,
  letterDate: l.letterDate,
  receivedDate: l.receivedDate,
  summary: l.summary,
  status: l.status,
  scan: l.scan,
  recordedBy: l.recordedBy,
  dispositions: l.dispositions,
});

export type IncomingAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: IncomingLetter | null,
  next: IncomingLetter,
) => AuditEvent;

/**
 * `incomingLetters/{id}` (D6) with the agenda counter `incomingCounters/{periodId}`: recording
 * takes the next agenda number in the same transaction; every later change (fields, scan,
 * dispositions, archive) is one versioned write with its audit entry.
 */
export function createSqlIncomingStore(db: Database) {
  const store = createSluggedStore<IncomingLetter>(db, {
    collection: "incomingLetters",
    slug: null,
    fromDoc: toIncoming,
    snapshot: incomingSnapshot,
    fixed: stored,
  });
  const audit = createSqlAuditWriter(db);

  const change = (
    id: string,
    version: number,
    step: (letter: IncomingLetter) => IncomingLetter,
    auditFor: IncomingAudit,
    now: Date,
  ) => store.write(id, version, (current) => step(current as IncomingLetter), auditFor, now);

  return {
    get: store.get,

    /** The period's agenda book, newest first. */
    async list(periodId: string, limit: number): Promise<IncomingLetter[]> {
      const snapshot = await store.docs
        .where("periodId", "==", periodId)
        .where("deletedAt", "==", null)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs.map((d) => store.read(d.id, d.data()));
    },

    /** Records a letter received in the active period with the next agenda number. */
    record(input: IncomingInput, recordedBy: string, auditFor: IncomingAudit, now: Date) {
      const ref = store.docs.doc(randomUUID());
      return db.runTransaction(async (tx) => {
        const active = await tx.get(db.collection("settings").doc("activePeriod"));
        const periodId = active.get("periodId") as string | undefined;
        if (!periodId) throw new RuleViolationError("Activate a board period first.");
        const log = await audit.begin(tx);
        const { first } = await nextNumbers(
          db,
          tx,
          { collection: "incomingCounters", id: periodId },
          1,
        );
        const letter: IncomingLetter = {
          ...input,
          id: ref.id,
          periodId,
          agendaNumber: agendaNumber(first, input.receivedDate),
          status: "new",
          scan: null,
          recordedBy,
          dispositions: [],
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        tx.set(ref, {
          ...stored(letter),
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        log.append(auditFor(null, incomingSnapshot(letter), null, letter));
        return letter;
      });
    },

    /** Edits the recorded fields (not the agenda number); archived letters are read-only. */
    update(id: string, version: number, input: IncomingInput, auditFor: IncomingAudit, now: Date) {
      return change(
        id,
        version,
        (letter) => {
          if (letter.status === "archived")
            throw new RuleViolationError("This letter is archived.");
          return { ...letter, ...input };
        },
        auditFor,
        now,
      );
    },

    /** A disposition step or archiving, decided by a domain function. */
    change,
  };
}

export type SqlIncomingStore = ReturnType<typeof createSqlIncomingStore>;
