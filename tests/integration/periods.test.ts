import { beforeEach, describe, expect, it } from "vitest";
import { createSqlPeriodStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createPeriodActions } from "../../apps/admin/src/server/periods";
import { fakeDb } from "../support/fake-db";
import { revertEntry } from "../support/revert";

type Db = Parameters<typeof createSqlPeriodStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "secretary-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const secretary = staff(["periods.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "sekjen@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
/** The admin form has only the period (its years) and the cabinet. */
const period = { name: "2026/2027", cabinet: "Kolaborasi Asiania" };

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlPeriodStore>;
const actions = () => createPeriodActions({ periods: store, now: () => now });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const create = async (fields: Partial<typeof period> = {}) => {
  const result = await actions().save(...as(secretary))({ ...period, ...fields, version: null });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data.id;
};
const activePeriodId = () => fake.docs.get("settings/activePeriod")?.["periodId"];

beforeEach(() => {
  fake = fakeDb();
  store = createSqlPeriodStore(fake.db as unknown as Db);
});

describe("board periods (Organizations → Period)", () => {
  it("creates a draft period (periods.edit only); the dates come from the years in the name", async () => {
    expect(
      await actions().save(...as(staff(["organizations.edit"])))({ ...period, version: null }),
    ).toEqual({ ok: false, error: "forbidden" });
    for (const bad of [
      { name: "Kabinet baru" },
      { name: "2027-2026" },
      { cabinet: "" },
      { startsOn: "2026-11-01" },
    ]) {
      expect(
        await actions().save(...as(secretary))({ ...period, ...bad, version: null }),
        JSON.stringify(bad),
      ).toMatchObject({ ok: false, error: "invalid_input" });
    }
    expect(
      await actions().save(...as(secretary))({ ...period, name: "2026", version: null }),
    ).toMatchObject({ fields: { name: "Write the years of the period, e.g. 2026-2027." } });
    const id = await create();
    expect(await store.get(id)).toMatchObject({
      ...period,
      startsOn: "2026-01-01",
      endsOn: "2027-12-31",
      vision: "",
      mission: "",
      lpjDeadlineDays: 30,
      status: "draft",
      version: 1,
    });
    expect(auditEntries().at(-1)).toMatchObject({
      module: "periods",
      action: "CREATE",
      resourceType: "period",
      title: "2026/2027",
    });
    expect(activePeriodId()).toBeUndefined();
  });

  it("activating archives the previous active period, in one transaction, audited", async () => {
    const first = await create({ name: "2025/2026" });
    const second = await create();
    expect(await actions().activate(...as(secretary))({ id: first, version: 1 })).toMatchObject({
      ok: true,
      data: { version: 2 },
    });
    expect(activePeriodId()).toBe(first);
    expect(await actions().activate(...as(secretary))({ id: second, version: 1 })).toMatchObject({
      ok: true,
    });
    expect(activePeriodId()).toBe(second);
    expect((await store.listForAdmin()).map((p) => [p.name, p.status])).toEqual([
      ["2026/2027", "active"],
      ["2025/2026", "archived"],
    ]);
    const statusChanges = auditEntries()
      .filter((e) => e["action"] === "UPDATE")
      .map((e) => [e["title"], (e["after"] as { status: string }).status, e["revertible"]]);
    expect(statusChanges).toEqual([
      ["2025/2026", "active", false],
      ["2026/2027", "active", false],
      ["2025/2026", "archived", false],
    ]);
  });

  it("an edit keeps the notes and the dates; the dates change only with the years", async () => {
    // A period written before the form shrank (e.g. imported), with its own dates and notes.
    fake.docs.set("periods/old", {
      name: "2025/2026",
      cabinet: "Lama",
      startsOn: "2025-11-01",
      endsOn: "2026-10-31",
      vision: "Satu kawasan.",
      mission: "Melayani anggota.",
      lpjDeadlineDays: 14,
      status: "draft",
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deletedAt: null,
    });
    const notes = { vision: "Satu kawasan.", mission: "Melayani anggota.", lpjDeadlineDays: 14 };
    await actions().save(...as(secretary))({
      id: "old",
      version: 1,
      name: "2025/2026",
      cabinet: "Baru",
    });
    expect(await store.get("old")).toMatchObject({
      ...notes,
      cabinet: "Baru",
      startsOn: "2025-11-01",
      endsOn: "2026-10-31",
    });
    await actions().save(...as(secretary))({
      id: "old",
      version: 2,
      name: "2025-2027",
      cabinet: "Baru",
    });
    expect(await store.get("old")).toMatchObject({
      ...notes,
      name: "2025-2027",
      startsOn: "2025-01-01",
      endsOn: "2027-12-31",
    });
  });

  it("archived periods are read-only; only a draft can be activated", async () => {
    const first = await create();
    const second = await create({ name: "2027/2028" });
    await actions().activate(...as(secretary))({ id: first, version: 1 });
    await actions().activate(...as(secretary))({ id: second, version: 1 });
    expect(
      await actions().save(...as(secretary))({ ...period, id: first, version: 3, cabinet: "Baru" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("archived")] });
    expect(await actions().activate(...as(secretary))({ id: first, version: 3 })).toMatchObject({
      error: "refused",
    });
    expect(await actions().activate(...as(secretary))({ id: second, version: 2 })).toMatchObject({
      error: "refused",
    });
    // The active period can still be corrected; a stale version is refused.
    expect(
      await actions().save(...as(secretary))({
        ...period,
        id: second,
        version: 2,
        cabinet: "Baru",
      }),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(await store.get(second)).toMatchObject({ status: "active", cabinet: "Baru" });
    expect(
      await actions().save(...as(secretary))({ ...period, id: second, version: 2 }),
    ).toMatchObject({ ok: false, error: "conflict" });
  });

  it("deletes softly any period but the active one; the delete can be reverted", async () => {
    const draft = await create({ name: "2027/2028" });
    const active = await create();
    await actions().activate(...as(secretary))({ id: active, version: 1 });
    expect(
      await actions().remove(...as(staff(["periods.read"])))({ id: draft, version: 1 }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await actions().remove(...as(secretary))({ id: active, version: 2 })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("active period")],
    });
    expect(await actions().remove(...as(secretary))({ id: draft, version: 1 })).toMatchObject({
      ok: true,
    });
    const deleted = auditEntries().at(-1);
    expect(deleted).toMatchObject({ action: "DELETE", resourceType: "period", revertible: true });
    expect((await store.listForAdmin()).map((p) => p.name)).toEqual(["2026/2027"]);
    // A deleted period cannot be activated or edited.
    expect(await actions().activate(...as(secretary))({ id: draft, version: 2 })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("trash")],
    });
    expect(await revertEntry(fake.db, deleted?.["id"] as string, now)).toMatchObject({ ok: true });
    expect((await store.listForAdmin()).map((p) => p.name)).toEqual(["2027/2028", "2026/2027"]);
  });

  it("concurrent activations leave exactly one active period", async () => {
    const ids = await Promise.all([
      create(),
      create({ name: "2027/2028" }),
      create({ name: "2028/2029" }),
    ]);
    const results = await Promise.all(
      ids.map((id) => actions().activate(...as(secretary))({ id, version: 1 })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const list = await store.listForAdmin();
    expect(list.filter((p) => p.status === "active")).toHaveLength(1);
    expect(list.filter((p) => p.status === "archived")).toHaveLength(2);
    expect(activePeriodId()).toBe(list.find((p) => p.status === "active")?.id);
  });
});
