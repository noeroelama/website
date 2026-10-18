import { describe, expect, it } from "vitest";
import {
  ChapterInputSchema,
  mapPosition,
  toPublicChapter,
  type Chapter,
} from "@website/domain/organizations";

const valid = {
  name: "PPI Jepang",
  countryCode: "jp",
  timezone: "Asia/Tokyo",
  logo: null,
  contactName: "Sari",
  contactPublic: "humas@ppijepang.org",
  website: "https://ppijepang.org",
  email: "info@ppijepang.org",
  instagram: "@ppijepang",
  socials: [{ label: "YouTube", url: "https://youtube.com/@ppijepang" }],
  latitude: 36.2,
  longitude: 138.25,
  slug: "",
};

describe("chapters (PPI Negara, feature A2)", () => {
  it("accepts a complete chapter; the country code is upper-cased; empty optionals become null", () => {
    const parsed = ChapterInputSchema.parse({ ...valid, website: "", email: "", instagram: "" });
    expect(parsed).toMatchObject({
      countryCode: "JP",
      website: null,
      email: null,
      instagram: null,
    });
  });

  it("refuses bad country codes, zones, links, e-mails, coordinates and unknown keys", () => {
    for (const bad of [
      { countryCode: "JPN" },
      { timezone: "Tokyo" },
      { website: "javascript:x" },
      { email: "not-an-email" },
      { latitude: 91 },
      { longitude: -181 },
      { socials: [{ label: "X", url: "ftp://x" }] },
      { socials: Array(6).fill({ label: "X", url: "https://x.example" }) },
      { name: "P" },
      { active: true },
    ]) {
      expect(ChapterInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("places markers on the Asia–Oceania map from latitude and longitude (percent of the box)", () => {
    // Reference points of the PPIDK map (PetaKawasan): Astana, Tokyo, Wellington.
    const close = (p: { x: number; y: number }, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 0);
      expect(p.y).toBeCloseTo(y, 0);
    };
    close(mapPosition(51.17, 71.43), 9.02, 21.62);
    close(mapPosition(35.68, 139.69), 62.45, 32.55);
    close(mapPosition(-41.29, 174.78), 89.73, 87.34);
    expect(mapPosition(85, -10)).toEqual({ x: 0, y: 0 });
    expect(mapPosition(-80, 190)).toEqual({ x: 100, y: 100 });
  });

  it("the public DTO carries only public fields", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    const chapter: Chapter = {
      id: "c1",
      version: 3,
      ...ChapterInputSchema.parse(valid),
      slug: "ppi-jepang",
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const dto = toPublicChapter(chapter);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "contactName",
        "contactPublic",
        "countryCode",
        "email",
        "instagram",
        "logo",
        "name",
        "position",
        "slug",
        "socials",
        "timezone",
        "website",
      ].sort(),
    );
    expect(dto.position.x).toBeCloseTo(61.2, 0);
  });
});

describe("Organizations → PPI rows (server mapping)", () => {
  it("adds the English country name", async () => {
    const { toChapterItem } = await import("../../apps/admin/src/components/chapters-model");
    const now = new Date("2026-10-18T00:00:00Z");
    const row = toChapterItem({
      id: "c1",
      version: 1,
      ...ChapterInputSchema.parse(valid),
      slug: "ppi-jepang",
      active: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(row).toMatchObject({ country: "Japan", countryCode: "JP", active: false });
  });
});
