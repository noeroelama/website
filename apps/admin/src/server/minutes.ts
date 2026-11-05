import "server-only";
import { z } from "zod";
import type { Snapshot } from "@website/audit";
import type { MeetingAudit, SqlActionItemStore, SqlMeetingStore } from "@website/db/sql";
import {
  ActionItemInputSchema,
  approveMinutes,
  draftNotes,
  draftProposals,
  MAX_TRANSCRIPT_CHARS,
  mergeDraft,
  parseVtt,
  type DraftOutput,
  type MinutesDrafter,
  assertPicIsParticipant,
  MEETING_ROLE_LABELS,
  MinutesInputSchema,
  quorumMet,
  roleIn,
  writeMinutes,
  type Meeting,
} from "@website/domain/meetings";
import { RuleViolationError } from "@website/domain/shared";
import type { ReportPdfInput } from "@website/pdf";
import { can, canAccessAdmin, type Principal } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";
import { canRunMeeting, canSeeMeeting } from "./meetings";

export interface MinutesDeps {
  readonly meetings: Pick<SqlMeetingStore, "get" | "write">;
  readonly actionItems: Pick<SqlActionItemStore, "get" | "write" | "readMeeting">;
  /** null = no ANTHROPIC_API_KEY: machine drafts are off. */
  readonly drafter: MinutesDrafter | null;
  /** Display names of accounts (the machine matches speakers to participants). */
  readonly names: (uids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  /** The VTT transcript of the meeting's Zoom room (F2), or null when there is none. */
  readonly zoomTranscript: (meeting: Meeting) => Promise<string | null>;
  readonly now: () => Date;
}

const version = z.number().int().min(1);
const SaveMinutes = MinutesInputSchema.extend({ id: safeId, version }).strict();
const Ref = z.object({ id: safeId, version }).strict();
const SaveItem = ActionItemInputSchema.extend({
  id: safeId.optional(),
  version: version.nullable(),
  meetingId: safeId,
}).strict();
const Draft = z.discriminatedUnion("source", [
  z
    .object({
      id: safeId,
      version,
      source: z.literal("ai_transcript"),
      /** Pasted text or a Zoom .vtt file's content. */
      transcript: z.string().min(20, "Paste the transcript.").max(MAX_TRANSCRIPT_CHARS),
    })
    .strict(),
  /** F6 with F2: the transcript of the meeting's Zoom room, pulled from Zoom. */
  z.object({ id: safeId, version, source: z.literal("ai_zoom") }).strict(),
]);
const ItemDone = z.object({ id: safeId, version, done: z.boolean() }).strict();

/** Approving: the chair, or `meetings.approve_minutes` for the meeting's unit. */
export const canApproveMinutes = (
  principal: Principal,
  meeting: Pick<Meeting, "participants" | "orgUnitPath">,
) =>
  roleIn(meeting, principal.userId) === "chair" ||
  can(principal, "meetings.approve_minutes", { orgUnitPath: meeting.orgUnitPath });

const minutesSnapshot = (m: Meeting["minutes"]): Snapshot | null =>
  m && {
    notes: { ...m.notes },
    other: m.other,
    quorum: m.quorum,
    source: m.source,
    approvedAt: m.approvedAt?.toISOString() ?? null,
  };

const minutesAudit =
  (audit: AuditBuilder, title: string): MeetingAudit =>
  (_before, _after, current, next) =>
    audit({
      module: "meetings",
      action: "UPDATE",
      resourceType: "minutes",
      resourceId: next.id,
      title,
      // Minutes always belong to an existing meeting.
      before: minutesSnapshot((current as Meeting).minutes),
      after: minutesSnapshot(next.minutes),
      versionBefore: (current as Meeting).version,
      versionAfter: next.version,
      // Approval freezes attendance; a revert could unfreeze approved minutes.
      revertible: false,
    });

/** Minutes (F5): notes per agenda item, approval, action items. */
export function createMinutesActions(deps: MinutesDeps) {
  const change = (
    principal: Principal,
    id: string,
    v: number,
    allowed: (m: Meeting) => boolean,
    step: (m: Meeting) => Meeting,
    audit: MeetingAudit,
  ) =>
    deps.meetings.write(
      id,
      v,
      (current) => {
        const meeting = current as Meeting;
        if (!allowed(meeting)) {
          throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
        }
        return step(meeting);
      },
      audit,
      deps.now(),
    );

  const save = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: SaveMinutes,
    handler: async ({ id, version: v, ...input }, principal, audit) => {
      const saved = await change(
        principal,
        id,
        v,
        (m) => canRunMeeting(principal, m),
        (m) => writeMinutes(m, input),
        minutesAudit(audit, "Minutes"),
      );
      return { version: saved.version };
    },
  });

  const approve = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: Ref,
    handler: async ({ id, version: v }, principal, audit) => {
      const now = deps.now();
      const saved = await change(
        principal,
        id,
        v,
        (m) => canApproveMinutes(principal, m),
        (m) => approveMinutes(m, principal.userId, now),
        minutesAudit(audit, "Minutes approved"),
      );
      return { version: saved.version };
    },
  });

  const itemAudit =
    (audit: AuditBuilder, action: "CREATE" | "UPDATE" | "DELETE") =>
    (
      before: Parameters<Parameters<SqlActionItemStore["write"]>[3]>[0],
      after: Parameters<Parameters<SqlActionItemStore["write"]>[3]>[1],
      current: { version: number } | null,
      next: { id: string; title: string; version: number },
    ) =>
      audit({
        module: "meetings",
        action,
        resourceType: "actionItem",
        resourceId: next.id,
        title: next.title,
        before,
        after,
        versionBefore: current?.version ?? null,
        versionAfter: next.version,
      });

  /** Add or edit a follow-up (whoever runs the meeting); the PIC must be a participant. */
  const saveItem = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: SaveItem,
    handler: async ({ id, version: v, meetingId, ...input }, principal, audit) => {
      const saved = await deps.actionItems.write(
        id ?? null,
        id ? v : null,
        async (current, tx) => {
          const meeting = await deps.actionItems.readMeeting(tx, current?.meetingId ?? meetingId);
          if (!canRunMeeting(principal, meeting)) {
            throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
          }
          if (meeting.cancelledAt) throw new RuleViolationError("This meeting is cancelled.");
          assertPicIsParticipant(meeting, input.pic);
          return {
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            periodId: meeting.periodId,
            orgUnitPath: meeting.orgUnitPath,
            title: input.title,
            pic: input.pic,
            dueOn: input.dueOn,
            doneAt: current?.doneAt ?? null,
            createdBy: current?.createdBy ?? principal.userId,
            deletedAt: null,
          };
        },
        itemAudit(audit, id ? "UPDATE" : "CREATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  /** The PIC (or whoever runs the meeting) marks a follow-up done or open again. */
  const setItemDone = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: ItemDone,
    handler: async ({ id, version: v, done }, principal, audit) => {
      const now = deps.now();
      const saved = await deps.actionItems.write(
        id,
        v,
        async (current, tx) => {
          const item = current as NonNullable<typeof current>;
          const meeting = await deps.actionItems.readMeeting(tx, item.meetingId);
          if (item.pic !== principal.userId && !canRunMeeting(principal, meeting)) {
            throw new RuleViolationError("Only the PIC or the meeting's chair can do this.");
          }
          return { ...item, doneAt: done ? (item.doneAt ?? now) : null };
        },
        itemAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version };
    },
  });

  const removeItem = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: Ref,
    handler: async ({ id, version: v }, principal, audit) => {
      const now = deps.now();
      await deps.actionItems.write(
        id,
        v,
        async (current, tx) => {
          const item = current as NonNullable<typeof current>;
          const meeting = await deps.actionItems.readMeeting(tx, item.meetingId);
          if (!canRunMeeting(principal, meeting)) {
            throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
          }
          return { ...item, deletedAt: now };
        },
        itemAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  /**
   * F6: the machine drafts from a transcript (VTT is turned into plain lines first); the draft
   * fills only EMPTY agenda items in a transaction, and proposed action items come back to the
   * page for a person to add (their PICs are checked again on save).
   */
  const draft = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: Draft,
    handler: async (input, principal, audit) => {
      const { id, version: v, source } = input;
      if (!deps.drafter) throw new RuleViolationError("Machine drafts are not set up.");
      const meeting = await deps.meetings.get(id);
      if (!meeting || meeting.deletedAt)
        throw new RuleViolationError("This meeting does not exist.");
      if (!canRunMeeting(principal, meeting)) {
        throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
      }
      const transcript =
        input.source === "ai_transcript" ? input.transcript : await deps.zoomTranscript(meeting);
      if (transcript === null) {
        throw new RuleViolationError(
          "Zoom has no transcript for this meeting's room yet (it comes with the cloud recording).",
        );
      }
      const names = await deps.names(meeting.participantIds);
      let output: DraftOutput;
      try {
        output = await deps.drafter.draft({
          title: meeting.title,
          agenda: meeting.agenda,
          participants: meeting.participantIds.map((uid) => ({ uid, name: names.get(uid) ?? uid })),
          transcript: transcript.trimStart().startsWith("WEBVTT")
            ? parseVtt(transcript)
            : transcript,
        });
      } catch (error) {
        deps.logError("minutes draft failed", { meetingId: id, error: String(error) });
        throw new RuleViolationError("The machine draft failed. Try again later or write by hand.");
      }
      const saved = await change(
        principal,
        id,
        v,
        (m) => canRunMeeting(principal, m),
        (m) => mergeDraft(m, draftNotes(output), source),
        minutesAudit(audit, "Minutes drafted"),
      );
      return { version: saved.version, proposals: draftProposals(output, saved.participantIds) };
    },
  });

  return { save, approve, saveItem, setItemDone, removeItem, draft };
}

/** The minutes as a printable sheet (PDF at download time; nothing stored). */
export function minutesSheet(
  meeting: Meeting,
  names: ReadonlyMap<string, string>,
  items: ReadonlyArray<{ title: string; pic: string; dueOn: string | null; done: boolean }>,
  now: Date,
): ReportPdfInput {
  const name = (uid: string) => names.get(uid) ?? uid;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: meeting.timeZone,
    dateStyle: "long",
    timeStyle: "short",
  });
  const minutes = meeting.minutes;
  const present = new Set(minutes?.attendanceSnapshot ?? Object.keys(meeting.attendance));
  const quorum = quorumMet(meeting);
  return {
    title: `Notulen / Minutes: ${meeting.title}`,
    subtitle: `${when.format(meeting.startsAt)} (${meeting.timeZone})`,
    sections: [
      {
        heading: "Attendance",
        lines: [
          ...meeting.participants.map(
            (p) =>
              `${name(p.uid)} (${MEETING_ROLE_LABELS[p.role]}): ${present.has(p.uid) ? "present" : "absent"}`,
          ),
          quorum === null
            ? "Quorum: not set"
            : `Quorum ${minutes?.quorum}: ${quorum ? "met" : "not met"} (${present.size} present)`,
        ],
      },
      ...meeting.agenda.map((a, i) => ({
        heading: `${i + 1}. ${a.title}`,
        lines: [minutes?.notes[a.id] ?? "—"],
      })),
      ...(minutes?.other ? [{ heading: "Other", lines: [minutes.other] }] : []),
      {
        heading: "Action items",
        lines: items.length
          ? items.map(
              (a) =>
                `${a.done ? "[done] " : ""}${a.title} — ${name(a.pic)}${a.dueOn ? `, due ${a.dueOn}` : ""}`,
            )
          : ["—"],
      },
    ],
    footer: [
      minutes?.approvedAt
        ? `Approved by ${name(minutes.approvedBy as string)} on ${minutes.approvedAt.toISOString().slice(0, 10)}`
        : "Draft: not approved yet",
      `Printed ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ].join(" · "),
  };
}

/** GET /api/meetings/<id>/minutes: the minutes as PDF for whoever may see the meeting. */
export function createMinutesFileRoute(deps: {
  readonly getMeeting: (id: string) => Promise<Meeting | null>;
  readonly listItems: (
    meetingId: string,
  ) => Promise<
    ReadonlyArray<{ title: string; pic: string; dueOn: string | null; doneAt: Date | null }>
  >;
  readonly names: (uids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly render: (input: ReportPdfInput) => Promise<Uint8Array>;
  readonly now: () => Date;
}) {
  return async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const meeting = safeId.safeParse(id).success ? await deps.getMeeting(id) : null;
    if (!meeting || meeting.deletedAt || !canSeeMeeting(principal, meeting)) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const items = await deps.listItems(meeting.id);
    const names = await deps.names([
      ...new Set([...meeting.participantIds, ...items.map((i) => i.pic)]),
    ]);
    const bytes = await deps.render(
      minutesSheet(
        meeting,
        names,
        items.map((i) => ({ title: i.title, pic: i.pic, dueOn: i.dueOn, done: i.doneAt !== null })),
        deps.now(),
      ),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="minutes-${meeting.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
