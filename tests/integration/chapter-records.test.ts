import { beforeEach, describe, expect, it } from "vitest";
import { createSqlChapterRecordStore } from "@website/db/sql";
import type { Chapter } from "@website/domain/organizations";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createChapterRecords } from "../../apps/admin/src/server/chapter-records";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlChapterRecordStore>[0];
const staff = (userId: string, scope: Scope): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [
    {
      roleId: "r",
      scope,
      permissions: new Set(normalizePermissions(["organizations.edit"])),
    },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const chapters: Record<string, Chapter> = {
  jp: { id: "jp", name: "PPI Jepang", active: true, deletedAt: null } as Chapter,
  au: { id: "au", name: "PPI Australia", active: true, deletedAt: null } as Chapter,
  old: { id: "old", name: "PPI Lama", active: true, deletedAt: new Date() } as Chapter,
  off: { id: "off", name: "PPI Off", active: false, deletedAt: null } as Chapter,
};

let fake: ReturnType<typeof fakeDb>;
const store = () => createSqlChapterRecordStore(fake.db as unknown as Db);
const records = () =>
  createChapterRecords({
    records: store(),
    chapter: (id) => Promise.resolve(chapters[id] ?? null),
    now: () => new Date("2026-11-07T00:00:00Z"),
  });
const admin = staff("rina", { type: "chapter", chapterId: "jp" });
const centre = staff("sekjen", { type: "global" });
const report = (chapterId: string, quarter: string, activeMembers = 10) => ({
  chapterId,
  quarter,
  activeMembers,
  activities: ["Diskusi"],
  obstacles: "",
});

beforeEach(() => {
  fake = fakeDb();
});

describe("chapter records (H1-H3)", () => {
  it("the chapter admin reports for its own chapter; the centre on behalf; resubmit updates", async () => {
    expect(await records().submitReport(...as(admin))(report("jp", "2026Q3"))).toEqual({
      ok: true,
      data: { id: "jp_2026Q3", filledByCentre: false },
    });
    expect(await records().submitReport(...as(admin))(report("au", "2026Q3"))).toMatchObject({
      error: "forbidden",
    });
    expect(await records().submitReport(...as(centre))(report("jp", "2026Q3", 12))).toEqual({
      ok: true,
      data: { id: "jp_2026Q3", filledByCentre: true },
    });
    await records().submitReport(...as(admin))(report("jp", "2026Q4"));
    const saved = await store().reportsOf("jp");
    expect(saved.map((r) => [r.id, r.activeMembers, r.filledByCentre])).toEqual([
      ["jp_2026Q4", 10, false],
      ["jp_2026Q3", 12, true],
    ]);
    expect(await records().submitReport(...as(centre))(report("jp", "2027Q1"))).toMatchObject({
      issues: ["This quarter has not started yet."],
    });
    expect(await records().submitReport(...as(centre))(report("old", "2026Q3"))).toMatchObject({
      issues: ["This chapter does not exist."],
    });
  });

  it("signals: computed on read, inactive chapters not rated", async () => {
    await records().submitReport(...as(admin))(report("jp", "2026Q3"));
    const signals = await records().signals([
      chapters["jp"],
      chapters["au"],
      chapters["off"],
    ] as Chapter[]);
    expect(signals.get("jp")?.signal).toBe("active");
    expect(signals.get("au")).toEqual({
      signal: "needs_checking",
      reason: "No report for 2026Q3.",
    });
    expect(signals.get("off")).toBeNull();
  });

  it("officers: saved with their terms, own chapter only", async () => {
    const officers = [{ name: "Rina", title: "Ketua", termEnd: null }];
    expect((await records().saveOfficers(...as(admin))({ chapterId: "jp", officers })).ok).toBe(
      true,
    );
    expect(await store().officers("jp")).toEqual(officers);
    const next = [...officers, { name: "Budi", title: "Sekretaris", termEnd: "2027-06-30" }];
    await records().saveOfficers(...as(admin))({ chapterId: "jp", officers: next });
    expect(await store().officers("jp")).toEqual(next);
    expect(await store().officers("au")).toEqual([]);
    expect(await records().saveOfficers(...as(admin))({ chapterId: "au", officers })).toMatchObject(
      { error: "forbidden" },
    );
    expect(
      await records().saveOfficers(...as(centre))({ chapterId: "nope", officers }),
    ).toMatchObject({ issues: ["This chapter does not exist."] });
  });
});
