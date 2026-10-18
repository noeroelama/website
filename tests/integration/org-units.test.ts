import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreOrgUnitStore, createFirestorePeriodStore } from "@website/db/firestore";
import { orgUnitPath } from "@website/domain/organizations";
import { can, normalizePermissions, type Principal } from "@website/permissions";
import { createOrgUnitActions } from "../../apps/admin/src/server/org-units";
import { createPeriodActions } from "../../apps/admin/src/server/periods";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreOrgUnitStore>[0];
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
const secretary = staff(["structure.edit", "periods.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "sekjen@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeFirestore>;
let units: ReturnType<typeof createFirestoreOrgUnitStore>;
let periodId: string;
const actions = () => createOrgUnitActions({ units, now: () => now });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const unit = (name: string, code: string, parentId: string | null, type = "direktorat") => ({
  periodId,
  parentId,
  name,
  code,
  type,
  description: "",
  sort: 0,
  active: true,
});
const create = async (name: string, code: string, parentId: string | null, type?: string) => {
  const result = await actions().save(...as(secretary))({
    ...unit(name, code, parentId, type),
    version: null,
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data.id;
};
const pathOf = async (id: string) => (await units.get(id))?.path;

beforeEach(async () => {
  fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  units = createFirestoreOrgUnitStore(db);
  const periods = createPeriodActions({
    periods: createFirestorePeriodStore(db),
    now: () => now,
  });
  const saved = await periods.save(...as(secretary))({
    name: "2026/2027",
    cabinet: "",
    startsOn: "2026-11-01",
    endsOn: "2027-10-31",
    vision: "",
    mission: "",
    lpjDeadlineDays: 30,
    version: null,
  });
  periodId = saved.ok ? saved.data.id : "";
});

describe("organisation structure (org units)", () => {
  it("stores parentId and the ancestor path; a unit's path covers its role scope", async () => {
    expect(
      await actions().save(...as(staff(["organizations.edit"])))({
        ...unit("Koordinator", "KOOR", null, "koordinator"),
        version: null,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    const koor = await create("Koordinator", "koor", null, "koordinator");
    const media = await create("Direktorat Media", "MED", koor);
    const design = await create("Bidang Desain", "MED-DSN", media, "bidang");
    expect(await units.get(design)).toMatchObject({
      code: "MED-DSN",
      parentId: media,
      path: [koor, media],
      version: 1,
    });
    expect(await pathOf(koor)).toEqual([]);
    expect(auditEntries().at(-1)).toMatchObject({
      module: "structure",
      action: "CREATE",
      resourceType: "orgUnit",
      title: "Bidang Desain",
    });

    // A Media director (orgUnit scope) covers Media and Desain, never a sibling directorate.
    const finance = await create("Direktorat Keuangan", "FIN", koor);
    const director: Principal = {
      ...staff([]),
      assignments: [
        {
          roleId: "director",
          scope: { type: "orgUnit", orgUnitId: media },
          permissions: new Set(normalizePermissions(["events.edit"])),
        },
      ],
    };
    const designUnit = await units.get(design);
    const financeUnit = await units.get(finance);
    expect(can(director, "events.edit", { orgUnitPath: orgUnitPath(designUnit!) })).toBe(true);
    expect(can(director, "events.edit", { orgUnitPath: orgUnitPath(financeUnit!) })).toBe(false);

    // Descendants are one array-contains query.
    expect((await units.descendants(koor)).map((u) => u.code).sort()).toEqual([
      "FIN",
      "MED",
      "MED-DSN",
    ]);
    expect((await units.listForPeriod(periodId)).map((u) => u.code)).toEqual([
      "KOOR",
      "FIN",
      "MED",
      "MED-DSN",
    ]);
  });

  it("refuses a duplicate code in the period, a parent from elsewhere and parent changes on save", async () => {
    const koor = await create("Koordinator", "KOOR", null, "koordinator");
    expect(
      await actions().save(...as(secretary))({ ...unit("Again", "koor", null), version: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("code")] });
    expect(
      await actions().save(...as(secretary))({ ...unit("Lost", "LOST", "nope"), version: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("parent")] });
    expect(
      await actions().save(...as(secretary))({
        ...unit("Lost", "LOST", null),
        periodId: "no-such-period",
        version: null,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("period")] });
    const media = await create("Direktorat Media", "MED", koor);
    expect(
      await actions().save(...as(secretary))({
        ...unit("Direktorat Media", "MED", null),
        id: media,
        version: 1,
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("Move")] });
    expect(
      await actions().save(...as(secretary))({
        ...unit("Direktorat Media & Komunikasi", "MEDKOM", koor),
        id: media,
        version: 1,
      }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    // The old code is free again.
    expect(await create("Direktorat Media Baru", "MED", koor)).toBeTruthy();
  });

  it("moving a unit rewrites the whole subtree's paths in one transaction; cycles are refused", async () => {
    const koor = await create("Koordinator", "KOOR", null, "koordinator");
    const sekjen = await create("Sekretaris Jenderal", "SEKJEN", koor, "sekjen");
    const media = await create("Direktorat Media", "MED", koor);
    const design = await create("Bidang Desain", "MED-DSN", media, "bidang");
    const staffUnit = await create("Staf Desain", "MED-DSN-S", design, "staf");

    expect(
      await actions().move(...as(secretary))({ id: media, version: 1, parentId: design }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("inside itself")] });
    expect(
      await actions().move(...as(secretary))({ id: media, version: 1, parentId: media }),
    ).toMatchObject({ error: "refused" });

    expect(
      await actions().move(...as(secretary))({ id: media, version: 1, parentId: sekjen }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await units.get(media)).toMatchObject({ parentId: sekjen, path: [koor, sekjen] });
    expect(await pathOf(design)).toEqual([koor, sekjen, media]);
    expect(await pathOf(staffUnit)).toEqual([koor, sekjen, media, design]);
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", resourceId: media });

    // To the top level, and a stale version is refused.
    expect(
      await actions().move(...as(secretary))({ id: media, version: 2, parentId: null }),
    ).toMatchObject({ ok: true });
    expect(await pathOf(staffUnit)).toEqual([media, design]);
    expect(
      await actions().move(...as(secretary))({ id: media, version: 2, parentId: koor }),
    ).toMatchObject({ ok: false, error: "conflict" });
  });

  it("an archived period's structure is read-only", async () => {
    const koor = await create("Koordinator", "KOOR", null, "koordinator");
    const media = await create("Direktorat Media", "MED", koor);
    const db = fake.db as unknown as Db;
    const periods = createPeriodActions({
      periods: createFirestorePeriodStore(db),
      now: () => now,
    });
    const next = await periods.save(...as(secretary))({
      name: "2027/2028",
      cabinet: "",
      startsOn: "2027-11-01",
      endsOn: "2028-10-31",
      vision: "",
      mission: "",
      lpjDeadlineDays: 30,
      version: null,
    });
    await periods.activate(...as(secretary))({ id: periodId, version: 1 });
    await periods.activate(...as(secretary))({ id: next.ok ? next.data.id : "", version: 1 });
    expect(
      await actions().save(...as(secretary))({ ...unit("Bidang X", "X", koor), version: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("archived")] });
    expect(
      await actions().move(...as(secretary))({ id: media, version: 1, parentId: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("archived")] });
  });
});
