import { describe, expect, it } from "vitest";
import {
  createSqlActionItemStore,
  createSqlMeetingStore,
  createSqlMessageLog,
  createSqlShortLinkStore,
  createSqlZoomStore,
} from "@website/db/sql";
import { meetingStatus, quorumMet } from "@website/domain/meetings";
import { mapPpidkMeetings, type PpidkMeetingTables } from "../../packages/db/src/ppidk/meetings";
import { parseTsv } from "../../packages/db/src/ppidk/people";
import { fakeDb } from "../support/fake-db";

const now = new Date("2026-11-05T00:00:00Z");
const table = (rows: Array<Record<string, string>>) => {
  const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (value: string | undefined) =>
    value === undefined ? "NULL" : value.replace(/\n/g, "\\n");
  return parseTsv(
    [header.join("\t"), ...rows.map((r) => header.map((h) => cell(r[h])).join("\t"))].join("\n") +
      "\n",
  );
};
const times = {
  starts_at: "2026-10-10 10:00:00",
  ends_at: "2026-10-10 11:30:00",
  timezone: "Asia/Tokyo",
};

const tables: PpidkMeetingTables = {
  org_units: table([
    { id: "40", name: "Sekjen" },
    { id: "41", parent_id: "40", name: "Biro" },
  ]),
  zoom_meetings: table([
    {
      id: "1",
      org_unit_id: "41",
      requested_by_user_id: "7",
      topic: "Rapat kerja",
      status: "selesai",
      zoom_meeting_id: "8123",
      join_url: "https://zoom.us/j/8123",
      requested_passcode: "ppi",
      jbh_time: "10",
      approved_by_user_id: "8",
      waiting_room_restored_at: "2026-10-10 11:31:00",
      ...times,
    },
    {
      id: "2",
      org_unit_id: "41",
      requested_by_user_id: "7",
      topic: "Pending",
      status: "diajukan",
      ...times,
      starts_at: "2026-12-01 23:00:00",
      ends_at: "2026-12-02 01:00:00",
    },
    {
      id: "3",
      org_unit_id: "99",
      requested_by_user_id: "7",
      topic: "Unit gone",
      status: "disetujui",
      ...times,
    },
    {
      id: "4",
      org_unit_id: "41",
      requested_by_user_id: "7",
      topic: "Odd",
      status: "aneh",
      ...times,
    },
    {
      id: "5",
      org_unit_id: "41",
      requested_by_user_id: "7",
      topic: "Cancelled",
      status: "dibatalkan",
      cancelled_by_user_id: "8",
      cancel_reason: "Tidak jadi",
      passcode: "abcdefghijklmn",
      ...times,
    },
  ]),
  zoom_recording_sessions: table([
    {
      id: "1",
      zoom_meeting_row_id: "1",
      meeting_uuid: "u/1==",
      archived_at: "2026-10-11 00:00:00",
    },
    { id: "2", zoom_meeting_row_id: "1", meeting_uuid: "u2" },
    { id: "3", zoom_meeting_row_id: "3", meeting_uuid: "u3" },
  ]),
  meetings: table([
    {
      id: "10",
      period_id: "3",
      org_unit_id: "41",
      created_by_user_id: "7",
      title: "Rapat kerja",
      purpose: "Rencana",
      location: "Online",
      zoom_meeting_id: "1",
      status: "selesai",
      quorum_min: "2",
      minutes_status: "disahkan",
      minutes_approved_by_user_id: "7",
      minutes_approved_at: "2026-10-12 00:00:00",
      minutes_assisted_at: "2026-10-11 00:00:00",
      minutes_assisted_source: "zoom",
      ...times,
    },
    {
      id: "11",
      period_id: "3",
      org_unit_id: "41",
      created_by_user_id: "9",
      title: "Tanpa pemimpin",
      meeting_url: "https://meet.example.org/x",
      status: "dibatalkan",
      cancel_reason: "Bentrok",
      minutes_status: "kosong",
      ...times,
    },
    { id: "12", period_id: "3", org_unit_id: "99", title: "Unit hilang", ...times },
    {
      id: "13",
      period_id: "3",
      org_unit_id: "41",
      title: "Sepi",
      minutes_status: "kosong",
      ...times,
    },
    {
      id: "14",
      period_id: "3",
      org_unit_id: "41",
      created_by_user_id: "7",
      title: "Draf",
      minutes_status: "draf",
      minutes_assisted_at: "2026-10-11 00:00:00",
      ...times,
    },
    {
      id: "15",
      period_id: "3",
      org_unit_id: "41",
      title: "Tanpa pembuat",
      minutes_status: "disahkan",
      ...times,
    },
  ]),
  meeting_participants: table([
    {
      id: "1",
      meeting_id: "10",
      user_id: "7",
      role: "pemimpin",
      attendance: "hadir",
      checked_in_at: "2026-10-10 10:01:00",
      check_in_method: "kode",
    },
    {
      id: "2",
      meeting_id: "10",
      user_id: "8",
      role: "pemimpin",
      attendance: "hadir",
      check_in_method: "manual",
    },
    { id: "3", meeting_id: "10", user_id: "9", role: "notulis", attendance: "izin" },
    { id: "4", meeting_id: "10", user_id: "6", role: "aneh" },
    { id: "5", meeting_id: "11", user_id: "8", role: "undangan" },
    { id: "6", meeting_id: "14", user_id: "8", role: "peserta" },
    { id: "7", meeting_id: "15", user_id: "9", role: "peserta" },
  ]),
  meeting_agenda_items: table([
    { id: "22", meeting_id: "15", title: "Satu", discussion: "Ada.", sort: "1" },
    {
      id: "21",
      meeting_id: "10",
      title: "Anggaran",
      discussion: "Dibahas.",
      decision: "Disetujui.",
      sort: "2",
    },
    { id: "20", meeting_id: "10", title: "Pembukaan", sort: "1" },
  ]),
  meeting_action_items: table([
    {
      id: "30",
      meeting_id: "10",
      title: "Kirim RAB",
      description: "ke bendahara",
      pic_user_id: "8",
      due_date: "2026-10-20",
      status: "selesai",
      completed_at: "2026-10-19 00:00:00",
    },
    { id: "31", meeting_id: "10", title: "Booking", pic_user_id: "9", status: "terbuka" },
    { id: "32", meeting_id: "10", title: "Batal", pic_user_id: "9", status: "dibatalkan" },
    { id: "33", meeting_id: "12", title: "Hilang", pic_user_id: "9", status: "terbuka" },
    {
      id: "34",
      meeting_id: "10",
      title: "Selesai tanpa waktu",
      pic_user_id: "9",
      status: "selesai",
    },
  ]),
  shortlinks: table([
    {
      id: "1",
      short: "kongres",
      short_url: "https://s.id/kongres",
      long_url: "https://example.org/a",
      title: "Kongres",
      source: "alat",
      created_by_user_id: "7",
    },
    {
      id: "2",
      short: "Zoom1",
      short_url: "https://goppi.id/Zoom1",
      long_url: "https://zoom.us/j/1",
      provider: "goppi",
      external_id: "55",
      source: "zoom",
      archived_at: "2026-10-01 00:00:00",
    },
    {
      id: "3",
      short: "kongres",
      short_url: "https://s.id/kongres",
      long_url: "https://example.org/b",
    },
    { id: "4", short: "bad slug!", short_url: "x", long_url: "y" },
    {
      id: "5",
      short: "notitle",
      short_url: "https://s.id/notitle",
      long_url: "https://example.org/c",
      source: "",
    },
  ]),
  outgoing_messages: table([
    {
      id: "1",
      channel: "waha",
      recipient: "6281234567890",
      body: "Halo",
      idempotency_key: "rapat:10:mulai:7",
      status: "terkirim",
      attempts: "1",
      provider_message_id: "true_628_ABC",
    },
    {
      id: "2",
      channel: "waha",
      recipient: "6281234567890",
      body: "Antre",
      idempotency_key: "rapat:10:selesai:7",
      status: "antre",
    },
    {
      id: "3",
      channel: "log",
      recipient: "+6281",
      body: "Log",
      idempotency_key: "x y",
      status: "terkirim",
    },
    {
      id: "4",
      channel: "waha",
      recipient: "6281",
      body: "Gagal",
      idempotency_key: "g",
      status: "gagal",
      last_error: "500",
    },
    { id: "5", channel: "waha", body: "Tanpa nomor", idempotency_key: "h", status: "aneh" },
    { id: "6", channel: "waha", recipient: "6281", idempotency_key: "nobody", status: "terkirim" },
  ]),
};

const uidOf = (id: string) => (id === "7" ? "uid-rina" : `ppidk-${id}`);

describe("PPIDK import of meetings, Zoom, short links and messages (step 7.12)", () => {
  const plan = mapPpidkMeetings(tables, { uidOf, now });
  const fake = fakeDb();
  const db = fake.db as unknown as Parameters<typeof createSqlMeetingStore>[0];
  const loaded = Promise.all(
    plan.writes.map((w) => {
      const [collection, id] = w.path.split("/") as [string, string];
      return db.collection(collection).doc(id).set(w.data);
    }),
  );

  it("reports counts and every skipped row", () => {
    expect(plan.counts).toMatchObject({
      zoomRequests: 3,
      zoomCapacity: 1,
      recordingSessions: 2,
      meetings: 4,
      actionItems: 3,
      shortLinks: 3,
      shortLinkSlugs: 3,
      messageLog: 6,
    });
    expect(plan.skipped.map((s) => `${s.table}:${s.id}`).sort()).toEqual(
      [
        "zoom_meetings:3",
        "zoom_meetings:4",
        "zoom_recording_sessions:3",
        "meetings:12",
        "meetings:13",
        "meeting_action_items:32",
        "meeting_action_items:33",
        "shortlinks:3",
        "shortlinks:4",
      ].sort(),
    );
  });

  it("meetings read back with one chair, attendance, frozen minutes and the Zoom room", async () => {
    await loaded;
    const meeting = await createSqlMeetingStore(db).get("ppidk-meeting-10");
    expect(meeting?.participants).toEqual([
      { uid: "uid-rina", role: "chair" },
      { uid: "ppidk-8", role: "member" },
      { uid: "ppidk-9", role: "secretary" },
    ]);
    expect(Object.keys(meeting?.attendance ?? {}).sort()).toEqual(["ppidk-8", "uid-rina"]);
    expect(meeting?.attendance["uid-rina"]?.method).toBe("code");
    expect(meeting?.room).toEqual({ zoomRequestId: "ppidk-zoom-1", externalUrl: null });
    expect(meeting?.agenda.map((a) => a.title)).toEqual(["Pembukaan", "Anggaran"]);
    expect(meeting?.minutes).toMatchObject({
      notes: { "ppidk-agenda-21": "Dibahas.\n\nKeputusan: Disetujui." },
      source: "ai_zoom",
      approvedBy: "uid-rina",
      attendanceSnapshot: ["ppidk-8", "uid-rina"],
    });
    expect(quorumMet(meeting as NonNullable<typeof meeting>)).toBe(true);
    expect(meetingStatus(meeting as NonNullable<typeof meeting>, now)).toBe("finished");

    const cancelled = await createSqlMeetingStore(db).get("ppidk-meeting-11");
    expect(cancelled?.participants).toEqual([
      { uid: "ppidk-9", role: "chair" },
      { uid: "ppidk-8", role: "member" },
    ]);
    expect(cancelled?.room.externalUrl).toBe("https://meet.example.org/x");
    expect(cancelled?.minutes).toBeNull();
    expect(meetingStatus(cancelled as NonNullable<typeof cancelled>, now)).toBe("cancelled");
    const draft = await createSqlMeetingStore(db).get("ppidk-meeting-14");
    expect(draft?.participants).toEqual([
      { uid: "uid-rina", role: "chair" },
      { uid: "ppidk-8", role: "member" },
    ]);
    expect(draft?.minutes).toMatchObject({ source: "ai_transcript", approvedAt: null });
    const anonymous = await createSqlMeetingStore(db).get("ppidk-meeting-15");
    expect(anonymous).toMatchObject({
      createdBy: "ppidk",
      participants: [{ uid: "ppidk-9", role: "chair" }],
      minutes: {
        source: "manual",
        approvedBy: "ppidk",
        approvedAt: new Date("2026-10-10T11:30:00Z"),
      },
    });

    const items = await createSqlActionItemStore(db).listForMeeting("ppidk-meeting-10");
    expect(items.map((i) => [i.title, i.pic, i.dueOn, i.doneAt !== null])).toEqual([
      ["Kirim RAB: ke bendahara", "ppidk-8", "2026-10-20", true],
      ["Booking", "ppidk-9", null, false],
      ["Selesai tanpa waktu", "ppidk-9", null, true],
    ]);
  });

  it("Zoom bookings, capacity days and recorded sessions", async () => {
    const zoom = createSqlZoomStore(db);
    expect(await zoom.get("ppidk-zoom-1")).toMatchObject({
      status: "approved",
      passcode: "ppi",
      joinBeforeHostMinutes: 10,
      recordingUuids: ["u/1==", "u2"],
      orgUnitPath: ["ppidk-unit-40", "ppidk-unit-41"],
      requestedBy: "uid-rina",
    });
    expect((await zoom.get("ppidk-zoom-1"))?.closedAt).toEqual(new Date("2026-10-10T11:31:00Z"));
    expect(await zoom.get("ppidk-zoom-2")).toMatchObject({ status: "pending", passcode: "ppidk" });
    expect(await zoom.get("ppidk-zoom-5")).toMatchObject({
      status: "cancelled",
      passcode: "abcdefghij",
      decisionNote: "Tidak jadi",
    });
    expect(fake.docs.get("zoomCapacity/2026-10-10")).toMatchObject({
      slots: [{ id: "ppidk-zoom-1" }],
    });
    expect(await zoom.unlistedSessions(10)).toMatchObject([
      { uuid: "u2", bookingId: "ppidk-zoom-1" },
    ]);
  });

  it("short links and the message log keep their history", async () => {
    const links = await createSqlShortLinkStore(db).list();
    expect(links.map((l) => [l.provider, l.slug, l.source, l.archivedAt !== null, l.ref])).toEqual(
      expect.arrayContaining([
        ["sid", "kongres", "tools", false, "kongres"],
        ["goppi", "Zoom1", "zoom", true, "55"],
        ["sid", "notitle", "tools", false, "notitle"],
      ]),
    );
    const log = await createSqlMessageLog(db).byKeys([
      "ppidk:rapat:10:mulai:7",
      "ppidk:rapat:10:selesai:7",
      "ppidk:x_y",
      "ppidk:g",
      "ppidk:h",
      "ppidk:nobody",
    ]);
    expect([...log.values()].map((e) => [e.key, e.status, e.to])).toEqual([
      ["ppidk:rapat:10:mulai:7", "sent", "+6281234567890"],
      ["ppidk:rapat:10:selesai:7", "blocked", "+6281234567890"],
      ["ppidk:x_y", "logged", "+6281"],
      ["ppidk:g", "failed", "+6281"],
      ["ppidk:h", "failed", null],
      ["ppidk:nobody", "sent", "+6281"],
    ]);
    expect(log.get("ppidk:rapat:10:selesai:7")?.lastError).toBe("not sent before the move");
  });
});
