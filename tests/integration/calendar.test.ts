import { beforeEach, describe, expect, it } from "vitest";
import { createSqlCalendarStore } from "@website/db/sql";
import type { Meeting } from "@website/domain/meetings";
import type { LpjReport, Program } from "@website/domain/programs";
import { calendarItems, foldLine, toIcs } from "@website/domain/tasks";
import type { ZoomRequest } from "@website/domain/zoom";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createCalendar } from "../../apps/admin/src/server/calendar";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlCalendarStore>[0];
const now = new Date("2026-11-05T00:00:00Z");
const staff = (
  userId: string,
  permissions: string[],
  scope: Scope = { type: "global" },
  active = true,
): Principal => ({
  kind: "user",
  userId,
  active,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

const meeting = (id: string, start: string, extra: Partial<Meeting> = {}) =>
  ({
    id,
    title: `Rapat ${id}`,
    startsAt: new Date(start),
    endsAt: new Date(new Date(start).getTime() + 3_600_000),
    timeZone: "Asia/Jakarta",
    cancelledAt: null,
    room: { zoomRequestId: null, externalUrl: null },
    participantIds: ["rina"],
    orgUnitPath: ["media"],
    ...extra,
  }) as unknown as Meeting;
const zoom = (id: string, start: string, status = "approved") =>
  ({
    id,
    topic: `Zoom ${id}`,
    startsAt: new Date(start),
    endsAt: new Date(new Date(start).getTime() + 3_600_000),
    timeZone: "Asia/Tokyo",
    status,
    requestedBy: "rina",
    orgUnitPath: ["media"],
  }) as unknown as ZoomRequest;
const programs = [
  {
    id: "pr1",
    name: "Webinar",
    status: "running",
    pics: ["rina"],
    orgUnitPath: ["media"],
    milestones: [
      { id: "m1", title: "Poster", dueOn: "2026-11-20", completedAt: null },
      { id: "m2", title: "Done", dueOn: "2026-11-21", completedAt: now },
      { id: "m3", title: "No date", dueOn: null, completedAt: null },
    ],
  },
  {
    id: "pr2",
    name: "Draft",
    status: "proposed",
    pics: ["rina"],
    orgUnitPath: ["media"],
    milestones: [{ id: "m4", title: "X", dueOn: "2026-11-22", completedAt: null }],
  },
  {
    id: "pr3",
    name: "Other",
    status: "running",
    pics: ["budi"],
    orgUnitPath: ["other"],
    milestones: [{ id: "m5", title: "Y", dueOn: "2026-11-23", completedAt: null }],
  },
] as unknown as Program[];
const lpj = [
  {
    id: "l1",
    plan: { name: "Webinar" },
    dueOn: "2026-11-25",
    status: "draft",
    pics: ["rina"],
    orgUnitPath: ["media"],
  },
  {
    id: "l2",
    plan: { name: "Done" },
    dueOn: "2026-11-26",
    status: "approved",
    pics: ["rina"],
    orgUnitPath: ["media"],
  },
  {
    id: "l3",
    plan: { name: "Other" },
    dueOn: "2026-11-27",
    status: "draft",
    pics: ["budi"],
    orgUnitPath: ["other"],
  },
] as unknown as LpjReport[];

let fake: ReturnType<typeof fakeDb>;
let principals: Record<string, Principal>;
const store = () => createSqlCalendarStore(fake.db as unknown as Db);
const cal = (secret: string | null = "calendar-secret-calendar-secret-123456") =>
  createCalendar({
    meetings: () =>
      Promise.resolve([
        meeting("a", "2026-11-17T03:00:00Z"),
        // 2026-11-17 23:30 UTC is already the 18th in Jakarta (a holiday there).
        meeting("b", "2026-11-17T23:30:00Z", { room: { zoomRequestId: "z1", externalUrl: null } }),
        meeting("c", "2026-11-19T03:00:00Z", { cancelledAt: now }),
        meeting("d", "2026-11-19T03:00:00Z", { participantIds: ["budi"], orgUnitPath: ["other"] }),
        // Same start as the pending Zoom booking z2: ordered by title.
        meeting("e", "2026-11-20T00:00:00Z", { room: { zoomRequestId: "z9", externalUrl: null } }),
      ]),
    zoom: () =>
      Promise.resolve([
        {
          ...zoom("z4", "2026-11-21T00:00:00Z"),
          requestedBy: "budi",
          orgUnitPath: ["other"],
        },
        zoom("z1", "2026-11-17T02:30:00Z"),
        zoom("z2", "2026-11-20T00:00:00Z", "pending"),
        zoom("z3", "2026-11-20T00:00:00Z", "rejected"),
      ]),
    zoomSettings: () => Promise.resolve({ licences: 1, concurrentPerLicence: 1 }),
    programs: () => Promise.resolve(programs),
    lpj: () => Promise.resolve(lpj),
    store: store(),
    principalOf: (uid) => Promise.resolve(principals[uid] ?? null),
    secret,
    adminUrl: "https://admin.example.org",
    now: () => now,
  });

beforeEach(async () => {
  fake = fakeDb();
  principals = {
    rina: staff("rina", ["calendar.read"], { type: "orgUnit", orgUnitId: "media" }),
    gone: staff("gone", ["calendar.read"], { type: "global" }, false),
    member: { kind: "user", userId: "member", active: true, assignments: [] },
  };
  await store().saveHoliday(null, { date: "2026-11-18", name: "Libur" }, (id) => ({ id }) as never);
});

describe("calendar (G2)", () => {
  it("shows what the person may see, with holiday (in the item's zone) and Zoom warnings", async () => {
    const items = await cal().items(
      principals["rina"] as Principal,
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-30T23:59:59Z"),
    );
    expect(items.map((i) => [i.id, i.warnings])).toEqual([
      ["zoom:z1", []],
      ["meeting:a", ["No Zoom licence is free at this time"]],
      ["meeting:b", ["Holiday: Libur"]],
      ["holiday:" + (items.find((i) => i.kind === "holiday")?.id.split(":")[1] ?? ""), []],
      ["milestone:pr1:m1", []],
      ["meeting:e", []],
      ["zoom:z2", []],
      ["lpj:l1", []],
    ]);
    expect(items.find((i) => i.id === "zoom:z2")?.title).toContain("waiting for approval");
    const narrow = await cal().items(
      principals["rina"] as Principal,
      new Date("2026-11-20T00:00:00Z"),
      new Date("2026-11-20T23:59:59Z"),
    );
    expect(narrow.map((i) => i.id)).toEqual(["milestone:pr1:m1", "meeting:e", "zoom:z2"]);
  });

  it("the .ics feed: CRLF, escaping, all-day with an exclusive end, 75-octet folding", () => {
    const ics = toIcs(
      calendarItems({
        meetings: [
          meeting("x", "2026-11-17T03:00:00Z", {
            title: "Rapat; kerja, \\ final\nbaru",
          }),
        ],
        zoom: [],
        programs: [],
        lpj: [],
        holidays: [{ id: "h1", date: "2026-12-31", name: "Tahun baru" }],
        zoomCapacity: 0,
      }),
      { name: "PPIDK", baseUrl: "https://admin.example.org", now },
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ics).toContain("SUMMARY:[Meeting] Rapat\\; kerja\\, \\\\ final\\nbaru");
    expect(ics).toContain("DTSTART:20261117T030000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DESCRIPTION:No Zoom licence is free at this time");
    const long = foldLine(`SUMMARY:${"é".repeat(60)}`);
    const parts = long.split("\r\n ");
    expect(parts.length).toBe(2);
    expect(Buffer.byteLength(parts[0] as string)).toBeLessThanOrEqual(75);
    expect(parts.join("")).toBe(`SUMMARY:${"é".repeat(60)}`);
    expect(
      foldLine("€".repeat(30))
        .split("\r\n ")
        .map((p) => Buffer.byteLength(p)),
    ).toEqual([75, 15]);
    expect(
      foldLine("😀".repeat(40))
        .split("\r\n ")
        .every((p) => Buffer.byteLength(p) <= 75),
    ).toBe(true);
  });

  it("the feed equals the screen; revoke, unknown, inactive and no-access → 404", async () => {
    const url = (await cal().feedUrl("rina")) as string;
    const file = url.split("/calendar/")[1] as string;
    const response = await cal().feed(file);
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    const body = await response.text();
    for (const id of ["meeting:a", "meeting:b", "zoom:z1", "milestone:pr1:m1", "lpj:l1"])
      expect(body).toContain(id);
    expect(body).not.toContain("meeting:d");
    expect(body).not.toContain("milestone:pr3");

    const revoked = await cal().revokeFeed(...as(principals["rina"] as Principal))({});
    expect(revoked.ok).toBe(true);
    expect((await cal().feed(file)).status).toBe(404);
    const fresh = ((await cal().feedUrl("rina")) as string).split("/calendar/")[1] as string;
    expect((await cal().feed(fresh)).status).toBe(200);

    expect((await cal().feed("rina.short.ics")).status).toBe(404);
    expect((await cal().feed(`${fresh.slice(0, -5)}x.ics`)).status).toBe(404);
    for (const uid of ["gone", "member", "nobody"]) {
      const f = ((await cal().feedUrl(uid)) as string).split("/calendar/")[1] as string;
      expect((await cal().feed(f)).status).toBe(404);
    }
    expect(await cal(null).feedUrl("rina")).toBeNull();
    expect((await cal(null).feed(fresh)).status).toBe(404);
  });

  it("holidays are managed with calendar.holidays", async () => {
    const editor = staff("hr", ["calendar.holidays"]);
    const added = await cal().addHoliday(...as(editor))({ date: "2026-12-25", name: "Natal" });
    if (!added.ok) throw new Error("add failed");
    expect((await store().listHolidays()).map((h) => h.date)).toEqual(["2026-11-18", "2026-12-25"]);
    expect((await cal().removeHoliday(...as(editor))({ id: added.data.id })).ok).toBe(true);
    expect(await store().listHolidays()).toHaveLength(1);
    expect(
      await cal().addHoliday(...as(principals["rina"] as Principal))({
        date: "2026-12-25",
        name: "Natal",
      }),
    ).toMatchObject({ error: "forbidden" });
    expect(await store().feedVersion("nobody")).toBe(1);
  });
});
