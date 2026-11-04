import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, wallTimeToUtc, type EntityMeta } from "../shared";
import { assertAttendanceOpenForChange, type Minutes } from "./minutes";

export * from "./minutes";
export * from "./drafting";

/**
 * Meetings (F4), ported from PPIDK `Rapat`: a meeting of a unit (or of the whole region), its
 * participants with a role IN the meeting, one room (a Zoom booking XOR an external link),
 * attendance by a rotating short code, reminders at the start and the end. "Finished" is
 * computed at read time (DEC-4): a meeting is finished once its end has passed.
 */

export const MEETING_ROLES = ["chair", "secretary", "member"] as const;
export type MeetingRole = (typeof MEETING_ROLES)[number];
export const MEETING_ROLE_LABELS: Record<MeetingRole, string> = {
  chair: "Chair",
  secretary: "Secretary (minutes)",
  member: "Participant",
};

export interface Participant {
  readonly uid: string;
  readonly role: MeetingRole;
}

/** The room: a Zoom booking (step 7.6) XOR an external link (Meet, Teams, a place's map). */
export interface MeetingRoom {
  readonly zoomRequestId: string | null;
  readonly externalUrl: string | null;
}

export interface Attendance {
  readonly at: Date;
  /** "code" = typed or scanned by the participant; "manual" = ticked by the chair/secretary. */
  readonly method: "code" | "manual";
}

export interface AgendaItem {
  readonly id: string;
  readonly title: string;
}

export const MAX_PARTICIPANTS = 300;
export const MAX_AGENDA_ITEMS = 30;
/** Longest meeting a person can schedule (a whole-day plenary). */
export const MAX_MEETING_MINUTES = 12 * 60;

export const MeetingInputSchema = z
  .object({
    title: safeText(200).pipe(z.string().min(2, "Enter the meeting title.")),
    description: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
    /** null = a meeting of the whole region. */
    orgUnitId: safeId.nullable(),
    /** "YYYY-MM-DDTHH:MM" on the clock of `timeZone`. */
    startsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose the start time."),
    timeZone: z
      .string()
      .max(64)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "Choose a time zone."),
    durationMinutes: z.number().int().min(5).max(MAX_MEETING_MINUTES),
    agenda: z
      .array(safeText(200).pipe(z.string().min(1)))
      .max(MAX_AGENDA_ITEMS)
      .default([]),
  })
  .strict();
export type MeetingInput = z.infer<typeof MeetingInputSchema>;

export interface Meeting extends EntityMeta {
  readonly periodId: string;
  readonly title: string;
  readonly description: string;
  readonly orgUnitId: string | null;
  /** The unit and its ancestors (scope checks); [] for a region meeting. */
  readonly orgUnitPath: readonly string[];
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly agenda: readonly AgendaItem[];
  readonly participants: readonly Participant[];
  /** uids of `participants`, for "my meetings" queries. */
  readonly participantIds: readonly string[];
  readonly room: MeetingRoom;
  /** uid → attendance. */
  readonly attendance: Readonly<Record<string, Attendance>>;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly createdBy: string;
  /** Minutes (F5); null until someone writes them. */
  readonly minutes: Minutes | null;
}

export type MeetingStatus = "scheduled" | "finished" | "cancelled";
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  finished: "Finished",
  cancelled: "Cancelled",
};

/** Read-time status: cancelled wins; otherwise finished once the end has passed. */
export function meetingStatus(
  meeting: Pick<Meeting, "cancelledAt" | "endsAt">,
  now: Date,
): MeetingStatus {
  if (meeting.cancelledAt) return "cancelled";
  return now.getTime() >= meeting.endsAt.getTime() ? "finished" : "scheduled";
}

/** Start and end in UTC from the form's wall time. */
export function meetingTimes(
  input: Pick<MeetingInput, "startsAtLocal" | "timeZone" | "durationMinutes">,
): { startsAt: Date; endsAt: Date } {
  // The schema already checked the wall-time format, so the conversion always succeeds.
  const startsAt = wallTimeToUtc(input.startsAtLocal, input.timeZone) as Date;
  return { startsAt, endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000) };
}

/** Exactly one chair; at most one secretary; nobody twice (the count is capped by the form). */
export function assertParticipants(participants: readonly Participant[]): void {
  if (new Set(participants.map((p) => p.uid)).size !== participants.length) {
    throw new RuleViolationError("A person is listed twice.");
  }
  if (participants.filter((p) => p.role === "chair").length !== 1) {
    throw new RuleViolationError("Name exactly one chair.");
  }
  if (participants.filter((p) => p.role === "secretary").length > 1) {
    throw new RuleViolationError("Name at most one secretary.");
  }
}

/** The person's role in the meeting, or null when they are not a participant. */
export const roleIn = (meeting: Pick<Meeting, "participants">, uid: string): MeetingRole | null =>
  meeting.participants.find((p) => p.uid === uid)?.role ?? null;

/** Authority comes from the role IN the meeting: the chair and the secretary run it. */
export const runsMeeting = (meeting: Pick<Meeting, "participants">, uid: string): boolean => {
  const role = roleIn(meeting, uid);
  return role === "chair" || role === "secretary";
};

/** Only a scheduled meeting changes (a finished or cancelled one is history). */
export function assertScheduled(meeting: Pick<Meeting, "cancelledAt" | "endsAt">, now: Date) {
  const status = meetingStatus(meeting, now);
  if (status !== "scheduled") {
    throw new RuleViolationError(`This meeting is ${MEETING_STATUS_LABELS[status].toLowerCase()}.`);
  }
}

/** Saving one kind of room clears the other (XOR). */
export function setRoom(
  room: { kind: "zoom"; zoomRequestId: string } | { kind: "link"; url: string } | { kind: "none" },
): MeetingRoom {
  if (room.kind === "zoom") return { zoomRequestId: room.zoomRequestId, externalUrl: null };
  if (room.kind === "link") return { zoomRequestId: null, externalUrl: room.url };
  return { zoomRequestId: null, externalUrl: null };
}

export function cancelMeeting(meeting: Meeting, reason: string, now: Date): Meeting {
  assertScheduled(meeting, now);
  return { ...meeting, cancelledAt: now, cancelReason: reason };
}

/* ---------------------------------------------------------------- attendance */

/** Attendance codes: 6 characters without look-alikes (0/O, 1/I/L). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
/** A code shown on the projector is valid this long; the screen asks for a new one before. */
export const CODE_LIFETIME_MS = 2 * 60_000;
/** Attendance opens before the start and stays open after the end (late sign-ins). */
export const ATTENDANCE_OPENS_BEFORE_MS = 30 * 60_000;
export const ATTENDANCE_CLOSES_AFTER_MS = 30 * 60_000;

/** A code from random bytes (one byte per character; the alphabet has 31 letters). */
export function attendanceCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < CODE_LENGTH) throw new Error("Not enough random bytes.");
  return Array.from(randomBytes.slice(0, CODE_LENGTH))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("");
}

/** Typed codes are forgiving: case, spaces and dashes are ignored. Null when malformed. */
export function normalizeCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))
    ? code
    : null;
}

export function attendanceOpen(
  meeting: Pick<Meeting, "startsAt" | "endsAt" | "cancelledAt">,
  now: Date,
) {
  return (
    !meeting.cancelledAt &&
    now.getTime() >= meeting.startsAt.getTime() - ATTENDANCE_OPENS_BEFORE_MS &&
    now.getTime() <= meeting.endsAt.getTime() + ATTENDANCE_CLOSES_AFTER_MS
  );
}

/**
 * Marks a participant present (the first time counts; a second scan changes nothing). Code
 * attendance needs the window to be open; a manual tick by the chair is allowed any time after
 * the start (paper list typed in later), never for a cancelled meeting.
 */
export function markAttendance(
  meeting: Meeting,
  uid: string,
  method: Attendance["method"],
  now: Date,
): Meeting {
  if (roleIn(meeting, uid) === null) {
    throw new RuleViolationError("You are not a participant of this meeting.");
  }
  if (meeting.cancelledAt) throw new RuleViolationError("This meeting is cancelled.");
  assertAttendanceOpenForChange(meeting);
  if (method === "code" && !attendanceOpen(meeting, now)) {
    throw new RuleViolationError("Attendance for this meeting is not open.");
  }
  if (meeting.attendance[uid]) return meeting;
  return { ...meeting, attendance: { ...meeting.attendance, [uid]: { at: now, method } } };
}

export function unmarkAttendance(meeting: Meeting, uid: string): Meeting {
  assertAttendanceOpenForChange(meeting);
  return {
    ...meeting,
    attendance: Object.fromEntries(Object.entries(meeting.attendance).filter(([u]) => u !== uid)),
  };
}

/* ---------------------------------------------------------------- reminders */

/** A start reminder goes out in the last 15 minutes before the start. */
export const START_REMINDER_MS = 15 * 60_000;
/** The end reminder (attendance and minutes) goes out in the first hour after the end. */
export const END_REMINDER_MS = 60 * 60_000;

export type ReminderKind = "start" | "end";

/** Which reminder is due now (the message key keeps each one to a single send). */
export function dueReminder(
  meeting: Pick<Meeting, "startsAt" | "endsAt" | "cancelledAt">,
  now: Date,
): ReminderKind | null {
  if (meeting.cancelledAt) return null;
  const t = now.getTime();
  const start = meeting.startsAt.getTime();
  const end = meeting.endsAt.getTime();
  if (t >= start - START_REMINDER_MS && t < start) return "start";
  if (t >= end && t < end + END_REMINDER_MS) return "end";
  return null;
}

export const reminderKey = (meetingId: string, kind: ReminderKind, uid: string) =>
  `meeting:${meetingId}:${kind}:${uid}`;
