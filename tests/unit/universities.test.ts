import { describe, expect, it } from "vitest";
import {
  mergeCandidates,
  normalizeUniversityName,
  tidyUniversityName,
  universityRowsFromRor,
} from "@website/domain/members";

describe("university names (A3, PPIDK DECISIONS §6)", () => {
  it("normalises conservatively: case, punctuation, spacing and common short forms only", () => {
    // PPIDK regression: dropping "national"/"university" collapsed NUS into "singapore".
    const nus = normalizeUniversityName("National University of Singapore");
    expect(nus).not.toBe(normalizeUniversityName("Singapore Management University"));
    expect(nus).toContain("national");
    expect(normalizeUniversityName("The University of Tokyo")).toBe(
      normalizeUniversityName("the univ. of TOKYO"),
    );
    expect(normalizeUniversityName("Universitas Gadjah Mada")).toBe("university gadjah mada");
    expect(normalizeUniversityName("Institut Teknologi Bandung")).toBe(
      "institute technology bandung",
    );
    expect(normalizeUniversityName("Universiti Malaya")).toBe("university malaya");
    expect(normalizeUniversityName("École  Polytechnique")).toBe("ecole polytechnique");
    expect(normalizeUniversityName("x".repeat(300))).toHaveLength(255);
  });

  it("tidies ALL CAPS or all lower case submissions, and leaves official spellings alone", () => {
    expect(tidyUniversityName("KYOTO INSTITUTE OF   TECHNOLOGY")).toBe(
      "Kyoto Institute of Technology",
    );
    expect(tidyUniversityName("the university of tokyo")).toBe("The University of Tokyo");
    expect(tidyUniversityName("iCLA Yamanashi Gakuin University")).toBe(
      "iCLA Yamanashi Gakuin University",
    );
  });
});

describe("ROR dump rows (DECISIONS §7, §7b)", () => {
  const countries = new Set(["JP", "SG"]);
  const tokyo = {
    id: "https://ror.org/057zh3y96",
    status: "active",
    types: ["education", "funder"],
    names: [
      { value: "The University of Tokyo", types: ["ror_display", "label"] },
      { value: "UTokyo", types: ["acronym"] },
      { value: "Todai", types: ["alias"] },
    ],
    links: [{ type: "website", value: "https://www.u-tokyo.ac.jp" }],
    locations: [
      { geonames_details: { country_code: "JP", name: "Tokyo" } },
      { geonames_details: { country_code: "JP", name: "Kashiwa" } },
      { geonames_details: { country_code: "SG", name: "Singapore" } },
      { geonames_details: { country_code: "US", name: "Boston" } },
    ],
  };

  it("makes one row per relevant country, keyed by ROR id and country", () => {
    const rows = universityRowsFromRor(tokyo, countries);
    expect(rows.map((r) => r.id)).toEqual(["057zh3y96_JP", "057zh3y96_SG"]);
    expect(rows[0]).toEqual({
      id: "057zh3y96_JP",
      rorId: "https://ror.org/057zh3y96",
      name: "The University of Tokyo",
      normalizedName: "university tokyo",
      countryCode: "JP",
      city: "Tokyo",
      website: "https://www.u-tokyo.ac.jp",
      aliases: ["UTokyo", "Todai"],
      aliasesNormalized: ["utokyo", "todai"],
    });
  });

  it("skips inactive, non-education and nameless records and other countries", () => {
    expect(universityRowsFromRor({ ...tokyo, status: "inactive" }, countries)).toEqual([]);
    expect(universityRowsFromRor({ ...tokyo, types: ["company"] }, countries)).toEqual([]);
    expect(universityRowsFromRor({ ...tokyo, names: [] }, countries)).toEqual([]);
    expect(universityRowsFromRor({ ...tokyo, id: 7 }, countries)).toEqual([]);
    expect(universityRowsFromRor(tokyo, new Set(["KR"]))).toEqual([]);
    expect(universityRowsFromRor(null, countries)).toEqual([]);
    // No display name: the first name; no website link: null; no city: null.
    const [row] = universityRowsFromRor(
      {
        id: "https://ror.org/x1",
        status: "active",
        types: ["education"],
        names: [{ value: "Kyoto University", types: ["label"] }],
        locations: [{ geonames_details: { country_code: "JP" } }],
      },
      countries,
    );
    expect(row).toMatchObject({ name: "Kyoto University", city: null, website: null, aliases: [] });
  });
});

describe("merge candidates for a submitted campus", () => {
  it("offers approved campuses of the same country that share a distinctive word", () => {
    const approved = [
      { id: "a", name: "The University of Tokyo", countryCode: "JP" },
      { id: "b", name: "Tokyo Institute of Technology", countryCode: "JP" },
      { id: "c", name: "Kyoto University", countryCode: "JP" },
      { id: "d", name: "University of Tokyo Hospital", countryCode: "SG" },
    ];
    expect(
      mergeCandidates({ name: "Tokyo Univ", countryCode: "JP" }, approved).map((u) => u.id),
    ).toEqual(["a", "b"]);
    // Generic words alone ("University of") are no hint.
    expect(mergeCandidates({ name: "University of", countryCode: "JP" }, approved)).toEqual([]);
  });
});
