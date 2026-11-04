import { createHash } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  END_REMINDER_MS,
  START_REMINDER_MS,
  type AgendaItem,
  type Attendance,
  type Meeting,
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
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

/** What staff edit (audited and revertible); attendance and room are kept as they are. */
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

/** sha256 of an attendance code: the stored document id (never the code itself). */
const codeHash = (code: string) => createHash("sha256").update(`attend:${code}`).digest("hex");

/**
 * `meetings/{id}` (F4) with participants and attendance inside (at most 300 people, so one
 * document). Attendance codes live in `attendanceCodes/{sha256(code)}` → { meetingId, expiresAt }
 * (only the hash is stored; the `expire` cron job removes old ones).
 */
export function createSqlMeetingStore(db: Database) {
  const store = createSluggedStore<Meeting>(db, {
    collection: "meetings",
    slug: null,
    fromDoc: toMeeting,
    snapshot: meetingSnapshot,
    fixed: (m) => ({
      ...meetingSnapshot(m),
      // Dates as dates (range queries), not as the snapshot's strings.
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      periodId: m.periodId,
      orgUnitPath: m.orgUnitPath,
      participantIds: m.participantIds,
      attendance: m.attendance,
      cancelledAt: m.cancelledAt,
      createdBy: m.createdBy,
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

    /** Meetings the person takes part in (any period), newest first. */
    async listForUser(uid: string): Promise<Meeting[]> {
      const snapshot = await store.docs.where("participantIds", "array-contains", uid).get();
      return live(snapshot.docs).sort((a, b) => byStart(b, a));
    },

    /** Meetings that start or end between `from` and `to` (calendar, agenda). */
    async listBetween(from: Date, to: Date): Promise<Meeting[]> {
      const snapshot = await store.docs
        .where("startsAt", ">=", from)
        .where("startsAt", "<=", to)
        .get();
      return live(snapshot.docs).sort(byStart);
    },

    /** Meetings that may need a start or end reminder now (bounded by the reminder windows). */
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

    /** A new or edited meeting; `build` may read other documents (unit, period) first. */
    write(
      id: string | null,
      version: number | null,
      build: (current: Meeting | null, tx: Transaction) => MeetingFields | Promise<MeetingFields>,
      audit: MeetingAudit,
      now: Date,
    ) {
      return store.write(id, version, build, audit, now);
    },

    /** Stores a code's hash for a meeting (the plain code is only shown on the screen). */
    async saveCode(code: string, meetingId: string, expiresAt: Date): Promise<void> {
      await codes.doc(codeHash(code)).set({ meetingId, expiresAt });
    },

    /** The meeting of an unexpired code (normalized), or null. */
    async findCode(code: string, now: Date): Promise<string | null> {
      const snapshot = await codes.doc(codeHash(code)).get();
      const expiresAt = toDate(snapshot.get("expiresAt"));
      if (!snapshot.exists || !expiresAt || expiresAt.getTime() < now.getTime()) return null;
      return snapshot.get("meetingId") as string;
    },

    /**
     * A participant's own attendance (web /attend): no staff audit entry, the attendance record
     * itself says who and when. `step` decides (markAttendance); version moves on.
     */
    async attend(meetingId: string, step: (m: Meeting) => Meeting, now: Date): Promise<Meeting> {
      const ref = store.docs.doc(safeId.parse(meetingId));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This meeting does not exist.");
        const current = store.read(ref.id, snapshot.data());
        if (current.deletedAt) throw new RuleViolationError("This meeting does not exist.");
        const next = step(current);
        if (next === current) return current;
        tx.update(ref, {
          attendance: next.attendance,
          version: current.version + 1,
          updatedAt: now,
        });
        return { ...next, version: current.version + 1, updatedAt: now };
      });
    },
  };
}

export type SqlMeetingStore = ReturnType<typeof createSqlMeetingStore>;
