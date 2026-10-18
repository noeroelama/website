import { beforeEach, describe, expect, it } from "vitest";
import { createFirestorePeriodStore } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createPeriodActions } from "../../apps/admin/src/server/periods";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestorePeriodStore>[0];
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
const period = {
  name: "2026/2027",
  cabinet: "Kolaborasi Asiania",
  startsOn: "2026-11-01",
  endsOn: "2027-10-31",
  vision: "Satu kawasan.",
  mission: "Melayani anggota.\nMenguatkan PPI negara.",
  lpjDeadlineDays: 30,
};

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestorePeriodStore>;
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
  fake = fakeFirestore();
  store = createFirestorePeriodStore(fake.db as unknown as Db);
});

describe("board periods (Organizations → Period)", () => {
  it("creates a draft period (periods.edit only), with valid dates", async () => {
    expect(
      await actions().save(...as(staff(["organizations.edit"])))({ ...period, version: null }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await actions().save(...as(secretary))({ ...period, endsOn: "2026-10-01", version: null }),
    ).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: { endsOn: "The end date must be after the start date." },
    });
    const id = await create();
    expect(await store.get(id)).toMatchObject({ ...period, status: "draft", version: 1 });
    expect(auditEntries().at(-1)).toMatchObject({
      module: "periods",
      action: "CREATE",
      resourceType: "period",
      title: "2026/2027",
    });
    expect(activePeriodId()).toBeUndefined();
  });

  it("activating archives the previous active period, in one transaction, audited", async () => {
    const first = await create({ name: "2025/2026", startsOn: "2025-11-01", endsOn: "2026-10-31" });
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

  it("archived periods are read-only; only a draft can be activated; there is no delete", async () => {
    const first = await create();
    const second = await create({
      name: "2027/2028",
      startsOn: "2027-11-01",
      endsOn: "2028-10-31",
    });
    await actions().activate(...as(secretary))({ id: first, version: 1 });
    await actions().activate(...as(secretary))({ id: second, version: 1 });
    expect(
      await actions().save(...as(secretary))({ ...period, id: first, version: 3, vision: "x" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("archived")] });
    expect(await actions().activate(...as(secretary))({ id: first, version: 3 })).toMatchObject({
      error: "refused",
    });
    expect(await actions().activate(...as(secretary))({ id: second, version: 2 })).toMatchObject({
      error: "refused",
    });
    // The active period can still be corrected; a stale version is refused.
    expect(
      await actions().save(...as(secretary))({ ...period, id: second, version: 2, cabinet: "B" }),
    ).toMatchObject({ ok: true, data: { version: 3 } });
    expect(await store.get(second)).toMatchObject({ status: "active", cabinet: "B" });
    expect(
      await actions().save(...as(secretary))({ ...period, id: second, version: 2 }),
    ).toMatchObject({ ok: false, error: "conflict" });
    expect(Object.keys(actions())).toEqual(["save", "activate"]);
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
