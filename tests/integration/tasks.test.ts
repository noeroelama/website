import { beforeEach, describe, expect, it } from "vitest";
import { createSqlTaskShareStore } from "@website/db/sql";
import type { IncomingLetter } from "@website/domain/documents";
import type { ActionItem } from "@website/domain/meetings";
import type { Program } from "@website/domain/programs";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createTasks, visibleTask } from "../../apps/admin/src/server/tasks";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlTaskShareStore>[0];
const now = new Date("2026-11-10T00:00:00Z");
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

const paths: Record<string, string[]> = {
  media: ["dirs", "media"],
  dirs: ["dirs"],
  other: ["other"],
};
const action = (id: string, pic: string, path: string[], dueOn: string | null, done = false) =>
  ({
    id,
    meetingId: "m1",
    meetingTitle: "Rapat",
    periodId: "p1",
    orgUnitPath: path,
    title: `Follow ${id}`,
    pic,
    dueOn,
    doneAt: done ? now : null,
  }) as unknown as ActionItem;
const letters = [
  {
    id: "in1",
    agendaNumber: "001/AG/XI/2026",
    subject: "Undangan",
    dispositions: [
      {
        id: "d1",
        toUserId: "rina",
        toOrgUnitId: null,
        instruction: "Hadiri",
        dueDate: "2026-11-01",
        status: "waiting",
      },
      {
        id: "d2",
        toUserId: null,
        toOrgUnitId: "media",
        instruction: "Siapkan poster",
        dueDate: null,
        status: "done",
      },
      {
        id: "d3",
        toUserId: null,
        toOrgUnitId: "other",
        instruction: "Lain",
        dueDate: null,
        status: "waiting",
      },
      {
        id: "d4",
        toUserId: null,
        toOrgUnitId: "ghost",
        instruction: "?",
        dueDate: null,
        status: "waiting",
      },
    ],
  },
] as unknown as IncomingLetter[];
const programs = [
  {
    id: "pr1",
    name: "Webinar",
    status: "running",
    pics: ["rina"],
    orgUnitPath: ["dirs", "media"],
    milestones: [{ id: "ms1", title: "Poster", dueOn: "2026-11-20", completedAt: null }],
  },
  {
    id: "pr2",
    name: "Lama",
    status: "finished",
    pics: ["rina"],
    orgUnitPath: ["dirs", "media"],
    milestones: [{ id: "ms2", title: "X", dueOn: null, completedAt: null }],
  },
] as unknown as Program[];

let fake: ReturnType<typeof fakeDb>;
let period: { id: string } | null;
const tasks = () =>
  createTasks({
    activePeriod: () => Promise.resolve(period),
    actionItemsOf: (uid) =>
      Promise.resolve([
        action("a1", uid, ["dirs", "media"], "2026-11-05"),
        action("a2", uid, ["other"], null, true),
      ]),
    actionItemsOfPeriod: () =>
      Promise.resolve([
        action("a1", "rina", ["dirs", "media"], "2026-11-05"),
        action("a3", "budi", ["other"], "2026-12-01"),
      ]),
    incoming: () => Promise.resolve(letters),
    programs: () => Promise.resolve(programs),
    unitsOf: (uid) => Promise.resolve(uid === "rina" ? ["media"] : []),
    unitPath: (id) => Promise.resolve(paths[id] ?? null),
    shares: createSqlTaskShareStore(fake.db as unknown as Db),
    findUserId: (email) => Promise.resolve(email === "budi@example.org" ? "budi" : null),
    now: () => now,
  });

beforeEach(() => {
  fake = fakeDb();
  period = { id: "p1" };
});

describe("My Tasks (G1)", () => {
  it("collects follow-ups, dispositions and milestones; overdue at read; open first", async () => {
    const mine = await tasks().mine("rina");
    expect(mine.map((t) => [t.id, t.done, t.overdue])).toEqual([
      ["disposition:in1:d1", false, true],
      ["action:a1", false, true],
      ["milestone:pr1:ms1", false, false],
      ["action:a2", true, false],
      ["disposition:in1:d2", true, false],
    ]);
    expect(mine.find((t) => t.kind === "disposition")?.href).toBe("/letters?tab=incoming");
    period = null;
    expect((await tasks().mine("rina")).map((t) => t.id)).toEqual(["action:a1", "action:a2"]);
  });
});

describe("unit boards (G1)", () => {
  const director = staff("dir", ["tasks.read", "tasks.share"], {
    type: "orgUnit",
    orgUnitId: "dirs",
  });
  const budi = staff("budi", ["events.read"]);

  it("shows the unit and the units below it to tasks.read holders", async () => {
    const board = await tasks().board(director, "dirs");
    expect(board?.map((t) => t.id)).toEqual([
      "action:a1",
      "milestone:pr1:ms1",
      "disposition:in1:d2",
    ]);
    expect(await tasks().board(budi, "dirs")).toBeNull();
    expect(await tasks().board(director, "nowhere")).toBeNull();
    period = null;
    expect(await tasks().board(director, "dirs")).toBeNull();
  });

  it("a share lets a person view the board but grants no permission: links stay hidden", async () => {
    expect(
      await tasks().share(...as(director))({
        orgUnitId: "media",
        email: "Budi@example.org",
        shared: true,
      }),
    ).toEqual({ ok: true, data: { uid: "budi", shared: true } });
    const board = await tasks().board(budi, "media");
    expect(board?.length).toBe(3);
    const shown = (board ?? []).map((t) => visibleTask(budi, t));
    expect(shown.every((t) => t.href === null)).toBe(true);
    expect(visibleTask(director, board?.[0] as NonNullable<typeof board>[number]).href).toBeNull();
    const reader = staff("x", ["meetings.read"]);
    expect(visibleTask(reader, board?.[0] as NonNullable<typeof board>[number]).href).toBe(
      "/meetings/m1",
    );
    expect(await tasks().board(budi, "dirs")).toBeNull();
    const shares = createSqlTaskShareStore(fake.db as unknown as Db);
    expect(await shares.listForUnit("media")).toEqual(["budi"]);
    expect(await shares.listForUser("budi")).toEqual(["media"]);
    expect(await shares.has("bad id", "budi")).toBe(false);
    await tasks().share(...as(director))({
      orgUnitId: "media",
      email: "budi@example.org",
      shared: false,
    });
    expect(await tasks().board(budi, "media")).toBeNull();
    expect(
      await tasks().share(...as(director))({
        orgUnitId: "media",
        email: "nobody@example.org",
        shared: true,
      }),
    ).toMatchObject({ issues: ["No account uses nobody@example.org."] });
    expect(
      await tasks().share(...as(director))({
        orgUnitId: "other",
        email: "budi@example.org",
        shared: true,
      }),
    ).toMatchObject({ error: "forbidden" });
    expect(
      await tasks().share(...as(director))({
        orgUnitId: "nowhere",
        email: "budi@example.org",
        shared: true,
      }),
    ).toMatchObject({ error: "forbidden" });
  });
});
