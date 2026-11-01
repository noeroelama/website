import { beforeEach, describe, expect, it } from "vitest";
import { createSqlContentStore, createSqlNewsReader } from "@website/db/sql";
import { isPubliclyVisible } from "@website/domain/content";
import { normalizePermissions, type Principal } from "@website/permissions";
import { REVERTIBLE_COLLECTIONS } from "../../apps/admin/src/server/audit-log";
import { createNewsActions } from "../../apps/admin/src/server/news";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlContentStore>[0];
let now = new Date("2026-10-18T05:00:00Z");
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
const editor = staff(["articles.edit"]);
const publisher = staff(["articles.edit", "articles.publish"]);
const context = () =>
  Promise.resolve({ actorEmail: "editor@example.org", requestId: "req-123456", authTime: null });

let fake: ReturnType<typeof fakeDb>;
let store: ReturnType<typeof createSqlContentStore>;
const actions = () => createNewsActions({ content: store, now: () => now });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const image = {
  url: "https://storage.example/content/images/a.webp",
  thumbUrl: "https://storage.example/content/images/a_thumb.webp",
  path: "content/images/a.webp",
  thumbPath: "content/images/a_thumb.webp",
  width: 1200,
  height: 800,
};
/** Every field the form marks with * (featured image, publish date, URL, summary) is filled. */
const article = {
  title: "Simposium Berakhir Sukses",
  slug: "simposium-berakhir-sukses",
  author: "Divisi Media",
  category: "community",
  publishAt: "2026-10-18T04:00:00.000Z",
  summary: "Ringkasan.",
  tags: ["Simposium"],
  body: '<p>Isi <script>alert(1)</script><a href="javascript:x()">x</a></p>',
  featuredImage: image,
};
const auditEntries = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(() => {
  now = new Date("2026-10-18T05:00:00Z");
  fake = fakeDb();
  store = createSqlContentStore(fake.db as unknown as Db);
});

describe("News CMS: save draft, publish, schedule", () => {
  it("saves a draft with its URL, a sanitised body and a CREATE entry", async () => {
    const result = await actions().save(...as(editor))({
      ...article,
      version: null,
      intent: "draft",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { slug: "simposium-berakhir-sukses", version: 1 },
    });
    const id = result.ok ? result.data.id : "";
    const saved = await store.get(id);
    expect(saved).toMatchObject({
      kind: "news",
      status: "draft",
      tags: ["simposium"],
      author: "Divisi Media",
    });
    expect(saved?.body).toBe('<p>Isi <a rel="noopener noreferrer">x</a></p>');
    expect(auditEntries()).toEqual([
      expect.objectContaining({ action: "CREATE", module: "articles", title: article.title }),
    ]);
  });

  it("refuses a URL that another article already uses", async () => {
    await actions().save(...as(editor))({ ...article, version: null, intent: "draft" });
    expect(
      await actions().save(...as(editor))({ ...article, version: null, intent: "draft" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already used")] });
  });

  it("publishing needs the Publish permission; a future date schedules without any cron", async () => {
    expect(
      await actions().save(...as(editor))({ ...article, version: null, intent: "publish" }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("Publish permission")] });
    const scheduled = await actions().save(...as(publisher))({
      ...article,
      publishAt: "2026-10-19T00:00:00.000Z",
      version: null,
      intent: "publish",
    });
    const id = scheduled.ok ? scheduled.data.id : "";
    const item = await store.get(id);
    expect(item?.status).toBe("scheduled");
    expect(isPubliclyVisible(item!, now)).toBe(false);
    expect(await store.findPublishedBySlug("news", "simposium-berakhir-sukses", now)).toBeNull();
    now = new Date("2026-10-19T00:00:01Z");
    expect(await store.findPublishedBySlug("news", "simposium-berakhir-sukses", now)).toMatchObject(
      { id },
    );
  });

  it("edits with a version check; changing the URL frees the old one and is not revertible", async () => {
    const created = await actions().save(...as(editor))({
      ...article,
      version: null,
      intent: "draft",
    });
    const id = created.ok ? created.data.id : "";
    expect(
      await actions().save(...as(editor))({ ...article, id, version: 5, intent: "draft" }),
    ).toEqual({ ok: false, error: "conflict" });
    const edited = await actions().save(...as(editor))({
      ...article,
      id,
      slug: "simposium-2026",
      title: "Simposium 2026",
      version: 1,
      intent: "draft",
    });
    expect(edited).toMatchObject({ ok: true, data: { version: 2, slug: "simposium-2026" } });
    expect(auditEntries().at(-1)).toMatchObject({ action: "UPDATE", revertible: false });
    // The old URL is free again.
    expect(
      await actions().save(...as(editor))({ ...article, version: null, intent: "draft" }),
    ).toMatchObject({ ok: true });
  });

  it("publish / unpublish toggle is immediate and audited", async () => {
    const created = await actions().save(...as(editor))({
      ...article,
      version: null,
      intent: "draft",
    });
    const id = created.ok ? created.data.id : "";
    expect(
      await actions().setPublished(...as(editor))({ id, version: 1, published: true }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await actions().setPublished(...as(publisher))({ id, version: 1, published: true }),
    ).toMatchObject({ ok: true, data: { version: 2 } });
    expect(
      await store.findPublishedBySlug("news", "simposium-berakhir-sukses", now),
    ).not.toBeNull();
    expect(
      await actions().setPublished(...as(publisher))({ id, version: 2, published: false }),
    ).toMatchObject({ ok: true });
    expect(await store.findPublishedBySlug("news", "simposium-berakhir-sukses", now)).toBeNull();
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "PUBLISH", "UNPUBLISH"]);
  });

  it("delete moves the article to trash (soft delete, revertible from the Audit Log)", async () => {
    const created = await actions().save(...as(editor))({
      ...article,
      version: null,
      intent: "draft",
    });
    const id = created.ok ? created.data.id : "";
    expect(await actions().remove(...as(editor))({ id, version: 1 })).toMatchObject({ ok: true });
    expect((await store.get(id))?.deletedAt).toBeInstanceOf(Date);
    expect((await store.listForAdmin("news")).map((i) => i.id)).toEqual([]);
    expect(auditEntries().at(-1)).toMatchObject({
      action: "DELETE",
      after: null,
      revertible: true,
    });
    expect(REVERTIBLE_COLLECTIONS["content"]).toBe("content");
    expect(await actions().remove(...as(editor))({ id, version: 2 })).toMatchObject({
      error: "refused",
    });
  });

  it("refuses an article without its required fields, and keeps re-saving a scheduled article an UPDATE", async () => {
    expect(
      await actions().save(...as(editor))({
        ...article,
        slug: "",
        publishAt: null,
        summary: "",
        featuredImage: null,
        version: null,
        intent: "draft",
      }),
    ).toMatchObject({
      error: "invalid_input",
      fields: {
        slug: "Enter the URL.",
        publishAt: "Choose the publish date and time.",
        summary: "Write a short summary.",
        featuredImage: "Add a featured image.",
      },
    });
    const scheduled = await actions().save(...as(publisher))({
      ...article,
      publishAt: "2026-10-19T00:00:00.000Z",
      version: null,
      intent: "publish",
    });
    const id = scheduled.ok ? scheduled.data.id : "";
    await actions().save(...as(publisher))({
      ...article,
      id,
      publishAt: "2026-10-19T00:00:00.000Z",
      version: 1,
      intent: "publish",
    });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "UPDATE"]);
  });
});

describe("News CMS: published articles", () => {
  it("editing a public article keeps it an UPDATE and stores the featured image", async () => {
    const created = await actions().save(...as(publisher))({
      ...article,
      version: null,
      intent: "publish",
    });
    const id = created.ok ? created.data.id : "";
    await actions().save(...as(publisher))({
      ...article,
      id,
      version: 1,
      intent: "publish",
    });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "UPDATE"]);
    expect((await store.get(id))?.featuredImage).toEqual(image);
  });

  it("publishing a saved draft from the form is a PUBLISH", async () => {
    const created = await actions().save(...as(publisher))({
      ...article,
      version: null,
      intent: "draft",
    });
    const id = created.ok ? created.data.id : "";
    await actions().save(...as(publisher))({ ...article, id, version: 1, intent: "publish" });
    expect(auditEntries().map((e) => e["action"])).toEqual(["CREATE", "PUBLISH"]);
  });
});

describe("News CMS: articles saved before the image and date were required", () => {
  it("still publish and move to trash from the list (row menu / bulk bar)", async () => {
    const created = await actions().save(...as(publisher))({
      ...article,
      version: null,
      intent: "draft",
    });
    const id = created.ok ? created.data.id : "";
    // An older article: no featured image and no publish date in Firestore.
    const path = `content/${id}`;
    fake.docs.set(path, { ...fake.docs.get(path), featuredImage: null, publishAt: null });
    expect(
      await actions().setPublished(...as(publisher))({ id, version: 1, published: true }),
    ).toMatchObject({ ok: true });
    expect(auditEntries().at(-1)).toMatchObject({
      action: "PUBLISH",
      before: { status: "draft", publishAt: null },
    });
    expect(await actions().remove(...as(publisher))({ id, version: 2 })).toMatchObject({
      ok: true,
    });
  });
});

describe("content store reads", () => {
  it("lists live items newest first and ignores unknown ids and slugs", async () => {
    const first = await actions().save(...as(editor))({
      ...article,
      version: null,
      intent: "draft",
    });
    now = new Date("2026-10-18T06:00:00Z");
    const second = await actions().save(...as(editor))({
      ...article,
      slug: "kedua",
      version: null,
      intent: "draft",
    });
    expect((await store.listForAdmin("news")).map((i) => i.id)).toEqual([
      second.ok ? second.data.id : "",
      first.ok ? first.data.id : "",
    ]);
    expect(await store.get("bad/id")).toBeNull();
    expect(await store.get("missing")).toBeNull();
    expect(await store.findPublishedBySlug("news", "bad/slug", now)).toBeNull();
    expect(await store.findPublishedBySlug("news", "missing", now)).toBeNull();
    // A slug pointer whose article is gone.
    fake.docs.delete(`content/${second.ok ? second.data.id : ""}`);
    expect(await store.findPublishedBySlug("news", "kedua", now)).toBeNull();
    expect(
      await actions().save(...as(editor))({
        ...article,
        id: "missing",
        version: 1,
        intent: "draft",
      }),
    ).toMatchObject({ error: "refused", issues: ["This item does not exist."] });
  });
});

describe("public news reader (web)", () => {
  it("lists only visible news, newest first, and finds the detail by slug", async () => {
    const reader = createSqlNewsReader(fake.db as unknown as Db);
    const save = (slug: string, intent: "draft" | "publish", publishAt: string) =>
      actions().save(...as(publisher))({ ...article, slug, publishAt, version: null, intent });
    await save("draft", "draft", "2026-10-01T00:00:00.000Z");
    await save("future", "publish", "2026-10-30T00:00:00.000Z");
    await save("older", "publish", "2026-10-02T00:00:00.000Z");
    await save("newer", "publish", "2026-10-18T04:00:00.000Z");
    const gone = await save("deleted", "publish", "2026-10-03T00:00:00.000Z");
    await actions().remove(...as(publisher))({ id: gone.ok ? gone.data.id : "", version: 1 });

    const list = await reader.listVisible(now);
    expect(list.map((n) => n.slug)).toEqual(["newer", "older"]);
    expect(list[0]).not.toHaveProperty("body");
    expect(await reader.findBySlug("draft", now)).toBeNull();
    expect(await reader.findBySlug("future", now)).toBeNull();
    expect(await reader.findBySlug("newer", now)).toMatchObject({
      slug: "newer",
      body: '<p>Isi <a rel="noopener noreferrer">x</a></p>',
    });
  });
});
