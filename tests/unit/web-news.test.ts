import { describe, expect, it } from "vitest";
import type { PublicNews } from "@website/domain/content";
import { newsHref, newsQuery, newsRegionsOf, pageOfNews } from "../../apps/web/src/lib/news-query";

const item = (slug: string, extra: Partial<PublicNews> = {}): PublicNews => ({
  slug,
  title: slug,
  author: "Media",
  category: "seminar",
  location: null,
  summary: "",
  tags: [],
  publishAt: new Date("2026-10-18T00:00:00Z"),
  featuredImage: null,
  ...extra,
});

getBoilerplate();
function getBoilerplate() {}

describe("public news list query (/news?category&tag&region&time&page)", () => {
  it("accepts known categories, short tags, countries and positive pages; ignores the rest", () => {
    expect(newsQuery({})).toEqual({
      category: null,
      tag: null,
      q: null,
      time: null,
      region: null,
      page: 1,
    });
    expect(newsQuery({ category: "seminar", tag: " Riset ", page: "2" })).toEqual({
      category: "seminar",
      tag: "riset",
      q: null,
      time: null,
      region: null,
      page: 2,
    });
    expect(newsQuery({ category: "x", tag: "a".repeat(31), page: "-1" })).toEqual({
      category: null,
      tag: null,
      q: null,
      time: null,
      region: null,
      page: 1,
    });
    expect(
      newsQuery({ category: ["webinar", "x"], page: "1.5", region: "Indonesia" }),
    ).toMatchObject({
      category: "webinar",
      region: "Indonesia",
      page: 1,
    });
  });

  it("lists the countries of the news, from the last comma-separated part of the location", () => {
    const all = [
      item("no-location"),
      item("jakarta", { location: "Jakarta, Indonesia" }),
      item("kl", { location: "Kuala Lumpur, Malaysia" }),
      item("webinar", { location: "Jakarta (Webinar)" }),
    ];
    expect(newsRegionsOf(all)).toEqual(["Indonesia", "Malaysia", "Jakarta"]);
  });

  it("filters by category, country, tag and time, pages by 12 and clamps the page", () => {
    const all = [
      ...Array.from({ length: 13 }, (_, i) => item(`g${i}`)),
      item("riset", { category: "seminar", tags: ["riset"], location: "Jakarta, Indonesia" }),
      item("lama", {
        location: "Tokyo, Jepang",
        publishAt: new Date("2025-01-01T00:00:00Z"),
      }),
    ];
    const none = { category: null, tag: null, q: null, time: null, region: null } as const;
    expect(pageOfNews(all, { ...none, page: 2 })).toMatchObject({ page: 2, pages: 2 });
    expect(
      pageOfNews(
        all,
        { ...none, time: "year", page: 1 },
        new Date("2026-10-18T00:00:00Z"),
      ).items.map((n) => n.slug),
    ).not.toContain("lama");
    expect(
      pageOfNews(all, { ...none, region: "Indonesia", page: 1 }).items.map((n) => n.slug),
    ).toEqual(["riset"]);
    expect(
      pageOfNews(all, {
        category: "seminar",
        tag: "riset",
        q: null,
        time: null,
        region: null,
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
    expect(
      newsHref({ category: null, tag: null, q: null, time: null, region: null, page: 1 }, 1),
    ).toBe("/news");
    expect(
      newsHref(
        {
          category: "seminar",
          tag: "riset",
          q: null,
          time: "month",
          region: "Indonesia",
          page: 3,
        },
        3,
      ),
    ).toBe("/news?category=seminar&tag=riset&time=month&region=Indonesia&page=3");
  });
});
