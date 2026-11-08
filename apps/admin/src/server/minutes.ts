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
  readonly drafter: MinutesDrafter | null;
  readonly names: (uids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
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
      transcript: z.string().min(20, "Paste the transcript.").max(MAX_TRANSCRIPT_CHARS),
    })
    .strict(),
  z.object({ id: safeId, version, source: z.literal("ai_zoom") }).strict(),
]);
const ItemDone = z.object({ id: safeId, version, done: z.boolean() }).strict();

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
      before: minutesSnapshot((current as Meeting).minutes),
      after: minutesSnapshot(next.minutes),
      versionBefore: (current as Meeting).version,
      versionAfter: next.version,
      revertible: false,
    });

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

export function attendanceSheet(
  meeting: Meeting,
  names: ReadonlyMap<string, string>,
  now: Date,
): ReportPdfInput {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: meeting.timeZone,
    dateStyle: "long",
    timeStyle: "short",
  });
  const present = Object.keys(meeting.attendance).length;
  return {
    title: `Daftar hadir / Attendance: ${meeting.title}`,
    subtitle: `${when.format(meeting.startsAt)} (${meeting.timeZone})`,
    sections: [
      {
        heading: `${present} of ${meeting.participants.length} present`,
        lines: meeting.participants.map((p) => {
          const a = meeting.attendance[p.uid];
          const who = `${names.get(p.uid) ?? p.uid} (${MEETING_ROLE_LABELS[p.role]})`;
          return a
            ? `${who}: present ${a.at.toISOString().slice(0, 16).replace("T", " ")} UTC (${a.method})`
            : `${who}: absent`;
        }),
      },
    ],
    footer: `Printed ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  };
}

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
  return async (
    id: string,
    principal: Principal | null,
    sheet: "minutes" | "attendance" = "minutes",
  ): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const meeting = safeId.safeParse(id).success ? await deps.getMeeting(id) : null;
    if (!meeting || meeting.deletedAt || !canSeeMeeting(principal, meeting)) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const items = sheet === "minutes" ? await deps.listItems(meeting.id) : [];
    const names = await deps.names([
      ...new Set([...meeting.participantIds, ...items.map((i) => i.pic)]),
    ]);
    const bytes = await deps.render(
      sheet === "attendance"
        ? attendanceSheet(meeting, names, deps.now())
        : minutesSheet(
            meeting,
            names,
            items.map((i) => ({
              title: i.title,
              pic: i.pic,
              dueOn: i.dueOn,
              done: i.doneAt !== null,
            })),
            deps.now(),
          ),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sheet}-${meeting.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
