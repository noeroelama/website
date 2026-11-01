import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlAppointmentStore,
  createSqlMemberProfileStore,
  createSqlUniversityStore,
} from "@website/db/sql";
import { PRIVACY_POLICY_VERSION, studyStatus } from "@website/domain/members";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlMemberProfileStore>[0];
const now = new Date("2026-10-19T05:00:00Z");
const input = (changes: Record<string, unknown> = {}) => ({
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-05-20",
  ppiCountry: "JP",
  university: "Kyoto University",
  educationLevel: "master",
  majors: ["Civil Engineering"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  addressAbroad: { line1: "1-2-3 Sakyo-ku", city: "Kyoto", countryCode: "JP" },
  addressIndonesia: { line1: "Jl. Merdeka 10", city: "Kota Bandung", province: "Jawa Barat" },
  whatsappNumber: "+6281234567890",
  emergencyContact: { phone: "+6281111111111" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, accepted: true },
  ...changes,
});
const member = (uid: string) => ({ uid, email: `${uid}@example.org`, emailVerified: true });

let fake: ReturnType<typeof fakeDb>;
let profiles: ReturnType<typeof createSqlMemberProfileStore>;
const own = () =>
  createOwnProfile({
    profiles,
    universities: createSqlUniversityStore(fake.db as unknown as Db),
    now: () => now,
  });
const audit = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);

beforeEach(async () => {
  fake = fakeDb();
  profiles = createSqlMemberProfileStore(fake.db as unknown as Db);
  fake.docs.set("chapters/ch-jp", { countryCode: "JP", active: true });
  fake.docs.set("chapters/ch-kr", { countryCode: "KR", active: true });
  for (const uid of ["siti", "kim"]) fake.docs.set(`users/${uid}`, { uid, version: 1 });
  await own().save(member("siti"), { version: null, profile: input() });
  await own().save(member("kim"), {
    version: null,
    profile: input({ fullName: "Kim Lee", ppiCountry: "KR" }),
  });
});

describe("the member's own profile changes (PPIDK §63 without verification)", () => {
  it("every change applies at once; name, gender, birth date, PPI country and campus changes are audited, redacted", async () => {
    expect(
      await own().save(member("siti"), {
        version: 1,
        profile: input({ fullName: "Siti Rahmawati", dateOfBirth: "2001-05-21" }),
      }),
    ).toEqual({ ok: true, version: 2 });
    expect(await profiles.findByUserId("siti")).toMatchObject({ fullName: "Siti Rahmawati" });
    expect(audit().at(-1)).toMatchObject({
      actor: { type: "member", id: "siti" },
      module: "members",
      resourceType: "profile",
      before: { fullName: "Siti Rahma", dateOfBirth: "[previous]" },
      after: { fullName: "Siti Rahmawati", dateOfBirth: "[changed]" },
    });
    // Free fields are not audited.
    const entries = audit().length;
    await own().save(member("siti"), {
      version: 2,
      profile: input({ fullName: "Siti Rahmawati", dateOfBirth: "2001-05-21", timezone: "UTC" }),
    });
    expect(audit()).toHaveLength(entries);
  });

  it("a new PPI country moves the member's chapter at once", async () => {
    expect(
      await own().save(member("siti"), { version: 1, profile: input({ ppiCountry: "KR" }) }),
    ).toEqual({ ok: true, version: 2 });
    expect(await profiles.findByUserId("siti")).toMatchObject({ chapterId: "ch-kr" });
    expect(fake.docs.get("users/siti")).toMatchObject({ chapterId: "ch-kr" });
  });

  it("old verification data (status, pending change request) no longer blocks or alters a save", async () => {
    fake.docs.set("memberProfiles/siti", {
      ...fake.docs.get("memberProfiles/siti"),
      verificationStatus: "verified",
      verifiedBy: "officer",
      verifiedAt: now,
    });
    fake.docs.set("profileChangeRequests/siti", { userId: "siti", status: "pending" });
    expect(
      await own().save(member("siti"), { version: 1, profile: input({ fullName: "Siti R." }) }),
    ).toEqual({ ok: true, version: 2 });
    const saved = await profiles.findByUserId("siti");
    expect(saved).toMatchObject({ fullName: "Siti R." });
    expect(saved).not.toHaveProperty("verificationStatus");
    expect(fake.docs.get("memberProfiles/siti")).not.toHaveProperty("verificationStatus");
  });
});

describe("graduation: student, graduating, alumni (B5, PPIDK §67)", () => {
  it("is computed from the date only", () => {
    expect(studyStatus(null, "2026-10-19")).toBe("student");
    expect(studyStatus("2026-12-01", "2026-10-19")).toBe("graduating");
    expect(studyStatus("2026-10-19", "2026-10-19")).toBe("alumni");
  });

  it("the member marks it at once; cancelling is only for a mark they set themselves", async () => {
    expect(
      await own().setGraduation(member("siti"), { version: 1, graduatedOn: "2024-03-01" }),
    ).toEqual({
      ok: false,
      message: "The graduation date cannot be before the year of entry (2025).",
    });
    expect(
      await own().setGraduation(member("siti"), { version: 1, graduatedOn: "2037-01-01" }),
    ).toEqual({
      ok: false,
      message: "The graduation date is too far in the future: check the year.",
    });
    expect(await own().setGraduation(null, { version: 1, graduatedOn: null })).toEqual({
      ok: false,
      message: "invalid",
    });
    expect(
      await own().setGraduation(member("siti"), { version: 1, graduatedOn: "2027-03-25" }),
    ).toEqual({
      ok: true,
    });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      graduation: { on: "2027-03-25", markedBy: "siti" },
    });
    expect(audit().at(-1)).toMatchObject({ actor: { type: "member", id: "siti" } });
    expect(await own().setGraduation(member("siti"), { version: 2, graduatedOn: null })).toEqual({
      ok: true,
    });
    expect(await own().setGraduation(member("siti"), { version: 2, graduatedOn: null })).toEqual({
      ok: false,
      message: "conflict",
    });

    // Marked by an officer in PPIDK (imported): the member cannot cancel it.
    fake.docs.set("memberProfiles/siti", {
      ...fake.docs.get("memberProfiles/siti"),
      graduatedOn: "2026-09-30",
      graduationMarkedBy: "officer",
    });
    expect(await own().setGraduation(member("siti"), { version: 3, graduatedOn: null })).toEqual({
      ok: false,
      message: "This graduation was marked by an officer; ask the secretariat to cancel it.",
    });
  });

  it("graduated officers become a dashboard item; the appointment is not ended", async () => {
    const db = fake.db as unknown as Db;
    fake.docs.set("settings/activePeriod", { periodId: "p2026" });
    for (const [id, userId] of [
      ["a1", "siti"],
      ["a2", "kim"],
    ] as const) {
      fake.docs.set(`appointments/${id}`, {
        userId,
        name: userId,
        periodId: "p2026",
        orgUnitId: "media",
        seat: "member",
        title: "Staf",
        status: "active",
        startsOn: "2026-10-01",
        endsOn: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        deletedAt: null,
      });
    }
    await own().setGraduation(member("siti"), { version: 1, graduatedOn: "2026-09-30" });
    await own().setGraduation(member("kim"), { version: 1, graduatedOn: "2027-03-01" });
    const appointments = createSqlAppointmentStore(db);
    expect((await appointments.graduatedOfficers("2026-10-19")).map((a) => a.name)).toEqual([
      "siti",
    ]);
    expect(await appointments.get("a1")).toMatchObject({ status: "active" });
    fake.docs.delete("settings/activePeriod");
    expect(await appointments.graduatedOfficers("2026-10-19")).toEqual([]);
  });
});
