import { beforeEach, describe, expect, it } from "vitest";
import { createSqlProgramStore } from "@website/db/sql";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { canManageProgram, createProgramActions } from "../../apps/admin/src/server/programs";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlProgramStore>[0];
let clock = new Date("2026-11-04T03:00:00Z");
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

const director = staff("dir", ["programs.edit"], { type: "orgUnit", orgUnitId: "media" });
const sekjen = staff("sekjen", ["programs.approve"]);
const pic = staff("pic", ["programs.read"]);
const officer = staff("officer", ["programs.read"]);

let fake: ReturnType<typeof fakeDb>;
let uuids = 0;
const opened: string[] = [];
const db = () => fake.db as unknown as Db;
const store = () => createSqlProgramStore(db());
const actions = () =>
  createProgramActions({
    programs: store(),
    unitPath: (id) => {
      const unit = fake.docs.get(`orgUnits/${id}`) as { path: string[] } | undefined;
      return Promise.resolve(unit ? [...unit.path, id] : null);
    },
    findUserId: (email) =>
      Promise.resolve({ "pic@example.org": "pic", "rina@example.org": "rina" }[email] ?? null),
    afterLpj: (lpj) => {
      opened.push(lpj.id);
      return Promise.resolve();
    },
    now: () => clock,
    uuid: () => `m${(uuids += 1)}`,
  });

const plan = {
  name: "Webinar series",
  goal: "Share study tips",
  orgUnitId: "media",
  budgets: [
    { amountMinor: 50000, currency: "JPY" },
    { amountMinor: 1000000, currency: "IDR" },
  ],
};

async function ok<T>(result: Promise<{ ok: boolean; data?: T }>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data as T;
}
type Step = { version: number; status: string; progress: number };

async function proposal(extra: Record<string, unknown> = {}) {
  return ok<{ id: string; version: number }>(
    actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, ...extra },
      picEmails: ["PIC@example.org"],
    }),
  );
}

beforeEach(() => {
  fake = fakeDb();
  uuids = 0;
  opened.length = 0;
  clock = new Date("2026-11-04T03:00:00Z");
  fake.docs.set("periods/p1", { status: "active", deletedAt: null });
  fake.docs.set("periods/p0", { status: "archived", deletedAt: null });
  fake.docs.set("orgUnits/media", { periodId: "p1", path: ["dirs"], deletedAt: null });
  fake.docs.set("orgUnits/edu", { periodId: "p1", path: ["dirs"], deletedAt: null });
  fake.docs.set("objectives/o1", {
    periodId: "p1",
    deletedAt: null,
    keyResults: [{ id: "kr1" }],
  });
});

describe("programme plans (E2)", () => {
  it("a unit proposes with PICs (by e-mail), budgets per currency and a key result", async () => {
    const { id } = await proposal({ objectiveId: "o1", keyResultId: "kr1" });
    const saved = await store().get(id);
    expect(saved).toMatchObject({
      status: "proposed",
      pics: ["pic"],
      orgUnitPath: ["dirs", "media"],
      keyResultId: "kr1",
      progressPercent: 0,
      createdBy: "dir",
      budgets: plan.budgets,
    });
    expect(await store().listForPeriod("p1")).toHaveLength(1);
  });

  it("refuses an unknown PIC, a key result of another period, an archived period", async () => {
    const unknown = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan,
      picEmails: ["ghost@example.org"],
    });
    expect(unknown).toMatchObject({ ok: false, issues: ["No account uses ghost@example.org."] });
    for (const link of [
      { objectiveId: "o1", keyResultId: "nope" },
      { objectiveId: "ghost", keyResultId: "kr1" },
    ]) {
      const result = await actions().save(...as(director))({
        version: null,
        periodId: "p1",
        plan: { ...plan, ...link },
        picEmails: [],
      });
      expect(result).toMatchObject({ ok: false, issues: ["Choose a key result of this period."] });
    }
    fake.docs.set("orgUnits/old", { periodId: "p0", path: [], deletedAt: null });
    const archived = await actions().save(...as(staff("x", ["programs.edit"])))({
      version: null,
      periodId: "p0",
      plan: { ...plan, orgUnitId: "old" },
      picEmails: [],
    });
    expect(archived).toMatchObject({ ok: false, error: "refused" });
  });

  it("unit scope: a director plans only for their own unit", async () => {
    const other = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "edu" },
      picEmails: [],
    });
    expect(other).toMatchObject({ ok: false, error: "forbidden" });
    const { id, version } = await proposal();
    const moved = await actions().save(...as(director))({
      id,
      version,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "edu" },
      picEmails: [],
    });
    expect(moved).toMatchObject({ ok: false, error: "refused" });
    const edited = await ok<{ version: number }>(
      actions().save(...as(director))({
        id,
        version,
        periodId: "p1",
        plan: { ...plan, name: "Webinar series 2" },
        picEmails: ["pic@example.org", "rina@example.org", "pic@example.org"],
      }),
    );
    expect(edited.version).toBe(2);
    expect((await store().get(id))?.pics).toEqual(["pic", "rina"]);
    const unknownUnit = await actions().save(...as(director))({
      version: null,
      periodId: "p1",
      plan: { ...plan, orgUnitId: "ghost" },
      picEmails: [],
    });
    expect(unknownUnit).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("running a programme: the PIC rule", () => {
  it("the PIC (no edit role) runs it; another reader cannot; the unit director can", async () => {
    const { id } = await proposal();
    let v = (await ok<Step>(actions().approve(...as(sekjen))({ id, version: 1 }))).version;
    const intruder = await actions().saveMilestone(...as(officer))({
      id,
      version: v,
      title: "Committee",
      weight: 1,
    });
    expect(intruder).toMatchObject({ ok: false, error: "refused" });
    const noRole = await actions().saveMilestone(...as(staff("y", ["okr.read"])))({
      id,
      version: v,
      title: "Committee",
    });
    expect(noRole).toMatchObject({ ok: false, error: "forbidden" });

    let step = await ok<Step>(
      actions().saveMilestone(...as(pic))({ id, version: v, title: "Committee", weight: 1 }),
    );
    step = await ok<Step>(
      actions().saveMilestone(...as(director))({
        id,
        version: step.version,
        title: "Hold the event",
        weight: 3,
      }),
    );
    v = (await ok<Step>(actions().start(...as(pic))({ id, version: step.version }))).version;
    step = await ok<Step>(
      actions().markMilestone(...as(pic))({ id, version: v, milestoneId: "m1", done: true }),
    );
    expect(step).toMatchObject({ status: "running", progress: 25 });
    step = await ok<Step>(
      actions().saveMilestone(...as(pic))({
        id,
        version: step.version,
        milestoneId: "m1",
        title: "Committee",
        weight: 3,
      }),
    );
    expect(step.progress).toBe(50);
    expect((await store().get(id))?.progressPercent).toBe(50);
    step = await ok<Step>(
      actions().deleteMilestone(...as(pic))({ id, version: step.version, milestoneId: "m2" }),
    );
    expect(step.progress).toBe(100);
    step = await ok<Step>(
      actions().health(...as(pic))({
        id,
        version: step.version,
        health: "at_risk",
        reason: "Venue unsure",
      }),
    );
    const noReason = await actions().health(...as(pic))({
      id,
      version: step.version,
      health: "on_track",
      reason: "",
    });
    expect(noReason).toMatchObject({ ok: false, error: "invalid_input" });
    step = await ok<Step>(actions().finish(...as(pic))({ id, version: step.version }));
    expect(step.status).toBe("finished");
    expect(opened).toEqual([id]);
    const audit = [...fake.docs.entries()].filter(([path]) => path.startsWith("auditLogs/"));
    expect(audit.length).toBeGreaterThanOrEqual(8);
  });

  it("canManageProgram: listed PIC or programs.edit of the unit; inactive never", () => {
    const program = { pics: ["pic"], orgUnitPath: ["dirs", "media"] };
    expect(canManageProgram(pic, program)).toBe(true);
    expect(canManageProgram(director, program)).toBe(true);
    expect(canManageProgram(officer, program)).toBe(false);
    expect(canManageProgram({ ...pic, active: false }, program)).toBe(false);
  });

  it("approve, return with a note and cancel need programs.approve", async () => {
    const { id } = await proposal();
    const self = await actions().approve(...as(director))({ id, version: 1 });
    expect(self).toMatchObject({ ok: false, error: "forbidden" });
    const approved = await ok<Step>(actions().approve(...as(sekjen))({ id, version: 1 }));
    const back = await ok<Step>(
      actions().returnToProposal(...as(sekjen))({ id, version: approved.version, note: "Budget?" }),
    );
    expect(back.status).toBe("proposed");
    expect((await store().get(id))?.approvedBy).toBeNull();
    const cancelled = await ok<Step>(
      actions().cancel(...as(sekjen))({ id, version: back.version, note: "No venue" }),
    );
    expect(cancelled.status).toBe("cancelled");
    const edit = await actions().save(...as(director))({
      id,
      version: cancelled.version,
      periodId: "p1",
      plan,
      picEmails: [],
    });
    expect(edit).toMatchObject({ ok: false, issues: [expect.stringContaining("closed")] });
  });
});

describe("weekly check-in: one per programme per UTC week", () => {
  it("a second check-in in the same week updates it; the next week is a new one", async () => {
    const { id } = await proposal();
    const early = await actions().checkIn(...as(pic))({ id, achievements: "Planned" });
    expect(early).toMatchObject({ ok: false, error: "refused" });
    await ok(actions().approve(...as(sekjen))({ id, version: 1 }));

    const first = await ok<{ id: string; weekStart: string }>(
      actions().checkIn(...as(pic))({ id, achievements: "Booked the venue" }),
    );
    expect(first).toEqual({ id: `${id}_2026-11-02`, weekStart: "2026-11-02" });
    clock = new Date("2026-11-08T23:59:00Z");
    await ok(
      actions().checkIn(...as(pic))({
        id,
        achievements: "Booked the venue, speakers",
        blockers: "",
      }),
    );
    let list = await store().listCheckins(id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      achievements: "Booked the venue, speakers",
      createdAt: new Date("2026-11-04T03:00:00Z"),
      updatedAt: clock,
    });
    clock = new Date("2026-11-09T00:00:00Z");
    await ok(actions().checkIn(...as(pic))({ id, achievements: "Rehearsal" }));
    list = await store().listCheckins(id);
    expect(list.map((c) => c.weekStart)).toEqual(["2026-11-09", "2026-11-02"]);

    const empty = await actions().checkIn(...as(pic))({ id, achievements: "" });
    expect(empty).toMatchObject({ ok: false, error: "invalid_input" });
    const stranger = await actions().checkIn(...as(officer))({ id, achievements: "x" });
    expect(stranger).toMatchObject({ ok: false, error: "refused" });
    const missing = await actions().checkIn(...as(officer))({ id: "ghost", achievements: "x" });
    expect(missing).toMatchObject({ ok: false, error: "refused" });
    const audit = [...fake.docs.values()].filter(
      (entry) => (entry as { resourceType?: string }).resourceType === "checkin",
    ) as Array<{ action: string }>;
    expect(audit.map((e) => e.action)).toEqual(["CREATE", "UPDATE", "CREATE"]);
  });

  it("a check-in of a programme that disappeared meanwhile is refused", async () => {
    await expect(
      store().checkIn(
        "ghost",
        "2026-11-02",
        { achievements: "x", blockers: "", nextPlan: "" },
        "u",
        () => {
          throw new Error("not reached");
        },
        clock,
      ),
    ).rejects.toThrow("does not exist");
  });
});
