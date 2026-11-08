import { beforeEach, describe, expect, it } from "vitest";
import { createSqlChapterReader, createSqlChapterStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createChapterActions } from "../../apps/admin/src/server/chapters";
import { fakeDb } from "../support/fake-db";
import { revertEntry } from "../support/revert";

type Db = Parameters<typeof createSqlChapterStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "editor-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const editor = staff(["organizations.edit"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const chapter = {
  name: "PPI Jepang",
  countryCode: "JP",
  timezone: "Asia/Tokyo",
  logo: null,
  contactName: "Sari",
  contactPublic: "humas@ppijepang.org",
  description: "",
  role: "",
  phone: "",
  website: "",
  email: "",
  instagram: "@ppijepang",
  socials: [],
  latitude: 36.2,
  longitude: 138.25,
  slug: "",
};

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlChapterStore>;
const actions = () => createChapterActions({ chapters: store, now: () => now });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(() => {
  fake = fakeDb();
  store = createSqlChapterStore(fake.db as unknown as Db);
});

describe("chapters (Organizations → PPI) and the map", () => {
  it("adds, edits and deactivates chapters — never deletes; map count == markers", async () => {
    expect(
      await actions().save(...as(staff(["organizations.read"])))({ ...chapter, version: null }),
    ).toEqual({ ok: false, error: "forbidden" });
    const jp = await actions().save(...as(editor))({ ...chapter, version: null });
    expect(jp).toMatchObject({ ok: true, data: { slug: "ppi-jepang", version: 1 } });
    const au = await actions().save(...as(editor))({
      ...chapter,
      name: "PPI Australia",
      countryCode: "AU",
      timezone: "Australia/Sydney",
      latitude: -25,
      longitude: 134,
      logo: {
        url: "https://storage.example/chapters/logos/au.webp",
        thumbUrl: "https://storage.example/chapters/logos/au_thumb.webp",
        path: "chapters/logos/au.webp",
        thumbPath: "chapters/logos/au_thumb.webp",
        width: 512,
        height: 512,
      },
      socials: [{ label: "YouTube", url: "https://youtube.com/@ppiaustralia" }],
      version: null,
    });
    const jpId = jp.ok ? jp.data.id : "";
    expect(
      await actions().save(...as(editor))({ ...chapter, id: jpId, slug: "ppi-japan", version: 1 }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: false });
    expect(
      await actions().setActive(...as(editor))({ id: jpId, version: 2, active: false }),
    ).toMatchObject({ ok: true });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", module: "organizations" });

    const reader = createSqlChapterReader(fake.db as unknown as Db);
    const active = await reader.listActive();
    expect(active.map((c) => c.name)).toEqual(["PPI Australia"]);
    expect(active[0]).not.toHaveProperty("version");
    expect((await store.listForAdmin()).map((c) => [c.name, c.active])).toEqual([
      ["PPI Australia", true],
      ["PPI Jepang", false],
    ]);
    expect(await store.get(au.ok ? au.data.id : "")).toMatchObject({
      website: null,
      socials: [{ label: "YouTube" }],
    });
    expect(REVERTIBLE_COLLECTIONS["chapter"]).toBe("chapters");
  });

  it("a chapter admin edits only its own chapter, and only the contact fields (A2)", async () => {
    const jp = await actions().save(...as(editor))({ ...chapter, version: null });
    const kr = await actions().save(...as(editor))({
      ...chapter,
      name: "PPI Korea",
      countryCode: "KR",
      timezone: "Asia/Seoul",
      version: null,
    });
    const jpId = jp.ok ? jp.data.id : "";
    const krId = kr.ok ? kr.data.id : "";
    const jpAdmin: Principal = {
      ...editor,
      assignments: [
        {
          roleId: "chapter_admin",
          scope: { type: "chapter", chapterId: jpId },
          permissions: new Set(normalizePermissions(["organizations.edit"])),
        },
      ],
    };
    const contact = {
      contactName: "Budi",
      contactPublic: "budi@ppijepang.org",
      instagram: "@ppijp",
    };
    expect(
      await actions().save(...as(jpAdmin))({ ...chapter, ...contact, id: jpId, version: 1 }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(await store.get(jpId)).toMatchObject(contact);
    // Name, country, map position and URL stay with the national board.
    for (const change of [
      { name: "PPI Nippon" },
      { latitude: 35 },
      { slug: "ppi-nippon" },
      { memberCount: 9 },
      { conditions: ["Tidak ada kontak resmi"] },
      { risk: "at_risk" },
    ]) {
      expect(
        await actions().save(...as(jpAdmin))({
          ...chapter,
          ...contact,
          ...change,
          id: jpId,
          version: 2,
        }),
      ).toMatchObject({ error: "refused", issues: [expect.stringContaining("contact")] });
    }
    // Another chapter, a new chapter and (de)activation are out of reach.
    expect(
      await actions().save(...as(jpAdmin))({ ...chapter, name: "PPI Korea", id: krId, version: 1 }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await actions().save(...as(jpAdmin))({ ...chapter, version: null })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await actions().setActive(...as(jpAdmin))({ id: jpId, version: 2, active: false }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await actions().remove(...as(jpAdmin))({ id: jpId, version: 2 })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("stores the board's member count, conditions and risk (admin only)", async () => {
    const saved = await actions().save(...as(editor))({
      ...chapter,
      memberCount: 200,
      conditions: ["Belum ada pengurus inti yang tercatat", "Tidak ada satu pun kontak resmi"],
      risk: "at_risk",
      version: null,
    });
    const id = saved.ok ? saved.data.id : "";
    expect(await store.get(id)).toMatchObject({ memberCount: 200, risk: "at_risk" });
    // Chapters saved before these fields existed read as "nothing entered yet".
    fake.docs.set(`chapters/${id}`, {
      ...fake.docs.get(`chapters/${id}`),
      memberCount: undefined,
      conditions: undefined,
      risk: undefined,
    });
    expect(await store.get(id)).toMatchObject({ memberCount: 0, conditions: [], risk: "none" });
    const [onMap] = await createSqlChapterReader(fake.db as unknown as Db).listActive();
    expect(onMap).not.toHaveProperty("risk");
    expect(onMap).not.toHaveProperty("memberCount");
  });

  it("reads legacy chapter rows missing the newer public fields (description/role/phone)", async () => {
    // A row saved before the public-profile fields existed: the reader falls back
    // to the defaults ("" / null) instead of crashing (issue: 100% branch coverage).
    const legacy: Record<string, unknown> = {
      ...chapter,
      slug: "ppi-legacy",
      active: true,
      mapNo: 20,
    };
    delete legacy["description"];
    delete legacy["role"];
    delete legacy["phone"];
    await fake.db
      .collection("chapters")
      .doc("legacy")
      .set({
        ...legacy,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    const [onMap] = await createSqlChapterReader(fake.db as unknown as Db).listActive();
    expect(onMap).toMatchObject({ slug: "ppi-legacy", description: "", role: null, phone: null });
  });

  it("deletes softly: gone from the list and the map until the audit entry is reverted", async () => {
    const jp = await actions().save(...as(editor))({ ...chapter, version: null });
    const id = jp.ok ? jp.data.id : "";
    const reader = createSqlChapterReader(fake.db as unknown as Db);
    expect(
      await actions().remove(...as(staff(["organizations.read"])))({ id, version: 1 }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await actions().remove(...as(editor))({ id, version: 1 })).toMatchObject({
      ok: true,
      data: { version: 2 },
    });
    const deleted = auditEntries().at(-1);
    expect(deleted).toMatchObject({
      action: "DELETE",
      module: "organizations",
      resourceType: "chapter",
      after: null,
      revertible: true,
    });
    expect(await store.listForAdmin()).toEqual([]);
    expect(await reader.listActive()).toEqual([]);
    expect(await actions().save(...as(editor))({ ...chapter, id, version: 2 })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("trash")],
    });

    expect(await revertEntry(fake.db, deleted?.["id"] as string, now)).toMatchObject({ ok: true });
    expect((await store.listForAdmin()).map((c) => c.name)).toEqual(["PPI Jepang"]);
    expect((await reader.listActive()).map((c) => c.name)).toEqual(["PPI Jepang"]);
  });

  it("refuses a name without letters or numbers and a URL in use", async () => {
    expect(
      await actions().save(...as(editor))({ ...chapter, name: "!!!", version: null }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("letters or numbers")] });
    await actions().save(...as(editor))({ ...chapter, version: null });
    expect(await actions().save(...as(editor))({ ...chapter, version: null })).toMatchObject({
      error: "refused",
      issues: [expect.stringContaining("already used")],
    });
  });
});
