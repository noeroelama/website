import { describe, expect, it } from "vitest";
import { SUGGESTED_APPOINTMENT_ROLES } from "@website/domain/organizations";
import { mapPpidk, parseTsv, type PpidkTables } from "../../packages/db/src/ppidk/people";

const tsv = (header: string[], rows: string[][]) =>
  parseTsv([header.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n") + "\n");
const now = new Date("2026-10-19T00:00:00Z");

const tables: PpidkTables = {
  users: tsv(
    ["id", "name", "email", "is_active", "timezone"],
    [
      ["1", "Ana", "Ana@Example.org", "1", "Asia/Tokyo"],
      ["2", "Rio", "rio@example.org", "0", "NULL"],
      ["3", "No Mail", "NULL", "1", "NULL"],
    ],
  ),
  chapters: tsv(
    [
      "id",
      "name",
      "slug",
      "country_code",
      "timezone",
      "website",
      "email",
      "instagram",
      "is_active",
    ],
    [["7", "PPI Jepang", "jepang", "JP", "Asia/Tokyo", "NULL", "NULL", "@ppijepang", "1"]],
  ),
  universities: tsv(
    [
      "id",
      "name",
      "country_code",
      "city",
      "website",
      "aliases",
      "ror_id",
      "status",
      "submitted_by_user_id",
      "merged_into_id",
      "reviewed_by_user_id",
      "reviewed_at",
      "review_note",
    ],
    [
      [
        "11",
        "The University of Tokyo",
        "JP",
        "Tokyo",
        "NULL",
        '["UTokyo"]',
        "https://ror.org/057zh3y96",
        "approved",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
      ],
      [
        "12",
        "Tokyo Univ",
        "JP",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "rejected",
        "1",
        "11",
        "2",
        "2026-08-20 10:00:00",
        "Duplikat",
      ],
    ],
  ),
  periods: tsv(
    [
      "id",
      "name",
      "year_label",
      "cabinet_name",
      "starts_on",
      "ends_on",
      "is_active",
      "archived_at",
      "lpj_deadline_days",
    ],
    [
      [
        "1",
        "Kepengurusan 2025/2026",
        "2025/2026",
        "NULL",
        "2025-11-01",
        "2026-10-31",
        "0",
        "2026-11-01 00:00:00",
        "NULL",
      ],
      [
        "2",
        "Kepengurusan 2026/2027",
        "2026/2027",
        "Kolaborasi",
        "2026-11-01",
        "2027-10-31",
        "1",
        "NULL",
        "30",
      ],
    ],
  ),
  org_units: tsv(
    ["id", "period_id", "parent_id", "name", "code", "type", "description", "sort", "is_active"],
    [
      ["100", "2", "NULL", "Koordinator", "koor", "koordinator", "NULL", "0", "1"],
      ["101", "2", "100", "Direktorat Media", "MED", "direktorat", "Tupoksi", "1", "1"],
      ["102", "2", "101", "Bidang Desain", "MED-DSN", "bidang", "NULL", "0", "1"],
      ["103", "2", "100", "Lama", "OLD", "unit_aneh", "NULL", "0", "0"],
    ],
  ),
  profiles: tsv(
    [
      "id",
      "user_id",
      "full_name",
      "gender",
      "birth_date",
      "phone_wa",
      "chapter_id",
      "university_id",
      "degree_level",
      "major",
      "study_start_year",
      "study_expected_end_year",
      "address_abroad",
      "city_abroad",
      "address_home",
      "home_province_code",
      "home_regency_code",
      "verification_status",
      "verified_by_user_id",
      "verified_at",
      "graduated_on",
      "graduation_marked_by_user_id",
    ],
    [
      [
        "1",
        "1",
        "Ana Putri",
        "P",
        "2001-05-20",
        "+6281234567890",
        "7",
        "11",
        "s2",
        "Teknik Sipil",
        "2025",
        "2027",
        "1-2-3 Sakyo",
        "Kyoto",
        "Jl. Merdeka 10",
        "32",
        "32.73",
        "verified",
        "2",
        "2026-08-21 09:00:00",
        "NULL",
        "NULL",
      ],
      [
        "2",
        "3",
        "No Mail",
        "L",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
        "unverified",
        "NULL",
        "NULL",
        "NULL",
        "NULL",
      ],
    ],
  ),
  appointments: tsv(
    [
      "id",
      "period_id",
      "org_unit_id",
      "user_id",
      "title",
      "is_head",
      "starts_on",
      "ends_on",
      "status",
      "created_at",
    ],
    [
      [
        "500",
        "2",
        "101",
        "1",
        "Direktur Media",
        "1",
        "2026-11-01",
        "NULL",
        "active",
        "2026-10-01 00:00:00",
      ],
      [
        "501",
        "2",
        "102",
        "2",
        "Sekretaris Bidang",
        "0",
        "NULL",
        "2026-12-01",
        "ended",
        "2026-10-01 00:00:00",
      ],
      ["502", "1", "101", "1", "Staf", "0", "2025-11-01", "NULL", "active", "2025-11-01 00:00:00"],
      ["503", "2", "999", "1", "Hilang", "0", "NULL", "NULL", "active", "2026-10-01 00:00:00"],
      ["504", "2", "100", "3", "Tanpa akun", "0", "NULL", "NULL", "active", "2026-10-01 00:00:00"],
    ],
  ),
  role_assignments: tsv(
    ["id", "user_id", "role_id", "scope_type", "appointment_id", "revoked_at"],
    [
      ["1", "1", "4", "global", "500", "NULL"],
      ["2", "2", "9", "chapter", "NULL", "NULL"],
      ["3", "2", "9", "global", "NULL", "2026-09-01 00:00:00"],
    ],
  ),
  provinces: tsv(["code", "name"], [["32", "Jawa Barat"]]),
  regencies: tsv(["code", "province_code", "name"], [["32.73", "32", "Kota Bandung"]]),
};

const plan = mapPpidk(tables, {
  uidOf: (id) => (id === "1" ? "firebase-ana" : `ppidk-${id}`),
  roleMap: SUGGESTED_APPOINTMENT_ROLES,
  now,
});
const doc = (path: string) => plan.writes.find((w) => w.path === path)?.data;

describe("PPIDK people import (block J)", () => {
  it("parses mysql --batch TSV: NULL and escapes", () => {
    expect(parseTsv("a\tb\nx\\ty\tNULL\nline\\nbreak\\\\\t\n")).toEqual([
      { a: "x\ty", b: null },
      { a: "line\nbreak\\", b: "" },
    ]);
    expect(parseTsv("a\tb\nonly-one\n")).toEqual([{ a: "only-one", b: null }]);
  });

  it("imports people by e-mail; rows it cannot place are reported, not guessed", () => {
    expect(plan.people).toEqual([
      { ppidkId: "1", email: "ana@example.org", name: "Ana", active: true },
      { ppidkId: "2", email: "rio@example.org", name: "Rio", active: false },
    ]);
    expect(plan.skipped).toEqual([
      { table: "users", id: "3", reason: "no e-mail" },
      { table: "profiles", id: "2", reason: "user not imported" },
      { table: "appointments", id: "503", reason: "unit not imported" },
      { table: "appointments", id: "504", reason: "user not imported" },
      {
        table: "role_assignments",
        id: "2",
        reason: "manual role 9 (chapter) of user 2: grant again on the Users page",
      },
    ]);
    expect(plan.counts).toMatchObject({ users: 2, memberProfiles: 1, appointments: 4, periods: 2 });
  });

  it("maps the organisation: chapters, periods (one active), units with paths, universities", () => {
    expect(doc("chapters/ppidk-chapter-7")).toMatchObject({ countryCode: "JP", active: true });
    expect(doc("chapterSlugs/jepang")).toEqual({ id: "ppidk-chapter-7" });
    expect(doc("periods/ppidk-period-1")).toMatchObject({
      status: "archived",
      lpjDeadlineDays: 14,
    });
    expect(doc("periods/ppidk-period-2")).toMatchObject({
      name: "2026/2027",
      status: "active",
      lpjDeadlineDays: 30,
    });
    expect(doc("settings/activePeriod")).toMatchObject({ periodId: "ppidk-period-2" });
    expect(doc("orgUnits/ppidk-unit-102")).toMatchObject({
      parentId: "ppidk-unit-101",
      path: ["ppidk-unit-100", "ppidk-unit-101"],
      code: "MED-DSN",
      type: "bidang",
    });
    expect(doc("orgUnits/ppidk-unit-103")).toMatchObject({ type: "staf", active: false });
    expect(doc("orgUnitCodes/ppidk-period-2_KOOR")).toEqual({ id: "ppidk-unit-100" });
    expect(doc("universities/057zh3y96_JP")).toMatchObject({
      status: "approved",
      aliasesNormalized: ["utokyo"],
      source: "ror",
    });
    expect(doc("universities/ppidk-university-12")).toMatchObject({
      status: "rejected",
      mergedInto: "057zh3y96_JP",
      submittedBy: "firebase-ana",
      reviewedBy: "ppidk-2",
      reviewedAt: new Date("2026-08-20T10:00:00Z"),
    });
  });

  it("maps profiles (incomplete until the member agrees again) and gives appointment roles", () => {
    expect(doc("memberProfiles/firebase-ana")).toMatchObject({
      email: "ana@example.org",
      gender: "female",
      ppiCountry: "JP",
      university: "The University of Tokyo",
      universityId: "057zh3y96_JP",
      educationLevel: "master",
      majors: ["Teknik Sipil"],
      addressIndonesia: { city: "Kota Bandung", province: "Jawa Barat" },
      chapterId: "ppidk-chapter-7",
      verificationStatus: "verified",
      verifiedBy: "ppidk-2",
    });
    expect(doc("memberProfiles/firebase-ana")?.["privacyPolicyVersion"]).not.toBe("2026-10-18");
    expect(doc("appointments/ppidk-appointment-501")).toMatchObject({
      seat: "secretary",
      status: "ended",
      startsOn: "2026-10-01",
    });
    const ana = doc("users/firebase-ana");
    expect(ana).toMatchObject({
      status: "active",
      chapterId: "ppidk-chapter-7",
      roleIds: ["user", "member", "officer", "director"],
    });
    expect((ana?.["roleAssignments"] as unknown[]).slice(2)).toEqual([
      {
        roleId: "officer",
        scope: { type: "global" },
        periodId: "ppidk-period-2",
        source: "appointment",
        revokedAt: null,
        appointmentId: "ppidk-appointment-500",
      },
      {
        roleId: "director",
        scope: { type: "orgUnit", orgUnitId: "ppidk-unit-101" },
        periodId: "ppidk-period-2",
        source: "appointment",
        revokedAt: null,
        appointmentId: "ppidk-appointment-500",
      },
    ]);
    expect(doc("users/ppidk-2")).toMatchObject({ status: "inactive", roleIds: ["user"] });
    expect(plan.writes.find((w) => w.path === "users/ppidk-2")?.mode).toBe("user");
  });

  it("reuses a chapter staff already added for the same country", () => {
    const reused = mapPpidk(tables, {
      uidOf: (id) => `ppidk-${id}`,
      roleMap: SUGGESTED_APPOINTMENT_ROLES,
      now,
      chapterIdByCountry: new Map([["JP", "staff-jp"]]),
    });
    expect(reused.writes.some((w) => w.path.startsWith("chapter"))).toBe(false);
    expect(reused.writes.find((w) => w.path === "memberProfiles/ppidk-1")?.data).toMatchObject({
      chapterId: "staff-jp",
    });
  });

  it("is deterministic: the same input gives the same documents (safe to run again)", () => {
    const again = mapPpidk(tables, {
      uidOf: (id) => (id === "1" ? "firebase-ana" : `ppidk-${id}`),
      roleMap: SUGGESTED_APPOINTMENT_ROLES,
      now,
    });
    expect(again).toEqual(plan);
  });
});
