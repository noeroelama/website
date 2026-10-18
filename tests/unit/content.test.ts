import { describe, expect, it } from "vitest";
import {
  formatNewsDate,
  NEWS_CATEGORIES,
  NewsInputSchema,
  normalizeTags,
  publishState,
  slugify,
} from "@website/domain/content";

const now = new Date("2026-10-18T05:00:00Z");
const later = new Date("2026-10-20T05:00:00Z");
const earlier = new Date("2026-10-01T05:00:00Z");

describe("news publishing rules (Publish now / Schedule / Save draft)", () => {
  it("Save draft keeps the date and never shows the article", () => {
    expect(publishState("draft", later, now)).toEqual({ status: "draft", publishAt: later });
    expect(publishState("draft", null, now)).toEqual({ status: "draft", publishAt: null });
  });

  it("Publish with no date or a past date publishes now; a future date schedules it", () => {
    expect(publishState("publish", null, now)).toEqual({ status: "published", publishAt: now });
    expect(publishState("publish", earlier, now)).toEqual({
      status: "published",
      publishAt: earlier,
    });
    expect(publishState("publish", later, now)).toEqual({ status: "scheduled", publishAt: later });
  });
});

describe("slugs, tags and categories", () => {
  it("builds a URL slug from the title (lower case, no accents, dashes)", () => {
    expect(slugify("Simposium PPI: Kolaborasi Asia–Oseania 2026!")).toBe(
      "simposium-ppi-kolaborasi-asia-oseania-2026",
    );
    expect(slugify("Café  Résumé")).toBe("cafe-resume");
    expect(slugify("!!!")).toBe("");
    expect(slugify("a".repeat(200))).toHaveLength(120);
  });

  it("tags are lower-cased, trimmed, unique and at most 10", () => {
    expect(normalizeTags([" Beasiswa ", "beasiswa", "", "Riset"])).toEqual(["beasiswa", "riset"]);
  });

  it("formats the publish date in Indonesian or English (UTC day)", () => {
    expect(formatNewsDate(now, "id")).toBe("18 Oktober 2026");
    expect(formatNewsDate(now, "en")).toBe("18 October 2026");
  });

  it("has the five flowchart categories", () => {
    expect(NEWS_CATEGORIES).toEqual([
      "general",
      "academic",
      "community",
      "announcement",
      "international",
    ]);
  });
});

describe("news form validation (strict)", () => {
  const valid = {
    title: "Simposium berakhir sukses",
    slug: "",
    author: "Divisi Media",
    category: "community",
    publishAt: "2026-10-20T05:00:00.000Z",
    summary: "Ringkasan singkat.",
    tags: ["Simposium"],
    body: "<p>Isi</p>",
    featuredImage: null,
  };

  it("accepts a complete article and normalises tags", () => {
    const parsed = NewsInputSchema.parse(valid);
    expect(parsed.tags).toEqual(["simposium"]);
    expect(parsed.publishAt).toEqual(later);
  });

  it("refuses missing required fields, unknown keys, too many tags and bad image URLs", () => {
    const issues = (input: unknown) => {
      const result = NewsInputSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((i) => String(i.path[0]));
    };
    expect(issues({ ...valid, title: "x" })).toContain("title");
    expect(issues({ ...valid, author: "" })).toContain("author");
    expect(issues({ ...valid, category: "sports" })).toContain("category");
    expect(issues({ ...valid, slug: "Bad Slug" })).toContain("slug");
    expect(issues({ ...valid, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toContain(
      "tags",
    );
    // Unknown keys (e.g. a client-chosen status) are refused as a whole.
    expect(NewsInputSchema.safeParse({ ...valid, status: "published" }).success).toBe(false);
    expect(
      issues({
        ...valid,
        featuredImage: {
          url: "javascript:alert(1)",
          thumbUrl: "https://x.example/t.webp",
          path: "content/images/a.webp",
          thumbPath: "content/images/a_thumb.webp",
          width: 10,
          height: 10,
        },
      }),
    ).toContain("featuredImage");
  });
});
