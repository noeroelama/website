import { beforeEach, describe, expect, it } from "vitest";
import { createSqlObjectiveStore, createSqlPeriodStore } from "@website/db/sql";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createOkrActions } from "../../apps/admin/src/server/okr";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlObjectiveStore>[0];
const now = new Date("2026-11-04T03:00:00Z");
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

const planner = staff("planner", ["okr.edit"]);
const director = staff("dir", ["okr.edit"], { type: "orgUnit", orgUnitId: "media" });

let fake: ReturnType<typeof fakeDb>;
let uuids = 0;
const db = () => fake.db as unknown as Db;
const objectives = () => createSqlObjectiveStore(db());
const actions = () =>
  createOkrActions({
    objectives: objectives(),
    periods: createSqlPeriodStore(db()),
    unitPath: (id) => {
      const unit = fake.docs.get(`orgUnits/${id}`) as { path: string[] } | undefined;
      return Promise.resolve(unit ? [...unit.path, id] : null);
    },
    now: () => now,
    uuid: () => `kr${(uuids += 1)}`,
  });

const period = (status: string) => ({
  name: "2026-2027",
  cabinet: "Kolaborasi",
  startsOn: "2026-01-01",
  endsOn: "2027-12-31",
  vision: "",
  mission: "",
  lpjDeadlineDays: 14,
  status,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});
const unit = (periodId: string, path: string[] = []) => ({
  periodId,
  path,
  name: "Unit",
  deletedAt: null,
});

const input = { title: "Grow the network", description: "", orgUnitId: "media", sort: 0 };
async function create(extra: Record<string, unknown> = {}, who = planner) {
  const result = await actions().saveObjective(...as(who))({
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
  uuids = 0;
  fake.docs.set("periods/p1", period("active"));
  fake.docs.set("periods/p0", period("archived"));
  fake.docs.set("orgUnits/media", unit("p1", ["dirs"]));
  fake.docs.set("orgUnits/edu", unit("p1", ["dirs"]));
  fake.docs.set("orgUnits/old", unit("p0"));
});

describe("objectives per period (E1)", () => {
  it("are listed per period, in order, without deleted ones", async () => {
    const a = await create({ sort: 2, title: "B objective" });
    await create({ sort: 1, title: "A objective", orgUnitId: null });
    fake.docs.set("objectives/other", {
      ...input,
      periodId: "p2",
      orgUnitPath: [],
      keyResults: [],
      deletedAt: null,
    });
    await create({ sort: 2, title: "C objective" });
    const listed = (await objectives().listForPeriod("p1")).slice(0, 2);
    expect(listed.map((o) => o.title)).toEqual(["A objective", "B objective"]);
    expect(listed[1]?.orgUnitPath).toEqual(["dirs", "media"]);
    const removed = await actions().removeObjective(...as(planner))({ ...a });
    expect(removed.ok).toBe(true);
    expect((await objectives().listForPeriod("p1")).map((o) => o.title)).toEqual([
      "A objective",
      "C objective",
    ]);
    const ghost = await actions().removeObjective(...as(director))({ id: "ghost", version: 1 });
    expect(ghost).toMatchObject({ ok: false, error: "forbidden" });
    expect(fake.docs.get(`objectives/${a.id}`)).toMatchObject({ periodId: "p1" });
  });

  it("refuses a unit of another period", async () => {
    const result = await actions().saveObjective(...as(planner))({
      ...input,
      orgUnitId: "old",
      periodId: "p1",
      version: null,
    });
    expect(result).toMatchObject({ ok: false, issues: ["Choose a unit of this board period."] });
  });

  it("an archived period is read-only: no new objective, no change, no key result", async () => {
    const created = await actions().saveObjective(...as(planner))({
      ...input,
      orgUnitId: null,
      periodId: "p0",
      version: null,
    });
    expect(created).toMatchObject({ ok: false, error: "refused" });
    expect(created.ok ? "" : created.issues?.[0]).toContain("archived");

    const o = await create();
    fake.docs.set("periods/p1", period("archived"));
    const edit = await actions().saveObjective(...as(planner))({
      ...input,
      id: o.id,
      periodId: "p1",
      version: o.version,
    });
    expect(edit).toMatchObject({ ok: false, error: "refused" });
    const key = await actions().saveKeyResult(...as(planner))({
      objectiveId: o.id,
      version: o.version,
      title: "Members",
      target: 30,
    });
    expect(key).toMatchObject({ ok: false, error: "refused" });
    const vision = await actions().saveVision(...as(planner))({
      periodId: "p1",
      version: 1,
      vision: "x",
      mission: "y",
    });
    expect(vision).toMatchObject({ ok: false, error: "refused" });
  });

  it("a missing period is refused", async () => {
    const result = await actions().saveObjective(...as(planner))({
      ...input,
      orgUnitId: null,
      periodId: "nope",
      version: null,
    });
    expect(result).toMatchObject({ ok: false, issues: ["This period does not exist."] });
  });

  it("unit scope: a director plans only their own unit; region objectives need a global role", async () => {
    const own = await create({}, director);
    expect(own.version).toBe(1);
    const region = await actions().saveObjective(...as(director))({
      ...input,
      orgUnitId: null,
      periodId: "p1",
      version: null,
    });
    expect(region).toMatchObject({ ok: false, error: "forbidden" });
    const moved = await actions().saveObjective(...as(director))({
      ...input,
      orgUnitId: "edu",
      id: own.id,
      periodId: "p1",
      version: own.version,
    });
    expect(moved).toMatchObject({ ok: false, error: "refused" });
    const renamed = await actions().saveObjective(...as(director))({
      ...input,
      title: "Grow the network more",
      id: own.id,
      periodId: "p1",
      version: own.version,
    });
    expect(renamed).toMatchObject({ ok: true, data: { version: 2 } });
    const unknown = await actions().saveObjective(...as(director))({
      ...input,
      orgUnitId: "ghost",
      periodId: "p1",
      version: null,
    });
    expect(unknown).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("key results are added, edited and removed in the objective, audited", async () => {
    const o = await create();
    const added = await actions().saveKeyResult(...as(planner))({
      objectiveId: o.id,
      version: o.version,
      title: "Members",
      unit: "people",
      baseline: 12,
      target: 30,
      current: 21,
    });
    expect(added).toMatchObject({ ok: true, data: { version: 2 } });
    const stored = await objectives().get(o.id);
    expect(stored?.keyResults).toEqual([
      expect.objectContaining({ id: "kr1", current: 21, direction: "up", measuredAt: now }),
    ]);
    const edited = await actions().saveKeyResult(...as(planner))({
      objectiveId: o.id,
      version: 2,
      keyResultId: "kr1",
      title: "Members",
      baseline: 12,
      target: 30,
      current: 30,
    });
    expect(edited).toMatchObject({ ok: true, data: { version: 3 } });
    const removed = await actions().deleteKeyResult(...as(planner))({
      objectiveId: o.id,
      version: 3,
      keyResultId: "kr1",
    });
    expect(removed).toMatchObject({ ok: true, data: { version: 4 } });
    const audit = [...fake.docs.entries()]
      .filter(([path]) => path.startsWith("auditLogs/"))
      .map(([, entry]) => entry as { module: string; action: string; revertible: boolean });
    expect(audit).toHaveLength(4);
    expect(audit.every((e) => e.module === "okr" && !e.revertible)).toBe(true);
  });

  it("the vision and mission live on the period", async () => {
    const result = await actions().saveVision(...as(planner))({
      periodId: "p1",
      version: 1,
      vision: "Satu kawasan",
      mission: "1. Kolaborasi",
    });
    expect(result).toMatchObject({ ok: true, data: { version: 2 } });
    expect(fake.docs.get("periods/p1")).toMatchObject({
      vision: "Satu kawasan",
      mission: "1. Kolaborasi",
      status: "active",
    });
    const scoped = await actions().saveVision(...as(director))({
      periodId: "p1",
      version: 2,
      vision: "x",
      mission: "y",
    });
    expect(scoped).toMatchObject({ ok: false, error: "forbidden" });
  });
});
