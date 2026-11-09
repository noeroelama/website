import { createHash } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  END_REMINDER_MS,
  START_REMINDER_MS,
  type AgendaItem,
  type Attendance,
  type ActionItem,
  type Meeting,
  type Minutes,
} from "@website/domain/meetings";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSluggedStore, toDate } from "./slugged";
import type { Database, Transaction } from "./store";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type MeetingFields = Omit<Meeting, Meta>;

export type MeetingAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Meeting | null,
  next: Meeting,
) => AuditEvent;

const toMinutes = (value: unknown): Minutes | null => {
  if (!value) return null;
  const m = value as Record<string, unknown>;
  return {
    ...(m as unknown as Minutes),
    approvedAt: toDate(m["approvedAt"]),
    approvedBy: (m["approvedBy"] as string | null) ?? null,
  };
};

const toMeeting = (id: string, data: Record<string, unknown>): Meeting => ({
  id,
  periodId: data["periodId"] as string,
  title: data["title"] as string,
  description: data["description"] as string,
  orgUnitId: data["orgUnitId"] as string | null,
  orgUnitPath: data["orgUnitPath"] as string[],
  startsAt: toDate(data["startsAt"]) as Date,
  endsAt: toDate(data["endsAt"]) as Date,
  timeZone: data["timeZone"] as string,
  agenda: data["agenda"] as AgendaItem[],
  participants: data["participants"] as Meeting["participants"],
  participantIds: data["participantIds"] as string[],
  room: data["room"] as Meeting["room"],
  attendance: Object.fromEntries(
    Object.entries(data["attendance"] as Record<string, Record<string, unknown>>).map(
      ([uid, a]) => [
        uid,
        { at: toDate(a["at"]) as Date, method: a["method"] as Attendance["method"] },
      ],
    ),
  ),
  cancelledAt: toDate(data["cancelledAt"]),
  cancelReason: (data["cancelReason"] as string | null) ?? null,
  createdBy: data["createdBy"] as string,
  minutes: toMinutes(data["minutes"]),
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

export function meetingSnapshot(m: MeetingFields): Snapshot {
  return {
    title: m.title,
    description: m.description,
    orgUnitId: m.orgUnitId,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    timeZone: m.timeZone,
    agenda: m.agenda.map((a) => ({ id: a.id, title: a.title })),
    participants: m.participants.map((p) => ({ uid: p.uid, role: p.role })),
    room: { zoomRequestId: m.room.zoomRequestId, externalUrl: m.room.externalUrl },
    cancelReason: m.cancelReason,
  };
}

const codeHash = (code: string) => createHash("sha256").update(`attend:${code}`).digest("hex");

export function createSqlMeetingStore(db: Database) {
  const store = createSluggedStore<Meeting>(db, {
    collection: "meetings",
    slug: null,
    fromDoc: toMeeting,
    snapshot: meetingSnapshot,
    fixed: (m) => ({
      ...meetingSnapshot(m),
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      periodId: m.periodId,
      orgUnitPath: m.orgUnitPath,
      participantIds: m.participantIds,
      attendance: m.attendance,
      cancelledAt: m.cancelledAt,
      createdBy: m.createdBy,
      minutes: m.minutes,
    }),
  });
  const codes = db.collection("attendanceCodes");
  const live = (docs: Array<{ id: string; data(): unknown }>) =>
    docs.map((doc) => store.read(doc.id, doc.data())).filter((m) => m.deletedAt === null);
  const byStart = (a: Meeting, b: Meeting) => a.startsAt.getTime() - b.startsAt.getTime();

  return {
    get: store.get,

    async listForPeriod(periodId: string): Promise<Meeting[]> {
      const snapshot = await store.docs.where("periodId", "==", periodId).get();
      return live(snapshot.docs).sort(byStart);
    },

    async listForUser(uid: string): Promise<Meeting[]> {
      const snapshot = await store.docs.where("participantIds", "array-contains", uid).get();
      return live(snapshot.docs).sort((a, b) => byStart(b, a));
    },

    async listBetween(from: Date, to: Date): Promise<Meeting[]> {
      const snapshot = await store.docs
        .where("startsAt", ">=", from)
        .where("startsAt", "<=", to)
        .get();
      return live(snapshot.docs).sort(byStart);
    },

    async dueForReminders(now: Date): Promise<Meeting[]> {
      const [starting, ending] = await Promise.all([
        store.docs
          .where("startsAt", ">=", now)
          .where("startsAt", "<=", new Date(now.getTime() + START_REMINDER_MS))
          .get(),
        store.docs
          .where("endsAt", ">=", new Date(now.getTime() - END_REMINDER_MS))
          .where("endsAt", "<=", now)
          .get(),
      ]);
      const found = new Map(live([...starting.docs, ...ending.docs]).map((m) => [m.id, m]));
      return [...found.values()];
    },

    write(
      id: string | null,
      version: number | null,
      build: (current: Meeting | null, tx: Transaction) => MeetingFields | Promise<MeetingFields>,
      audit: MeetingAudit,
      now: Date,
    ) {
      return store.write(id, version, build, audit, now);
    },

    async saveCode(code: string, meetingId: string, expiresAt: Date): Promise<void> {
      await codes.doc(codeHash(code)).set({ meetingId, expiresAt });
    },

    async findCode(code: string, now: Date): Promise<string | null> {
      const snapshot = await codes.doc(codeHash(code)).get();
      const expiresAt = toDate(snapshot.get("expiresAt"));
      if (!snapshot.exists || !expiresAt || expiresAt.getTime() < now.getTime()) return null;
      return snapshot.get("meetingId") as string;
    },

    async attend(meetingId: string, step: (m: Meeting) => Meeting, now: Date): Promise<Meeting> {
      const ref = store.docs.doc(safeId.parse(meetingId));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This meeting does not exist.");
        const current = store.read(ref.id, snapshot.data());
        if (current.deletedAt) throw new RuleViolationError("This meeting does not exist.");
        const next = step(current);
        if (next === current) return current;
        tx.update(ref, { attendance: next.attendance, updatedAt: now });
        return { ...next, version: current.version, updatedAt: now };
      });
    },
  };
}

export type SqlMeetingStore = ReturnType<typeof createSqlMeetingStore>;

export type ActionItemAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: ActionItem | null,
  next: ActionItem,
) => AuditEvent;

const toActionItem = (id: string, data: Record<string, unknown>): ActionItem => ({
  id,
  meetingId: data["meetingId"] as string,
  meetingTitle: data["meetingTitle"] as string,
  periodId: data["periodId"] as string,
  orgUnitPath: data["orgUnitPath"] as string[],
  title: data["title"] as string,
  pic: data["pic"] as string,
  dueOn: data["dueOn"] as string | null,
  doneAt: toDate(data["doneAt"]),
  createdBy: data["createdBy"] as string,
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

export function createSqlActionItemStore(db: Database) {
  const store = createSluggedStore<ActionItem>(db, {
    collection: "actionItems",
    slug: null,
    fromDoc: toActionItem,
    snapshot: (a) => ({
      title: a.title,
      pic: a.pic,
      dueOn: a.dueOn,
      doneAt: a.doneAt?.toISOString() ?? null,
    }),
    fixed: (a) => ({
      meetingId: a.meetingId,
      meetingTitle: a.meetingTitle,
      periodId: a.periodId,
      orgUnitPath: a.orgUnitPath,
      createdBy: a.createdBy,
    }),
  });
  const live = (docs: Array<{ id: string; data(): unknown }>) =>
    docs.map((doc) => store.read(doc.id, doc.data())).filter((a) => a.deletedAt === null);
  return {
    get: store.get,
    async listForMeeting(meetingId: string): Promise<ActionItem[]> {
      const snapshot = await store.docs.where("meetingId", "==", meetingId).get();
      return live(snapshot.docs).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async listForPic(uid: string): Promise<ActionItem[]> {
      const snapshot = await store.docs.where("pic", "==", uid).get();
      return live(snapshot.docs);
    },
    async listForPeriod(periodId: string): Promise<ActionItem[]> {
      const snapshot = await store.docs.where("periodId", "==", periodId).get();
      return live(snapshot.docs);
    },
    write(
      id: string | null,
      version: number | null,
      build: (
        current: ActionItem | null,
        tx: Transaction,
      ) => Promise<Omit<ActionItem, "id" | "version" | "createdAt" | "updatedAt">>,
      audit: ActionItemAudit,
      now: Date,
    ) {
      return store.write(id, version, build, audit, now);
    },
    async readMeeting(tx: Transaction, meetingId: string): Promise<Meeting> {
      const snapshot = await tx.get(db.collection("meetings").doc(safeId.parse(meetingId)));
      const data = snapshot.data();
      if (!data || data["deletedAt"]) throw new RuleViolationError("This meeting does not exist.");
      return toMeeting(snapshot.id, data);
    },
  };
}

export type SqlActionItemStore = ReturnType<typeof createSqlActionItemStore>;
