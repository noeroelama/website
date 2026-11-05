/**
 * PPIDK → platform import of meetings (with participants, agenda, minutes and action items), Zoom
 * bookings and their recorded sessions, short links and the outgoing message log (block J, step
 * 7.12, DEC-10): pure mapping from the MariaDB tables (exported as TSV) to database documents, run
 * after the people import (periods, units and accounts exist) and after freezing the PPIDK
 * meeting, Zoom and Tools screens. Ids come from PPIDK (idempotent). Attendance codes are not
 * imported (they rotate); capacity days are rebuilt from the approved bookings.
 */
import type { MeetingRole } from "@website/domain/meetings";
import type { MessageStatus } from "@website/domain/messaging";
import type { ZoomStatus } from "@website/domain/zoom";
import { utcDays } from "@website/domain/zoom";
import { messageId } from "../sql/messages";
import type { PlannedWrite, TsvRow } from "./people";

/** The tables this import reads (one `<name>.tsv` file each). */
export const PPIDK_MEETING_TABLES = [
  "org_units",
  "meetings",
  "meeting_participants",
  "meeting_agenda_items",
  "meeting_action_items",
  "zoom_meetings",
  "zoom_recording_sessions",
  "shortlinks",
  "outgoing_messages",
] as const;
export type PpidkMeetingTables = Readonly<
  Record<(typeof PPIDK_MEETING_TABLES)[number], readonly TsvRow[]>
>;

export interface PpidkMeetingPlan {
  readonly writes: PlannedWrite[];
  readonly skipped: Array<{ table: string; id: string; reason: string }>;
  readonly counts: Record<string, number>;
}

const ROLE: Readonly<Record<string, MeetingRole>> = {
  pemimpin: "chair",
  notulis: "secretary",
  peserta: "member",
  undangan: "member",
};
const ZOOM_STATUS: Readonly<Record<string, ZoomStatus>> = {
  diajukan: "pending",
  disetujui: "approved",
  // A finished booking was approved; "finished" is read-time on the platform.
  selesai: "approved",
  ditolak: "rejected",
  dibatalkan: "cancelled",
};
/** Queued PPIDK messages are NOT sent late after the move: they become "blocked" history. */
const MESSAGE_STATUS: Readonly<Record<string, MessageStatus>> = {
  antre: "blocked",
  mengirim: "blocked",
  terkirim: "sent",
  gagal: "failed",
};

const at = (value: string | null | undefined) => (value ? new Date(`${value}Z`) : null);
const text = (value: string | null | undefined) => (value ?? "").trim();

export function mapPpidkMeetings(
  tables: PpidkMeetingTables,
  options: { uidOf: (ppidkUserId: string) => string; now: Date },
): PpidkMeetingPlan {
  const { now } = options;
  const writes: PlannedWrite[] = [];
  const skipped: PpidkMeetingPlan["skipped"] = [];
  const set = (path: string, data: Record<string, unknown>) =>
    writes.push({ path, data, mode: "set" });
  const skip = (table: string, row: TsvRow, reason: string) =>
    skipped.push({ table, id: row["id"] as string, reason });
  const id = (table: string, value: string | null | undefined) => `ppidk-${table}-${String(value)}`;
  const person = (v: string | null | undefined) => (v ? options.uidOf(v) : null);
  const meta = (row: TsvRow) => ({
    version: 1,
    createdAt: at(row["created_at"]) ?? now,
    updatedAt: now,
    deletedAt: null,
  });

  const units = new Map(tables.org_units.map((u) => [u["id"] as string, u]));
  const unitPath = (unitId: string | null | undefined): string[] | null => {
    const path: string[] = [];
    for (
      let u = units.get(unitId as string);
      u && !path.includes(id("unit", u["id"]));
      u = units.get(u["parent_id"] as string)
    ) {
      path.unshift(id("unit", u["id"]));
    }
    return path.length > 0 ? path : null;
  };

  /* ---- Zoom bookings (first: meetings point to them) ---- */
  const bookingIds = new Set<string>();
  const approvedSlots: Array<{ id: string; startsAt: Date; endsAt: Date }> = [];
  for (const z of tables.zoom_meetings) {
    const status = ZOOM_STATUS[z["status"] as string];
    const path = unitPath(z["org_unit_id"]);
    const startsAt = at(z["starts_at"]);
    const endsAt = at(z["ends_at"]);
    if (!status || !path || !startsAt || !endsAt) {
      skip("zoom_meetings", z, status ? "unit or times not imported" : `status ${z["status"]}`);
      continue;
    }
    const bookingId = id("zoom", z["id"]);
    bookingIds.add(z["id"] as string);
    if (status === "approved") approvedSlots.push({ id: bookingId, startsAt, endsAt });
    const ended = at(z["waiting_room_restored_at"]);
    set(`zoomRequests/${bookingId}`, {
      topic: text(z["topic"]),
      startsAt,
      endsAt,
      timeZone: z["timezone"],
      passcode: text(z["requested_passcode"] ?? z["passcode"]).slice(0, 10) || "ppidk",
      joinBeforeHostMinutes: Number(z["jbh_time"] ?? 0),
      meetingId: null,
      requestedBy: person(z["requested_by_user_id"]),
      orgUnitId: id("unit", z["org_unit_id"]),
      orgUnitPath: path,
      status,
      decidedBy: person(z["approved_by_user_id"] ?? z["cancelled_by_user_id"]),
      decisionNote: z["review_note"] ?? z["cancel_reason"] ?? null,
      zoomMeetingId: z["zoom_meeting_id"] ?? null,
      joinUrl: z["join_url"] ?? null,
      shortUrl: z["short_url"] ?? null,
      roomError: z["sync_error"] ?? null,
      closedAt: ended,
      recordingUuids: tables.zoom_recording_sessions
        .filter((s) => s["zoom_meeting_row_id"] === z["id"])
        .map((s) => s["meeting_uuid"] as string),
      ...meta(z),
    });
  }
  // Capacity days rebuilt from the approved bookings (so the next booking sees them).
  const days = new Map<string, Array<{ id: string; startsAt: Date; endsAt: Date }>>();
  for (const slot of approvedSlots) {
    for (const day of utcDays(slot.startsAt, slot.endsAt))
      days.set(day, [...(days.get(day) ?? []), slot]);
  }
  for (const [day, slots] of days) set(`zoomCapacity/${day}`, { slots });
  for (const s of tables.zoom_recording_sessions) {
    if (!bookingIds.has(s["zoom_meeting_row_id"] as string)) {
      skip("zoom_recording_sessions", s, "booking not imported");
      continue;
    }
    // Archived sessions count as listed; the archive job lists the others again.
    const archived = at(s["archived_at"]);
    set(`recordingSessions/${Buffer.from(s["meeting_uuid"] as string).toString("hex")}`, {
      uuid: s["meeting_uuid"],
      bookingId: id("zoom", s["zoom_meeting_row_id"]),
      listedAt: archived,
      trashedAt: null,
      createdAt: at(s["created_at"]) ?? now,
    });
  }

  /* ---- meetings with participants, agenda, minutes ---- */
  const byMeeting = <T extends TsvRow>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows)
      map.set(r["meeting_id"] as string, [...(map.get(r["meeting_id"] as string) ?? []), r]);
    return map;
  };
  const participantsOf = byMeeting(tables.meeting_participants);
  const agendaOf = byMeeting(tables.meeting_agenda_items);
  const meetings = new Map<
    string,
    { id: string; title: string; periodId: string; path: string[]; participantIds: string[] }
  >();
  for (const m of tables.meetings) {
    const path = unitPath(m["org_unit_id"]);
    const startsAt = at(m["starts_at"]);
    const endsAt = at(m["ends_at"]);
    if (!path || !startsAt || !endsAt) {
      skip("meetings", m, "unit or times not imported");
      continue;
    }
    const people = (participantsOf.get(m["id"] as string) ?? []).flatMap((p) => {
      const role = ROLE[p["role"] as string];
      return role ? [{ uid: options.uidOf(p["user_id"] as string), role, row: p }] : [];
    });
    // The platform needs exactly one chair: the first leader, else the creator joins as chair.
    let chairSeen = false;
    const participants = people.map((p) => {
      if (p.role !== "chair") return p;
      if (chairSeen) return { ...p, role: "member" as const };
      chairSeen = true;
      return p;
    });
    const creator = person(m["created_by_user_id"]);
    if (!chairSeen && creator && !participants.some((p) => p.uid === creator)) {
      participants.unshift({ uid: creator, role: "chair", row: {} });
    } else if (!chairSeen && participants[0]) {
      participants[0] = { ...participants[0], role: "chair" };
    }
    if (participants.length === 0) {
      skip("meetings", m, "no participants");
      continue;
    }
    const agendaRows = [...(agendaOf.get(m["id"] as string) ?? [])].sort(
      (a, b) => Number(a["sort"]) - Number(b["sort"]),
    );
    const agenda = agendaRows.map((a) => ({ id: id("agenda", a["id"]), title: text(a["title"]) }));
    const notes = Object.fromEntries(
      agendaRows.flatMap((a) => {
        const body = [
          text(a["discussion"]),
          text(a["decision"]) && `Keputusan: ${text(a["decision"])}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        return body ? [[id("agenda", a["id"]), body]] : [];
      }),
    );
    const attendance = Object.fromEntries(
      participants.flatMap((p) =>
        p.row["attendance"] === "hadir"
          ? [
              [
                p.uid,
                {
                  at: at(p.row["checked_in_at"]) ?? startsAt,
                  method: p.row["check_in_method"] === "kode" ? "code" : "manual",
                },
              ],
            ]
          : [],
      ),
    );
    const approvedAt = at(m["minutes_approved_at"]);
    const hasMinutes = m["minutes_status"] !== "kosong" || Object.keys(notes).length > 0;
    const zoomId =
      m["zoom_meeting_id"] && bookingIds.has(m["zoom_meeting_id"])
        ? id("zoom", m["zoom_meeting_id"])
        : null;
    const meetingId = id("meeting", m["id"]);
    const participantIds = participants.map((p) => p.uid);
    meetings.set(m["id"] as string, {
      id: meetingId,
      title: text(m["title"]),
      periodId: id("period", m["period_id"]),
      path,
      participantIds,
    });
    set(`meetings/${meetingId}`, {
      periodId: id("period", m["period_id"]),
      title: text(m["title"]),
      description: [text(m["purpose"]), text(m["location"])].filter(Boolean).join("\n"),
      orgUnitId: id("unit", m["org_unit_id"]),
      orgUnitPath: path,
      startsAt,
      endsAt,
      timeZone: m["timezone"],
      agenda,
      participants: participants.map((p) => ({ uid: p.uid, role: p.role })),
      participantIds,
      room: { zoomRequestId: zoomId, externalUrl: zoomId ? null : (m["meeting_url"] ?? null) },
      attendance,
      cancelledAt: m["status"] === "dibatalkan" ? (at(m["cancelled_at"]) ?? endsAt) : null,
      cancelReason: m["cancel_reason"] ?? null,
      createdBy: creator ?? "ppidk",
      minutes: hasMinutes
        ? {
            notes,
            other: "",
            quorum: m["quorum_min"] ? Number(m["quorum_min"]) : null,
            source:
              m["minutes_assisted_source"] === "zoom"
                ? "ai_zoom"
                : m["minutes_assisted_at"]
                  ? "ai_transcript"
                  : "manual",
            approvedAt: m["minutes_status"] === "disahkan" ? (approvedAt ?? endsAt) : null,
            approvedBy:
              m["minutes_status"] === "disahkan"
                ? (person(m["minutes_approved_by_user_id"]) ?? "ppidk")
                : null,
            attendanceSnapshot:
              m["minutes_status"] === "disahkan" ? Object.keys(attendance).sort() : null,
          }
        : null,
      ...meta(m),
    });
  }

  /* ---- action items (PIC kept even when not a participant: history) ---- */
  for (const a of tables.meeting_action_items) {
    const meeting = meetings.get(a["meeting_id"] as string);
    if (!meeting || a["status"] === "dibatalkan") {
      skip("meeting_action_items", a, meeting ? "cancelled" : "meeting not imported");
      continue;
    }
    set(`actionItems/${id("action", a["id"])}`, {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      periodId: meeting.periodId,
      orgUnitPath: meeting.path,
      title: [text(a["title"]), text(a["description"])].filter(Boolean).join(": ").slice(0, 500),
      pic: options.uidOf(a["pic_user_id"] as string),
      dueOn: a["due_date"] ? a["due_date"].slice(0, 10) : null,
      doneAt: a["status"] === "selesai" ? (at(a["completed_at"]) ?? now) : null,
      createdBy: "ppidk",
      ...meta(a),
    });
  }

  /* ---- short links (history; the provider keeps the slug) ---- */
  const slugs = new Set<string>();
  for (const l of tables.shortlinks) {
    const provider = l["provider"] === "goppi" ? "goppi" : "sid";
    const slug = text(l["short"]);
    const key = `${provider}_${slug.toLowerCase()}`;
    if (!slug || slugs.has(key) || !/^[A-Za-z0-9_-]{1,120}$/.test(slug)) {
      skip("shortlinks", l, "slug empty, repeated or not importable");
      continue;
    }
    slugs.add(key);
    const linkId = id("link", l["id"]);
    set(`shortLinks/${linkId}`, {
      provider,
      ref: l["external_id"] ?? slug,
      slug,
      shortUrl: l["short_url"],
      longUrl: l["long_url"],
      title: text(l["title"]),
      source: l["source"] === "alat" ? "tools" : text(l["source"]) || "tools",
      createdBy: person(l["created_by_user_id"]),
      archivedAt: at(l["archived_at"]),
      ...meta(l),
    });
    set(`shortLinkSlugs/${key}`, { id: linkId });
  }

  /* ---- message log (history; keys keep PPIDK's idempotency keys) ---- */
  for (const o of tables.outgoing_messages) {
    const key = `ppidk:${text(o["idempotency_key"]).replace(/[^A-Za-z0-9_.@:-]/g, "_")}`;
    const status =
      o["channel"] === "log" ? "logged" : (MESSAGE_STATUS[o["status"] as string] ?? "failed");
    set(`messageLog/${messageId(key)}`, {
      key,
      channel: "whatsapp",
      to: o["recipient"] ? `+${o["recipient"].replace(/^\+/, "")}` : null,
      subject: "",
      text: o["body"] ?? "",
      html: "",
      status,
      attempts: Number(o["attempts"] ?? 0),
      providerId: o["provider_message_id"] ?? null,
      lastError: status === "blocked" ? "not sent before the move" : (o["last_error"] ?? null),
      createdAt: at(o["created_at"]) ?? now,
      updatedAt: at(o["updated_at"]) ?? now,
    });
  }

  const counts: Record<string, number> = {};
  for (const w of writes) {
    const collection = w.path.split("/")[0] as string;
    counts[collection] = (counts[collection] ?? 0) + 1;
  }
  return { writes, skipped, counts };
}
