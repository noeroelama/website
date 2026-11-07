import { describe, expect, it } from "vitest";
import {
  canDeletePeriod,
  periodDatesFromName,
  ChapterInputSchema,
  mapPosition,
  OrgUnitInputSchema,
  unitPeopleCount,
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
  description: "Wadah pelajar Indonesia di Jepang.",
  role: "Ketua",
  phone: "+81 90 1234 5678",
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
    const parsed = ChapterInputSchema.parse({
      ...valid,
      website: "",
      email: "",
      instagram: "",
      role: "",
      phone: "",
      region: "",
      mapNo: "",
    });
    expect(parsed).toMatchObject({
      countryCode: "JP",
      region: null,
      mapNo: null,
      website: null,
      email: null,
      instagram: null,
      role: null,
      phone: null,
    });
    expect(ChapterInputSchema.parse({ ...valid, region: "southeastAsia" }).region).toBe(
      "southeastAsia",
    );
    expect(ChapterInputSchema.safeParse({ ...valid, region: "atlantis" }).success).toBe(false);
    expect(ChapterInputSchema.parse({ ...valid, mapNo: "18" }).mapNo).toBe(18);
    expect(ChapterInputSchema.safeParse({ ...valid, mapNo: "0" }).success).toBe(false);
    expect(ChapterInputSchema.safeParse({ ...valid, mapNo: "abc" }).success).toBe(false);
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
        "active",
        "contactName",
        "contactPublic",
        "countryCode",
        "description",
        "email",
        "instagram",
        "logo",
        "mapNo",
        "name",
        "phone",
        "position",
        "region",
        "role",
        "slug",
        "socials",
        "timezone",
        "website",
      ].sort(),
    );
    expect(dto.position.x).toBeCloseTo(61.2, 0);
  });
});

describe("chapter condition fields (filled in by the national board)", () => {
  it("defaults to no members, no conditions and no risk; keeps what the board enters", () => {
    expect(ChapterInputSchema.parse(valid)).toMatchObject({
      memberCount: 0,
      conditions: [],
      risk: "none",
    });
    expect(
      ChapterInputSchema.parse({
        ...valid,
        memberCount: 200,
        conditions: ["Belum ada pengurus inti yang tercatat", "Tidak ada kontak resmi"],
        risk: "at_risk",
      }),
    ).toMatchObject({ memberCount: 200, risk: "at_risk", conditions: { length: 2 } });
  });

  it("refuses negative member counts, more than 5 conditions, empty ones and unknown risks", () => {
    for (const bad of [
      { memberCount: -1 },
      { memberCount: 1.5 },
      { conditions: Array(6).fill("x y") },
      { conditions: [""] },
      { risk: "vacuum" },
    ]) {
      expect(ChapterInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("the public DTO never carries the condition fields", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    const dto = toPublicChapter({
      id: "c1",
      version: 1,
      ...ChapterInputSchema.parse({ ...valid, memberCount: 5, risk: "at_risk" }),
      slug: "ppi-jepang",
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(dto).not.toHaveProperty("memberCount");
    expect(dto).not.toHaveProperty("conditions");
    expect(dto).not.toHaveProperty("risk");
  });
});

describe("periods and units (delete rules, cabinet members)", () => {
  it("reads a period's dates from its years: 1 January of the first to 31 December of the last", () => {
    expect(periodDatesFromName("2026-2027")).toEqual({
      startsOn: "2026-01-01",
      endsOn: "2027-12-31",
    });
    expect(periodDatesFromName(" 2026 / 2028 ")).toEqual({
      startsOn: "2026-01-01",
      endsOn: "2028-12-31",
    });
    for (const bad of ["2026", "2027-2026", "2026-2026", "Kabinet 2026", "26-27"]) {
      expect(periodDatesFromName(bad), bad).toBeNull();
    }
  });

  it("only the active period cannot be deleted", () => {
    expect(canDeletePeriod("active")).toBe(false);
    expect(canDeletePeriod("draft")).toBe(true);
    expect(canDeletePeriod("archived")).toBe(true);
  });

  const unit = {
    periodId: "p1",
    parentId: null,
    name: "Direktorat Media",
    code: "med",
    type: "direktorat",
    description: "",
    sort: 0,
    active: true,
  };
  const person = (name: string, head = false) => ({
    name,
    role: "Staff Bidang",
    head,
    photo: null,
  });

  it("a unit keeps its core members and divisions (names for the cabinet photo, no accounts)", () => {
    expect(OrgUnitInputSchema.parse(unit)).toMatchObject({ members: [], divisions: [] });
    const parsed = OrgUnitInputSchema.parse({
      ...unit,
      members: [person("Sari", true), person("Budi")],
      divisions: [
        { name: "Bidang Audit", members: [person("Ayu", true), person("Dewi")] },
        { name: "Bidang Desain", members: [] },
      ],
    });
    expect(parsed.code).toBe("MED");
    expect(unitPeopleCount(parsed)).toBe(4);
  });

  it("refuses members without a name or role, divisions without a name and unknown keys", () => {
    for (const bad of [
      { members: [{ ...person("Sari"), name: "" }] },
      { members: [{ ...person("Sari"), role: "" }] },
      { members: [{ ...person("Sari"), userId: "u1" }] },
      { divisions: [{ name: "", members: [] }] },
      { divisions: [{ name: "Bidang", members: Array(51).fill(person("Sari")) }] },
    ]) {
      expect(OrgUnitInputSchema.safeParse({ ...unit, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
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
    expect(row).toMatchObject({
      country: "Japan",
      countryCode: "JP",
      active: false,
      utcOffset: "UTC+09:00",
    });
  });
});
