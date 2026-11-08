import { describe, expect, it } from "vitest";
import type { PublicNews } from "@website/domain/content";
import { newsHref, newsQuery, pageOfNews } from "../../apps/web/src/lib/news-query";

const item = (slug: string, extra: Partial<PublicNews> = {}): PublicNews => ({
  slug,
  title: slug,
  author: "Media",
  category: "general",
  summary: "",
  tags: [],
  publishAt: new Date("2026-10-18T00:00:00Z"),
  featuredImage: null,
  ...extra,
});

describe("public news list query (/news?category&tag&q&time&page)", () => {
  it("accepts known categories, short tags and positive pages; ignores the rest", () => {
    expect(newsQuery({})).toEqual({
      category: null,
      tag: null,
      q: null,
      time: null,
      page: 1,
    });
    expect(newsQuery({ category: "academic", tag: " Riset ", page: "2" })).toEqual({
      category: "academic",
      tag: "riset",
      q: null,
      time: null,
      page: 2,
    });
    expect(newsQuery({ category: "x", tag: "a".repeat(31), page: "-1" })).toEqual({
      category: null,
      tag: null,
      q: null,
      time: null,
      page: 1,
    });
    expect(newsQuery({ category: ["community", "x"], page: "1.5" })).toMatchObject({
      category: "community",
      page: 1,
    });
  });

  it("filters by category, tag and time, pages by 12 and clamps the page", () => {
    const all = [
      ...Array.from({ length: 13 }, (_, i) => item(`g${i}`)),
      item("riset", { category: "academic", tags: ["riset"] }),
      item("lama", {
        publishAt: new Date("2025-01-01T00:00:00Z"),
      }),
    ];
    const none = { category: null, tag: null, q: null, time: null } as const;
    expect(pageOfNews(all, { ...none, page: 2 })).toMatchObject({ page: 2, pages: 2 });
    expect(
      pageOfNews(
        all,
        { ...none, time: "year", page: 1 },
        new Date("2026-10-18T00:00:00Z"),
      ).items.map((n) => n.slug),
    ).not.toContain("lama");
    expect(
      pageOfNews(all, {
        category: "academic",
        tag: "riset",
        q: null,
        time: null,
        page: 1,
      }).items.map((n) => n.slug),
    ).toEqual(["riset"]);
    expect(pageOfNews([], { ...none, page: 1 })).toEqual({
      items: [],
      count: 0,
      page: 1,
      pages: 1,
    });
  });

  it("builds links that keep the filters", () => {
    expect(newsHref({ category: null, tag: null, q: null, time: null, page: 1 }, 1)).toBe("/news");
    expect(
      newsHref(
        {
          category: "academic",
          tag: "riset",
          q: null,
          time: "month",
          page: 3,
        },
        3,
      ),
    ).toBe("/news?category=academic&tag=riset&time=month&page=3");
  });
});
