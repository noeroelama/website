import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";
import type { Meeting } from "./index";

export const MINUTES_SOURCES = ["manual", "ai_transcript", "ai_zoom"] as const;
export type MinutesSource = (typeof MINUTES_SOURCES)[number];

export interface Minutes {
  readonly notes: Readonly<Record<string, string>>;
  readonly other: string;
  readonly quorum: number | null;
  readonly source: MinutesSource;
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
  readonly attendanceSnapshot: readonly string[] | null;
}

const note = safeText(20_000, { multiline: true, allowEmpty: true });

export const MinutesInputSchema = z
  .object({
    notes: z.record(safeId, note).refine((r) => Object.keys(r).length <= 30, "Too many items."),
    other: note.default(""),
    quorum: z.number().int().min(1).max(1000).nullable(),
  })
  .strict();
export type MinutesInput = z.infer<typeof MinutesInputSchema>;

export const isApproved = (meeting: Pick<Meeting, "minutes">): boolean =>
  (meeting.minutes?.approvedAt ?? null) !== null;

export function assertAttendanceOpenForChange(meeting: Pick<Meeting, "minutes">): void {
  if (isApproved(meeting)) {
    throw new RuleViolationError("The minutes are approved; attendance is frozen.");
  }
}

function assertMinutesWritable(meeting: Pick<Meeting, "minutes" | "cancelledAt">): void {
  if (meeting.cancelledAt) throw new RuleViolationError("This meeting is cancelled.");
  if (isApproved(meeting)) throw new RuleViolationError("The minutes are approved and locked.");
}

export function writeMinutes(
  meeting: Meeting,
  input: MinutesInput,
  source: MinutesSource = meeting.minutes?.source ?? "manual",
): Meeting {
  assertMinutesWritable(meeting);
  const ids = new Set(meeting.agenda.map((a) => a.id));
  const notes = Object.fromEntries(
    Object.entries(input.notes).filter(([id, text]) => ids.has(id) && text !== ""),
  );
  return {
    ...meeting,
    minutes: {
      notes,
      other: input.other,
      quorum: input.quorum,
      source,
      approvedAt: null,
      approvedBy: null,
      attendanceSnapshot: null,
    },
  };
}

export function mergeDraft(
  meeting: Meeting,
  draft: Readonly<Record<string, string>>,
  source: Exclude<MinutesSource, "manual">,
): Meeting {
  const current = meeting.minutes;
  const notes: Record<string, string> = { ...current?.notes };
  for (const item of meeting.agenda) {
    const text = draft[item.id]?.trim();
    if (text && !notes[item.id]) notes[item.id] = text;
  }
  return writeMinutes(
    meeting,
    { notes, other: current?.other ?? "", quorum: current?.quorum ?? null },
    current ? current.source : source,
  );
}

export function approveMinutes(meeting: Meeting, uid: string, now: Date): Meeting {
  if (!meeting.minutes) throw new RuleViolationError("Write the minutes first.");
  assertMinutesWritable(meeting);
  if (now.getTime() < meeting.startsAt.getTime()) {
    throw new RuleViolationError("Minutes can be approved once the meeting has taken place.");
  }
  return {
    ...meeting,
    minutes: {
      ...meeting.minutes,
      approvedAt: now,
      approvedBy: uid,
      attendanceSnapshot: Object.keys(meeting.attendance).sort(),
    },
  };
}

export function quorumMet(meeting: Pick<Meeting, "minutes" | "attendance">): boolean | null {
  const quorum = meeting.minutes?.quorum ?? null;
  if (quorum === null) return null;
  const present = meeting.minutes?.attendanceSnapshot ?? Object.keys(meeting.attendance);
  return present.length >= quorum;
}

export const ActionItemInputSchema = z
  .object({
    title: safeText(500).pipe(z.string().min(2, "Describe the follow-up.")),
    pic: safeId,
    dueOn: z.iso.date("Choose a date.").nullable(),
  })
  .strict();
export type ActionItemInput = z.infer<typeof ActionItemInputSchema>;

export interface ActionItem extends EntityMeta {
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly periodId: string;
  readonly orgUnitPath: readonly string[];
  readonly title: string;
  readonly pic: string;
  readonly dueOn: string | null;
  readonly doneAt: Date | null;
  readonly createdBy: string;
}

export function assertPicIsParticipant(meeting: Pick<Meeting, "participantIds">, pic: string) {
  if (!meeting.participantIds.includes(pic)) {
    throw new RuleViolationError("The PIC must be a participant of the meeting.");
  }
}

export const isOverdue = (item: Pick<ActionItem, "dueOn" | "doneAt">, today: string) =>
  item.doneAt === null && item.dueOn !== null && item.dueOn < today;
