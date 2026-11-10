import { beforeEach, describe, expect, it } from "vitest";
import { createSqlMeetingStore, createSqlMessageLog, deleteExpired } from "@website/db/sql";
import {
  attendanceCode,
  CODE_ALPHABET,
  dueReminder,
  meetingStatus,
  normalizeCode,
  setRoom,
} from "@website/domain/meetings";
import { createMessenger } from "@website/domain/messaging";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createMeetingActions } from "../../apps/admin/src/server/meetings";
import { createAttend } from "../../apps/web/src/server/attendance";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMeetingStore>[0];
let clock = new Date("2026-11-10T01:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const planner = staff("planner", ["meetings.edit"]);
const unitPlanner = staff("unit", ["meetings.edit"], { type: "orgUnit", orgUnitId: "media" });
const chair = staff("chair", ["meetings.read"], { type: "orgUnit", orgUnitId: "other" });
const member = staff("member", ["meetings.read"], { type: "orgUnit", orgUnitId: "other" });

const people: Record<string, string> = {
  "chair@example.org": "chair",
  "member@example.org": "member",
  "sec@example.org": "sec",
};

let fake: ReturnType<typeof fakeDb>;
let sent: string[];
let seed = 0;
let currentMeeting = "";
const db = () => fake.db as unknown as Db;
const store = () => createSqlMeetingStore(db());
const actions = () =>
  createMeetingActions({
    meetings: store(),
    unitPath: (id) => Promise.resolve(id === "media" ? ["dirs", "media"] : null),
    findUserId: (email) => Promise.resolve(people[email] ?? null),
    contacts: (uids) =>
      Promise.resolve(
        new Map(
          uids
            .filter((uid) => uid !== "member")
            .map((uid) => [uid, { email: `${uid}@example.org`, phone: null }]),
        ),
      ),
    send: async (message, key) => {
      const result = await createMessenger({
        log: createSqlMessageLog(db()),
        channels: {},
        mode: "log",
        appEnv: "test",
        testRecipients: [],
        now: () => clock,
      }).send(message, key);
      if (result !== "duplicate") sent.push(key);
      return result;
    },
    adminUrl: "https://admin.example.org",
    webUrl: "https://example.org",
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i * 7 + (seed += 1)),
    zoomBooking: (id) =>
      Promise.resolve(
        id === "z-ok"
          ? { status: "approved", meetingId: currentMeeting }
          : id === "z-other"
            ? { status: "approved", meetingId: "elsewhere" }
            : null,
      ),
    now: () => clock,
    uuid: () => "u1",
  });

const input = {
  title: "Rapat kerja",
  description: "",
  orgUnitId: "media",
  startsAtLocal: "2026-11-10T19:00",
  timeZone: "Asia/Tokyo",
  durationMinutes: 90,
  agenda: ["Opening", "Budget"],
  participants: [
    { email: "chair@example.org", role: "chair" },
    { email: "member@example.org", role: "member" },
  ],
};
async function create(extra: Record<string, unknown> = {}, who = planner) {
  const result = await actions().save(...as(who))({
    ...input,
    periodId: "p1",
    version: null,
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data;
}

beforeEach(() => {
  fake = fakeDb();
  sent = [];
  clock = new Date("2026-11-10T01:00:00Z");
});

describe("meeting rules (F4)", () => {
  it("room is a Zoom booking XOR an external link: saving one clears the other", () => {
    expect(setRoom({ kind: "zoom", zoomRequestId: "z1" })).toEqual({
      zoomRequestId: "z1",
      externalUrl: null,
    });
    expect(setRoom({ kind: "link", url: "https://meet.example.org/x" })).toEqual({
      zoomRequestId: null,
      externalUrl: "https://meet.example.org/x",
    });
    expect(setRoom({ kind: "none" })).toEqual({ zoomRequestId: null, externalUrl: null });
  });

  it("codes use the unambiguous alphabet, and typing is forgiving", () => {
    const code = attendanceCode(Uint8Array.from([0, 1, 2, 30, 31, 255, 9]));
    expect(code).toHaveLength(6);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(normalizeCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code);
    expect(normalizeCode("O0I1LX")).toBeNull();
    expect(normalizeCode("ABC")).toBeNull();
    expect(() => attendanceCode(new Uint8Array(3))).toThrow();
  });

  it("status is read-time; reminders fall in their windows only", () => {
    const m = {
      startsAt: new Date("2026-11-10T10:00:00Z"),
      endsAt: new Date("2026-11-10T11:00:00Z"),
      cancelledAt: null,
    };
    expect(meetingStatus(m, new Date("2026-11-10T10:59:00Z"))).toBe("scheduled");
    expect(meetingStatus(m, new Date("2026-11-10T11:00:00Z"))).toBe("finished");
    expect(meetingStatus({ ...m, cancelledAt: new Date() }, new Date(0))).toBe("cancelled");
    expect(dueReminder(m, new Date("2026-11-10T09:44:00Z"))).toBeNull();
    expect(dueReminder(m, new Date("2026-11-10T09:45:00Z"))).toBe("start");
    expect(dueReminder(m, new Date("2026-11-10T10:00:00Z"))).toBeNull();
    expect(dueReminder(m, new Date("2026-11-10T11:30:00Z"))).toBe("end");
    expect(dueReminder(m, new Date("2026-11-10T12:00:00Z"))).toBeNull();
    expect(
      dueReminder({ ...m, cancelledAt: new Date() }, new Date("2026-11-10T09:50:00Z")),
    ).toBeNull();
  });
});

describe("meetings (F4)", () => {
  it("are scheduled in the chosen zone with exactly one chair, in the planner's scope", async () => {
    const m = await create({}, unitPlanner);
    const saved = await store().get(m.id);
    expect(saved?.startsAt.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(saved?.endsAt.toISOString()).toBe("2026-11-10T11:30:00.000Z");
    expect(saved?.orgUnitPath).toEqual(["dirs", "media"]);
    expect(saved?.participantIds).toEqual(["chair", "member"]);

    const noChair = await actions().save(...as(planner))({
      ...input,
      periodId: "p1",
      version: null,
      participants: [{ email: "member@example.org", role: "member" }],
    });
    expect(noChair).toMatchObject({ ok: false, issues: ["Name exactly one chair."] });
    const unknown = await actions().save(...as(planner))({
      ...input,
      periodId: "p1",
      version: null,
      participants: [{ email: "who@example.org", role: "chair" }],
    });
    expect(unknown).toMatchObject({ ok: false, error: "refused" });
    const region = await actions().save(...as(unitPlanner))({
      ...input,
      orgUnitId: null,
      periodId: "p1",
      version: null,
    });
    expect(region).toMatchObject({ ok: false, error: "forbidden" });
    const past = await actions().save(...as(planner))({
      ...input,
      startsAtLocal: "2026-11-09T19:00",
      periodId: "p1",
      version: null,
    });
    expect(past).toMatchObject({ ok: false, issues: ["The start time has passed."] });
  });

  it("authority comes from the role in the meeting", async () => {
    const m = await create();
    const room = { kind: "link", url: "https://meet.example.org/abc" };
    const byMember = await actions().saveRoom(...as(member))({ ...m, room });
    expect(byMember).toMatchObject({ ok: false, error: "refused" });
    const byChair = await actions().saveRoom(...as(chair))({ ...m, room });
    expect(byChair.ok).toBe(true);
    expect((await store().get(m.id))?.room).toEqual({
      zoomRequestId: null,
      externalUrl: "https://meet.example.org/abc",
    });
    currentMeeting = m.id;
    const zoomed = await actions().saveRoom(...as(chair))({
      id: m.id,
      version: byChair.ok ? byChair.data.version : 0,
      room: { kind: "zoom", zoomRequestId: "z-ok" },
    });
    expect(zoomed.ok).toBe(true);
    expect((await store().get(m.id))?.room).toEqual({ zoomRequestId: "z-ok", externalUrl: null });
    const foreign = await actions().saveRoom(...as(chair))({
      id: m.id,
      version: 3,
      room: { kind: "zoom", zoomRequestId: "z-other" },
    });
    expect(foreign).toMatchObject({
      issues: ["Choose an approved Zoom booking made for this meeting."],
    });
    const code = await actions().openCode(...as(member))({ id: m.id });
    expect(code).toMatchObject({ ok: false, error: "refused" });
  });

  it("attendance by a rotating hashed code; only participants, only while open", async () => {
    const m = await create();
    const opened = await actions().openCode(...as(chair))({ id: m.id });
    if (!opened.ok) throw new Error("no code");
    const { code } = opened.data;
    expect(opened.data.url).toBe(`https://example.org/attend/${code}`);
    expect([...fake.docs.keys()].some((k) => k.includes(code))).toBe(false);

    const attend = createAttend({ meetings: store(), now: () => clock });
    expect(await attend(null, code)).toEqual({ ok: false, error: "signin" });
    expect(await attend("member", code)).toEqual({ ok: false, error: "closed" });
    clock = new Date("2026-11-10T09:31:00Z");
    expect(await attend("member", code)).toEqual({ ok: false, error: "invalid" });
    const fresh = await actions().openCode(...as(chair))({ id: m.id });
    if (!fresh.ok) throw new Error("no code");
    expect(await attend("stranger", fresh.data.code)).toEqual({
      ok: false,
      error: "not_participant",
    });
    expect(await attend("member", fresh.data.code.toLowerCase())).toEqual({
      ok: true,
      title: "Rapat kerja",
    });
    const once = (await store().get(m.id))?.attendance["member"];
    clock = new Date("2026-11-10T09:32:00Z");
    expect(await attend("member", fresh.data.code)).toMatchObject({ ok: true });
    expect((await store().get(m.id))?.attendance["member"]).toEqual(once);
    expect(await attend("member", "ZZZZZZ")).toEqual({ ok: false, error: "invalid" });
    expect(await attend("member", "bad")).toEqual({ ok: false, error: "invalid" });
    expect((await store().get(m.id))?.version).toBe(m.version);

    clock = new Date("2026-11-10T10:00:00Z");
    const removed = await deleteExpired(db(), clock);
    expect(removed.attendanceCodes).toBe(2);
  });

  it("the chair ticks someone present once started; a cancelled meeting is history", async () => {
    const m = await create();
    const early = await actions().mark(...as(chair))({ ...m, uid: "member", present: true });
    expect(early).toMatchObject({ ok: false, error: "refused" });
    clock = new Date("2026-11-10T10:05:00Z");
    const ticked = await actions().mark(...as(chair))({ ...m, uid: "member", present: true });
    if (!ticked.ok) throw new Error("tick failed");
    expect((await store().get(m.id))?.attendance["member"]?.method).toBe("manual");
    const untick = await actions().mark(...as(chair))({
      id: m.id,
      version: ticked.data.version,
      uid: "member",
      present: false,
    });
    if (!untick.ok) throw new Error("untick failed");
    expect((await store().get(m.id))?.attendance).toEqual({});
    const cancelled = await actions().cancel(...as(chair))({
      id: m.id,
      version: untick.data.version,
      reason: "Moved",
    });
    expect(cancelled.ok).toBe(true);
    const again = await actions().cancel(...as(chair))({
      id: m.id,
      version: untick.data.version + 1,
      reason: "Again",
    });
    expect(again).toMatchObject({ ok: false, issues: ["This meeting is cancelled."] });
    expect(await actions().openCode(...as(chair))({ id: m.id })).toMatchObject({ ok: false });
  });

  it("reminders go out once per person, however often the cron job runs", async () => {
    const m = await create();
    clock = new Date("2026-11-10T09:50:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
    clock = new Date("2026-11-10T09:55:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
    clock = new Date("2026-11-10T11:31:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 2 });
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
    expect(sent).toEqual([
      `meeting:${m.id}:start:chair`,
      `meeting:${m.id}:start:member`,
      `meeting:${m.id}:end:chair`,
      `meeting:${m.id}:end:member`,
    ]);
    clock = new Date("2026-11-10T15:00:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 0, messages: 0 });
  });
});

describe("meeting edits and lists (F4)", () => {
  it("edits keep agenda ids of unchanged items and stay inside the editor's units", async () => {
    const m = await create({}, unitPlanner);
    const before = await store().get(m.id);
    const edited = await actions().save(...as(unitPlanner))({
      ...input,
      id: m.id,
      version: m.version,
      periodId: "p1",
      agenda: ["Budget", "Closing"],
      participants: [
        { email: "chair@example.org", role: "chair" },
        { email: "sec@example.org", role: "secretary" },
      ],
    });
    if (!edited.ok) throw new Error(JSON.stringify(edited));
    const after = await store().get(m.id);
    expect(after?.agenda[0]?.id).toBe(before?.agenda[1]?.id);
    expect(after?.agenda[1]?.title).toBe("Closing");
    expect(after?.participantIds).toEqual(["chair", "sec"]);

    const moved = await actions().save(...as(unitPlanner))({
      ...input,
      id: m.id,
      version: edited.data.version,
      periodId: "p1",
      orgUnitId: null,
    });
    expect(moved).toMatchObject({
      ok: false,
      issues: ["You can only schedule meetings of your own unit."],
    });
    const ghost = await actions().save(...as(planner))({
      ...input,
      id: "ghost",
      version: 1,
      periodId: "p1",
    });
    expect(ghost).toMatchObject({ ok: false, error: "forbidden" });

    clock = new Date("2026-11-10T12:00:00Z");
    const late = await actions().save(...as(planner))({
      ...input,
      id: m.id,
      version: edited.data.version,
      periodId: "p1",
    });
    expect(late).toMatchObject({ ok: false, issues: ["This meeting is finished."] });
  });

  it("participants: one chair, one secretary at most, nobody twice", async () => {
    const save = (participants: Array<{ email: string; role: string }>) =>
      actions().save(...as(planner))({ ...input, periodId: "p1", version: null, participants });
    expect(
      await save([
        { email: "chair@example.org", role: "chair" },
        { email: "chair@example.org", role: "member" },
      ]),
    ).toMatchObject({ issues: ["A person is listed twice."] });
    expect(
      await save([
        { email: "chair@example.org", role: "chair" },
        { email: "member@example.org", role: "secretary" },
        { email: "sec@example.org", role: "secretary" },
      ]),
    ).toMatchObject({ issues: ["Name at most one secretary."] });
    const many = Array.from({ length: 301 }, (_, i) => ({
      email: `p${i}@example.org`,
      role: "member",
    }));
    expect(await save(many)).toMatchObject({ error: "invalid_input" });
    expect(
      await actions().save(...as(planner))({
        ...input,
        timeZone: "Mars/Base",
        periodId: "p1",
        version: null,
      }),
    ).toMatchObject({ error: "invalid_input", fields: { timeZone: "Choose a time zone." } });
  });

  it("lists per period, per participant and per time range; who may see one", async () => {
    const a = await create();
    await create({
      title: "Later",
      startsAtLocal: "2026-11-12T19:00",
      participants: [{ email: "sec@example.org", role: "chair" }],
    });
    await create({
      title: "Latest",
      startsAtLocal: "2026-11-13T19:00",
      participants: [{ email: "sec@example.org", role: "chair" }],
    });
    fake.docs.set("meetings/gone", { ...fake.docs.get(`meetings/${a.id}`), deletedAt: new Date() });
    expect((await store().listForPeriod("p1")).map((m) => m.title)).toEqual([
      "Rapat kerja",
      "Later",
      "Latest",
    ]);
    expect((await store().listForUser("sec")).map((m) => m.title)).toEqual(["Latest", "Later"]);
    expect(
      (
        await store().listBetween(
          new Date("2026-11-10T00:00:00Z"),
          new Date("2026-11-11T00:00:00Z"),
        )
      ).map((m) => m.id),
    ).toEqual([a.id]);
    const meeting = await store().get(a.id);
    if (!meeting) throw new Error("missing");
    const { canSeeMeeting } = await import("../../apps/admin/src/server/meetings");
    expect(canSeeMeeting(member, meeting)).toBe(true);
    expect(canSeeMeeting(staff("x", ["meetings.read"]), meeting)).toBe(true);
    expect(canSeeMeeting(staff("y", ["events.read"]), meeting)).toBe(false);
    expect(await store().get("bad id")).toBeNull();
  });

  it("a manual tick also refuses strangers and cancelled meetings", async () => {
    const m = await create();
    clock = new Date("2026-11-10T10:05:00Z");
    const stranger = await actions().mark(...as(chair))({ ...m, uid: "nobody", present: true });
    expect(stranger).toMatchObject({ issues: ["You are not a participant of this meeting."] });
    fake.docs.set(`meetings/${m.id}`, { ...fake.docs.get(`meetings/${m.id}`), cancelledAt: clock });
    const attend = createAttend({ meetings: store(), now: () => clock });
    const opened = await actions().openCode(...as(planner))({ id: "missing" });
    expect(opened).toMatchObject({ ok: false, issues: ["This meeting does not exist."] });
    await store().saveCode("ABCDEF", m.id, new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEF")).toEqual({ ok: false, error: "closed" });
    await store().saveCode("ABCDEG", "missing", new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEG")).toEqual({ ok: false, error: "closed" });
    fake.docs.set("meetings/trash", { ...fake.docs.get(`meetings/${m.id}`), deletedAt: clock });
    await store().saveCode("ABCDEH", "trash", new Date("2026-11-10T11:00:00Z"));
    expect(await attend("member", "ABCDEH")).toEqual({ ok: false, error: "closed" });
    const broken = createAttend({
      meetings: {
        findCode: () => Promise.resolve("m"),
        attend: () => Promise.reject(new Error("database down")),
      },
      now: () => clock,
    });
    await expect(broken("member", "ABCDEF")).rejects.toThrow("database down");
    expect(
      await actions().save(...as(planner))({
        ...input,
        orgUnitId: "nowhere",
        periodId: "p1",
        version: null,
      }),
    ).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("a cancelled meeting gets no reminders", async () => {
    const m = await create();
    await actions().cancel(...as(chair))({ ...m, reason: "Moved" });
    clock = new Date("2026-11-10T09:50:00Z");
    expect(await actions().sendReminders()).toEqual({ meetings: 1, messages: 0 });
  });
});
