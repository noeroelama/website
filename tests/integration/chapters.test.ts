import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreChapterReader, createFirestoreChapterStore } from "@website/db/firestore";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createChapterActions } from "../../apps/admin/src/server/chapters";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreChapterStore>[0];
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
  website: "",
  email: "",
  instagram: "@ppijepang",
  socials: [],
  latitude: 36.2,
  longitude: 138.25,
  slug: "",
};

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestoreChapterStore>;
const actions = () => createChapterActions({ chapters: store, now: () => now });
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(() => {
  fake = fakeFirestore();
  store = createFirestoreChapterStore(fake.db as unknown as Db);
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

    const reader = createFirestoreChapterReader(fake.db as unknown as Db);
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
