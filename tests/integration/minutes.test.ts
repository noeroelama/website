import { beforeEach, describe, expect, it } from "vitest";
import { createSqlActionItemStore, createSqlMeetingStore } from "@website/db/sql";
import { isOverdue, mergeDraft, quorumMet, type Meeting } from "@website/domain/meetings";
import type { ReportPdfInput } from "@website/pdf";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createMinutesActions, createMinutesFileRoute } from "../../apps/admin/src/server/minutes";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMeetingStore>[0];
let clock = new Date("2026-11-10T12:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "orgUnit", orgUnitId: "elsewhere" },
): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const chair = staff("chair", ["meetings.read"]);
const secretary = staff("sec", ["meetings.read"]);
const member = staff("member", ["meetings.read"]);
const approver = staff("boss", ["meetings.approve_minutes"], { type: "global" });

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const meetings = () => createSqlMeetingStore(db());
const items = () => createSqlActionItemStore(db());
const actions = () =>
  createMinutesActions({ meetings: meetings(), actionItems: items(), now: () => clock });

const meetingDoc = {
  periodId: "p1",
  title: "Rapat kerja",
  description: "",
  orgUnitId: "media",
  orgUnitPath: ["dirs", "media"],
  startsAt: new Date("2026-11-10T10:00:00Z"),
  endsAt: new Date("2026-11-10T11:00:00Z"),
  timeZone: "Asia/Tokyo",
  agenda: [
    { id: "a1", title: "Opening" },
    { id: "a2", title: "Budget" },
  ],
  participants: [
    { uid: "chair", role: "chair" },
    { uid: "sec", role: "secretary" },
    { uid: "member", role: "member" },
  ],
  participantIds: ["chair", "sec", "member"],
  room: { zoomRequestId: null, externalUrl: null },
  attendance: { chair: { at: new Date("2026-11-10T10:00:00Z"), method: "code" } },
  cancelledAt: null,
  cancelReason: null,
  createdBy: "chair",
  minutes: null,
  version: 1,
  createdAt: clock,
  updatedAt: clock,
  deletedAt: null,
};
const notes = { a1: "Opened at 19:00.", a2: "" };

beforeEach(() => {
  fake = fakeDb();
  clock = new Date("2026-11-10T12:00:00Z");
  fake.docs.set("meetings/m1", { ...meetingDoc });
});

describe("minutes (F5)", () => {
  it("the secretary writes, the chair approves; approval locks and freezes attendance", async () => {
    const byMember = await actions().save(...as(member))({
      id: "m1",
      version: 1,
      notes,
      other: "",
      quorum: 2,
    });
    expect(byMember).toMatchObject({ ok: false, error: "refused" });
    const written = await actions().save(...as(secretary))({
      id: "m1",
      version: 1,
      notes: { ...notes, gone: "old item" },
      other: "AOB",
      quorum: 2,
    });
    if (!written.ok) throw new Error(JSON.stringify(written));
    const saved = (await meetings().get("m1")) as Meeting;
    expect(saved.minutes?.notes).toEqual({ a1: "Opened at 19:00." });
    expect(saved.minutes?.source).toBe("manual");
    expect(quorumMet(saved)).toBe(false);

    const bySecretary = await actions().approve(...as(secretary))({ id: "m1", version: 2 });
    expect(bySecretary).toMatchObject({ ok: false, error: "refused" });
    const approved = await actions().approve(...as(chair))({ id: "m1", version: 2 });
    if (!approved.ok) throw new Error(JSON.stringify(approved));
    const locked = (await meetings().get("m1")) as Meeting;
    expect(locked.minutes?.attendanceSnapshot).toEqual(["chair"]);
    expect(locked.minutes?.approvedBy).toBe("chair");

    const again = await actions().save(...as(secretary))({
      id: "m1",
      version: 3,
      notes,
      other: "",
      quorum: null,
    });
    expect(again).toMatchObject({ ok: false, issues: ["The minutes are approved and locked."] });
    const { markAttendance } = await import("@website/domain/meetings");
    expect(() => markAttendance(locked, "member", "manual", clock)).toThrow("attendance is frozen");
    expect(() => mergeDraft(locked, { a2: "x" }, "ai_transcript")).toThrow("locked");
  });

  it("approval needs minutes and a meeting that took place; approve_minutes holders may approve", async () => {
    expect(await actions().approve(...as(approver))({ id: "m1", version: 1 })).toMatchObject({
      issues: ["Write the minutes first."],
    });
    clock = new Date("2026-11-10T09:00:00Z");
    await actions().save(...as(secretary))({
      id: "m1",
      version: 1,
      notes,
      other: "",
      quorum: null,
    });
    expect(await actions().approve(...as(approver))({ id: "m1", version: 2 })).toMatchObject({
      issues: ["Minutes can be approved once the meeting has taken place."],
    });
    clock = new Date("2026-11-10T12:00:00Z");
    expect((await actions().approve(...as(approver))({ id: "m1", version: 2 })).ok).toBe(true);
    expect(quorumMet((await meetings().get("m1")) as Meeting)).toBeNull();
    fake.docs.set("meetings/m1", { ...meetingDoc, cancelledAt: clock });
    expect(
      await actions().save(...as(chair))({ id: "m1", version: 1, notes, other: "", quorum: null }),
    ).toMatchObject({ issues: ["This meeting is cancelled."] });
  });

  it("a machine draft fills only empty agenda items", () => {
    const meeting = {
      ...(meetingDoc as unknown as Meeting),
      minutes: {
        notes: { a1: "Typed by a person." },
        other: "",
        quorum: 3,
        source: "manual" as const,
        approvedAt: null,
        approvedBy: null,
        attendanceSnapshot: null,
      },
    };
    const merged = mergeDraft(
      meeting,
      { a1: "Machine", a2: " Budget agreed. ", zz: "?" },
      "ai_transcript",
    );
    expect(merged.minutes?.notes).toEqual({ a1: "Typed by a person.", a2: "Budget agreed." });
    expect(merged.minutes?.source).toBe("manual");
    expect(merged.minutes?.quorum).toBe(3);
    const fresh = mergeDraft({ ...meeting, minutes: null }, { a2: "Budget" }, "ai_zoom");
    expect(fresh.minutes?.source).toBe("ai_zoom");
    expect(quorumMet(merged)).toBe(false);
  });
});

describe("action items (F5)", () => {
  it("the PIC must be a participant; items stay editable after approval; the PIC marks done", async () => {
    const stranger = await actions().saveItem(...as(chair))({
      version: null,
      meetingId: "m1",
      title: "Send the budget",
      pic: "nobody",
      dueOn: "2026-11-20",
    });
    expect(stranger).toMatchObject({ issues: ["The PIC must be a participant of the meeting."] });
    const byMember = await actions().saveItem(...as(member))({
      version: null,
      meetingId: "m1",
      title: "Send the budget",
      pic: "member",
      dueOn: null,
    });
    expect(byMember).toMatchObject({ ok: false, error: "refused" });
    const created = await actions().saveItem(...as(chair))({
      version: null,
      meetingId: "m1",
      title: "Send the budget",
      pic: "member",
      dueOn: "2026-11-20",
    });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const item = await items().get(created.data.id);
    expect(item).toMatchObject({ meetingTitle: "Rapat kerja", orgUnitPath: ["dirs", "media"] });

    fake.docs.set("meetings/m1", {
      ...meetingDoc,
      minutes: {
        notes: {},
        other: "",
        quorum: null,
        source: "manual",
        approvedAt: clock,
        approvedBy: "chair",
        attendanceSnapshot: [],
      },
    });
    const edited = await actions().saveItem(...as(secretary))({
      id: created.data.id,
      version: 1,
      meetingId: "m1",
      title: "Send the final budget",
      pic: "member",
      dueOn: "2026-11-20",
    });
    if (!edited.ok) throw new Error(JSON.stringify(edited));
    expect(
      await actions().setItemDone(...as(staff("other", ["meetings.read"])))({
        id: created.data.id,
        version: 2,
        done: true,
      }),
    ).toMatchObject({ ok: false, error: "refused" });
    const done = await actions().setItemDone(...as(member))({
      id: created.data.id,
      version: 2,
      done: true,
    });
    if (!done.ok) throw new Error("done failed");
    const doneItem = await items().get(created.data.id);
    expect(doneItem?.doneAt).toEqual(clock);
    expect(isOverdue(doneItem as NonNullable<typeof doneItem>, "2026-12-01")).toBe(false);
    const reopened = await actions().setItemDone(...as(chair))({
      id: created.data.id,
      version: 3,
      done: false,
    });
    if (!reopened.ok) throw new Error("reopen failed");
    expect(
      isOverdue((await items().get(created.data.id)) as NonNullable<typeof doneItem>, "2026-12-01"),
    ).toBe(true);
    expect((await items().listForPic("member")).map((i) => i.title)).toEqual([
      "Send the final budget",
    ]);
    expect(await items().listForPeriod("p1")).toHaveLength(1);

    expect(
      await actions().removeItem(...as(member))({ id: created.data.id, version: 4 }),
    ).toMatchObject({ ok: false, error: "refused" });
    const second = await actions().saveItem(...as(chair))({
      version: null,
      meetingId: "m1",
      title: "Book the venue",
      pic: "sec",
      dueOn: null,
    });
    expect(second.ok).toBe(true);
    expect((await items().listForMeeting("m1")).map((i) => i.title)).toEqual([
      "Send the final budget",
      "Book the venue",
    ]);
    expect((await actions().removeItem(...as(chair))({ id: created.data.id, version: 4 })).ok).toBe(
      true,
    );
    expect((await items().listForMeeting("m1")).map((i) => i.title)).toEqual(["Book the venue"]);

    fake.docs.set("meetings/m1", { ...meetingDoc, cancelledAt: clock });
    expect(
      await actions().saveItem(...as(chair))({
        version: null,
        meetingId: "m1",
        title: "Late",
        pic: "member",
        dueOn: null,
      }),
    ).toMatchObject({ issues: ["This meeting is cancelled."] });
    expect(
      await actions().saveItem(...as(chair))({
        version: null,
        meetingId: "ghost",
        title: "Late",
        pic: "member",
        dueOn: null,
      }),
    ).toMatchObject({ issues: ["This meeting does not exist."] });
  });
});

describe("minutes PDF (F5)", () => {
  it("is rendered on request for whoever may see the meeting", async () => {
    let sheet: ReportPdfInput | null = null;
    const route = createMinutesFileRoute({
      getMeeting: (id) => meetings().get(id),
      listItems: () =>
        Promise.resolve([
          { title: "Budget", pic: "member", dueOn: "2026-11-20", doneAt: clock },
          { title: "Venue", pic: "sec", dueOn: null, doneAt: null },
        ]),
      names: (uids) => Promise.resolve(new Map(uids.map((u) => [u, u.toUpperCase()]))),
      render: (input) => {
        sheet = input;
        return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
      },
      now: () => clock,
    });
    expect((await route("m1", null)).status).toBe(401);
    expect(
      (await route("m1", { kind: "user", userId: "v", active: true, assignments: [] })).status,
    ).toBe(403);
    expect((await route("m1", staff("x", ["events.read"]))).status).toBe(404);
    expect((await route("bad id", member)).status).toBe(404);
    const response = await route("m1", member);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(sheet).toMatchObject({
      title: "Notulen / Minutes: Rapat kerja",
      footer: expect.stringContaining("Draft: not approved yet") as string,
    });
    const text = JSON.stringify(sheet);
    expect(text).toContain("CHAIR (Chair): present");
    expect(text).toContain("MEMBER (Participant): absent");
    expect(text).toContain("Quorum: not set");
    expect(text).toContain("[done] Budget — MEMBER, due 2026-11-20");

    fake.docs.set("meetings/m1", {
      ...meetingDoc,
      minutes: {
        notes: { a1: "Opened" },
        other: "AOB",
        quorum: 1,
        source: "manual",
        approvedAt: clock,
        approvedBy: "chair",
        attendanceSnapshot: ["chair"],
      },
    });
    await route("m1", member);
    const approved = JSON.stringify(sheet);
    expect(approved).toContain("Quorum 1: met (1 present)");
    expect(approved).toContain("Approved by CHAIR on 2026-11-10");
    expect(approved).toContain("AOB");
    fake.docs.set("meetings/m1", {
      ...meetingDoc,
      minutes: {
        notes: {},
        other: "",
        quorum: 2,
        source: "manual",
        approvedAt: null,
        approvedBy: null,
        attendanceSnapshot: null,
      },
    });
    await route("m1", member);
    expect(JSON.stringify(sheet)).toContain("Quorum 2: not met (1 present)");
    const empty = createMinutesFileRoute({
      getMeeting: (id) => meetings().get(id),
      listItems: () => Promise.resolve([]),
      names: () => Promise.resolve(new Map()),
      render: (input) => {
        sheet = input;
        return Promise.resolve(new Uint8Array());
      },
      now: () => clock,
    });
    fake.docs.set("meetings/m1", { ...meetingDoc });
    await empty("m1", member);
    expect(JSON.stringify(sheet)).toContain("member (Participant)");
  });
});
