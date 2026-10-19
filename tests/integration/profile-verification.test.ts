import { beforeEach, describe, expect, it } from "vitest";
import {
  createFirestoreAppointmentStore,
  createFirestoreMemberProfileStore,
  createFirestoreUniversityStore,
} from "@website/db/firestore";
import { PRIVACY_POLICY_VERSION, studyStatus } from "@website/domain/members";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createMemberActions } from "../../apps/admin/src/server/members";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreMemberProfileStore>[0];
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
const verifier = (scope: Scope, userId = "verifier"): Principal => ({
  kind: "user",
  userId,
  active: true,
  assignments: [
    { roleId: "v", scope, permissions: new Set(normalizePermissions(["members.verify"])) },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "v@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeFirestore>;
let profiles: ReturnType<typeof createFirestoreMemberProfileStore>;
const own = () =>
  createOwnProfile({
    profiles,
    universities: createFirestoreUniversityStore(fake.db as unknown as Db),
    now: () => now,
  });
const staff = () => createMemberActions({ profiles, now: () => now });
const audit = () =>
  [...fake.docs.entries()].filter(([p]) => p.startsWith("auditLogs/")).map(([, d]) => d);
const jp = { type: "chapter", chapterId: "ch-jp" } as const;
const kr = { type: "chapter", chapterId: "ch-kr" } as const;

beforeEach(async () => {
  fake = fakeFirestore();
  profiles = createFirestoreMemberProfileStore(fake.db as unknown as Db);
  fake.docs.set("chapters/ch-jp", { countryCode: "JP", active: true });
  fake.docs.set("chapters/ch-kr", { countryCode: "KR", active: true });
  for (const uid of ["siti", "kim", "verifier"]) fake.docs.set(`users/${uid}`, { uid, version: 1 });
  await own().save(member("siti"), { version: null, profile: input() });
  await own().save(member("kim"), {
    version: null,
    profile: input({ fullName: "Kim Lee", ppiCountry: "KR" }),
  });
});

describe("profile verification and change requests (B4, PPIDK §63, §73)", () => {
  it("before verification the member changes everything at once; guarded changes are audited, redacted", async () => {
    expect(
      await own().save(member("siti"), {
        version: 1,
        profile: input({ fullName: "Siti Rahmawati", dateOfBirth: "2001-05-21" }),
      }),
    ).toEqual({ ok: true, version: 2, pendingReview: false });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      fullName: "Siti Rahmawati",
      verification: { status: "unverified" },
    });
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

  it("a verifier of the member's chapter verifies; never another chapter, nobody without the permission, never oneself", async () => {
    expect(await staff().verify(...as(verifier(kr)))({ uid: "siti", version: 1 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const nobody: Principal = { ...verifier(jp), assignments: [] };
    expect(await staff().verify(...as(nobody))({ uid: "siti", version: 1 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await staff().verify(...as(verifier(jp, "siti")))({ uid: "siti", version: 1 }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("own data")] });
    expect(await staff().verify(...as(verifier(jp)))({ uid: "siti", version: 1 })).toEqual({
      ok: true,
      data: { version: 2 },
    });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      verification: { status: "verified", verifiedBy: "verifier", verifiedAt: now },
    });
    expect(
      await staff().verify(...as(verifier({ type: "global" })))({ uid: "siti", version: 2 }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("already verified")] });
    expect(await profiles.listToVerify("all")).toHaveLength(1);
    expect((await profiles.listToVerify(["ch-kr"])).map((p) => p.userId)).toEqual(["kim"]);
    expect(await profiles.listToVerify([])).toEqual([]);
  });

  it("after verification, guarded changes wait for review while free fields apply; one request at a time", async () => {
    await staff().verify(...as(verifier(jp)))({ uid: "siti", version: 1 });
    expect(
      await own().save(member("siti"), {
        version: 2,
        profile: input({ fullName: "Siti R.", ppiCountry: "KR", timezone: "UTC" }),
      }),
    ).toEqual({ ok: true, version: 3, pendingReview: true });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      fullName: "Siti Rahma",
      ppiCountry: "JP",
      timezone: "UTC",
      chapterId: "ch-jp",
    });
    expect(
      await own().save(member("siti"), {
        version: 3,
        profile: input({ fullName: "Siti X", timezone: "UTC" }),
      }),
    ).toEqual({ ok: false, error: "pending" });

    // §73: the queue and the decision stay inside the member's chapter.
    expect(await profiles.listChangeRequests(["ch-kr"])).toEqual([]);
    expect((await profiles.listChangeRequests(["ch-jp"]))[0]).toMatchObject({
      userId: "siti",
      changes: { fullName: { from: "Siti Rahma", to: "Siti R." }, ppiCountry: { to: "KR" } },
    });
    expect(
      await staff().decide(...as(verifier(kr)))({
        uid: "siti",
        version: 3,
        approve: true,
        note: "",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await staff().decide(...as(verifier(jp, "siti")))({
        uid: "siti",
        version: 3,
        approve: true,
        note: "",
      }),
    ).toMatchObject({ error: "refused" });

    expect(
      await staff().decide(...as(verifier(jp)))({
        uid: "siti",
        version: 3,
        approve: true,
        note: "",
      }),
    ).toEqual({ ok: true, data: { version: 4 } });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      fullName: "Siti R.",
      ppiCountry: "KR",
      chapterId: "ch-kr",
    });
    expect(fake.docs.get("users/siti")).toMatchObject({ chapterId: "ch-kr" });
    expect(audit().at(-1)).toMatchObject({
      actor: { type: "staff", id: "verifier" },
      before: { fullName: "Siti Rahma" },
      after: { fullName: "Siti R." },
    });
    expect(
      await staff().decide(...as(verifier({ type: "global" })))({
        uid: "siti",
        version: 4,
        approve: false,
        note: "",
      }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("no change")] });

    // A rejected request keeps the verified values.
    await own().save(member("siti"), {
      version: 4,
      profile: input({ fullName: "Wrong", ppiCountry: "KR" }),
    });
    expect(
      await staff().decide(...as(verifier(kr)))({
        uid: "siti",
        version: 5,
        approve: false,
        note: "Name does not match the passport.",
      }),
    ).toEqual({ ok: true, data: { version: 6 } });
    expect(await profiles.findByUserId("siti")).toMatchObject({ fullName: "Siti R." });
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

    // Marked by a verifier: the member cannot cancel it; the verifier can, with a reason.
    expect(
      await staff().setGraduation(...as(verifier(jp)))({
        uid: "siti",
        version: 3,
        graduatedOn: "2026-09-30",
        reason: "",
      }),
    ).toEqual({ ok: true, data: { version: 4 } });
    expect(await own().setGraduation(member("siti"), { version: 4, graduatedOn: null })).toEqual({
      ok: false,
      message: "This graduation was marked by an officer; ask the secretariat to cancel it.",
    });
    expect(
      await staff().setGraduation(...as(verifier(jp)))({
        uid: "siti",
        version: 4,
        graduatedOn: null,
        reason: "",
      }),
    ).toMatchObject({ error: "refused", issues: ["Give the reason for cancelling."] });
    expect(
      await staff().setGraduation(...as(verifier(jp)))({
        uid: "siti",
        version: 4,
        graduatedOn: "2010-01-01",
        reason: "",
      }),
    ).toMatchObject({ error: "refused" });
    expect(
      await staff().setGraduation(...as(verifier(jp)))({
        uid: "siti",
        version: 4,
        graduatedOn: null,
        reason: "Still enrolled (letter from the campus).",
      }),
    ).toMatchObject({ ok: true });
    expect(audit().at(-1)).toMatchObject({
      after: { graduatedOn: null, reason: "Still enrolled (letter from the campus)." },
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
    const appointments = createFirestoreAppointmentStore(db);
    expect((await appointments.graduatedOfficers("2026-10-19")).map((a) => a.name)).toEqual([
      "siti",
    ]);
    expect(await appointments.get("a1")).toMatchObject({ status: "active" });
    fake.docs.delete("settings/activePeriod");
    expect(await appointments.graduatedOfficers("2026-10-19")).toEqual([]);
  });
});
