import { describe, expect, it } from "vitest";
import type { ContentItem } from "@website/domain/content";
import {
  articleStatus,
  needsSettings,
  toArticleItem,
} from "../../apps/admin/src/components/articles-model";

const NOW = new Date("2026-10-18T10:00:00Z");
const item: ContentItem = {
  id: "n1",
  version: 2,
  kind: "news",
  slug: "berita",
  title: "Berita",
  body: "<p>x</p>",
  status: "scheduled",
  publishAt: new Date("2026-10-19T00:00:00Z"),
  chapterId: null,
  author: "Nevyllo Kalangi",
  category: "academic",
  summary: "Ringkas",
  tags: ["riset"],
  featuredImage: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

describe("Article page rows (server mapping)", () => {
  it("shows Scheduled until the date passes, then Published; drafts stay Draft", () => {
    expect(articleStatus(item, NOW)).toBe("scheduled");
    expect(articleStatus(item, new Date("2026-10-19T00:00:00Z"))).toBe("published");
    expect(articleStatus({ ...item, status: "published", publishAt: NOW }, NOW)).toBe("published");
    expect(articleStatus({ ...item, status: "draft" }, NOW)).toBe("draft");
    expect(articleStatus({ ...item, status: "archived" }, NOW)).toBe("draft");
  });

  it("maps labels, the byline, the last editor and dates to plain JSON for the client page", () => {
    const editor = { name: "Ana B.", email: "ana@example.org", initials: "AB" };
    const row = toArticleItem(item, NOW, editor);
    expect(row).toMatchObject({
      category: "Academic",
      categoryKey: "academic",
      author: "Nevyllo Kalangi",
      byline: { name: "Nevyllo K.", initials: "NK" },
      editor,
      image: "",
      url: "berita",
      publishAt: "2026-10-19T00:00:00.000Z",
      modifiedAt: NOW.toISOString(),
    });
    expect(toArticleItem({ ...item, author: " ", publishAt: null }, NOW, null)).toMatchObject({
      byline: null,
      editor: null,
      publishAt: null,
    });
  });
});

describe("Article editor → Settings panel", () => {
  it("opens Settings only when the server refused a field that lives in it", () => {
    expect(needsSettings({ title: "Enter a title." })).toBe(true);
    expect(needsSettings({ publishAt: "x", summary: "y" })).toBe(true);
    expect(needsSettings({ featuredImage: "Add a featured image." })).toBe(false);
    expect(needsSettings({ body: "x" })).toBe(false);
    expect(needsSettings({})).toBe(false);
  });
});
