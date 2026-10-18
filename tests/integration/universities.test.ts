import { beforeEach, describe, expect, it } from "vitest";
import {
  createFirestoreMemberProfileStore,
  createFirestoreUniversityStore,
} from "@website/db/firestore";
import { normalizeUniversityName, PRIVACY_POLICY_VERSION } from "@website/domain/members";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createUniversityActions } from "../../apps/admin/src/server/universities";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { createUniversityPicker } from "../../apps/web/src/server/universities";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreUniversityStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const member = (uid: string) => ({ uid, email: `${uid}@example.org`, emailVerified: true });
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "reviewer",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const context = () =>
  Promise.resolve({ actorEmail: "staff@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;
const campus = (name: string, countryCode: string, extra: Record<string, unknown> = {}) => ({
  name,
  normalizedName: normalizeUniversityName(name),
  countryCode,
  city: null,
  website: null,
  aliases: [],
  aliasesNormalized: [],
  rorId: null,
  source: "ror",
  status: "approved",
  submittedBy: null,
  mergedInto: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  version: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  deletedAt: null,
  ...extra,
});
const profileInput = (universityId: string | null, ppiCountry = "JP") => ({
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-05-20",
  ppiCountry,
  university: "typed by the member",
  universityId,
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
});

let fake: ReturnType<typeof fakeFirestore>;
let universities: ReturnType<typeof createFirestoreUniversityStore>;
let profiles: ReturnType<typeof createFirestoreMemberProfileStore>;
const picker = () => createUniversityPicker({ universities, now: () => now });
const choices = async (owner: ReturnType<typeof member> | null, countryCode: string) => [
  ...(await picker().approved(countryCode)),
  ...(await picker().ownPending(owner, countryCode)),
];
const own = () => createOwnProfile({ profiles, universities, now: () => now });
const review = () => createUniversityActions({ universities, now: () => now });

beforeEach(() => {
  fake = fakeFirestore();
  const db = fake.db as unknown as Db;
  universities = createFirestoreUniversityStore(db);
  profiles = createFirestoreMemberProfileStore(db);
  fake.docs.set(
    "universities/057zh3y96_JP",
    campus("The University of Tokyo", "JP", {
      aliases: ["UTokyo"],
      aliasesNormalized: ["utokyo"],
      rorId: "https://ror.org/057zh3y96",
    }),
  );
  fake.docs.set("universities/02kpeqv85_JP", campus("Kyoto University", "JP"));
  fake.docs.set("universities/01tgyzw49_SG", campus("National University of Singapore", "SG"));
  for (const uid of ["siti", "budi"]) fake.docs.set(`users/${uid}`, { uid, version: 1 });
});

describe("universities master and campus proposals (A3)", () => {
  it("the picker lists the approved campuses of one country, plus the member's own proposals", async () => {
    expect((await choices(member("siti"), "JP")).map((u) => u.name)).toEqual([
      "Kyoto University",
      "The University of Tokyo",
    ]);
    expect((await choices(null, "SG")).map((u) => u.name)).toEqual([
      "National University of Singapore",
    ]);
    const proposed = await picker().propose(member("siti"), {
      name: "sekolah tinggi contoh nusantara",
      countryCode: "JP",
      city: "",
    });
    expect(proposed).toMatchObject({ ok: true, name: "Sekolah Tinggi Contoh Nusantara" });
    expect(await choices(member("siti"), "JP")).toContainEqual({
      id: proposed.ok ? proposed.id : "",
      name: "Sekolah Tinggi Contoh Nusantara",
      aliases: [],
      pending: true,
    });
    expect((await choices(member("budi"), "JP")).map((u) => u.name)).not.toContain(
      "Sekolah Tinggi Contoh Nusantara",
    );
  });

  it("refuses obvious duplicates (name or alias, same country) and asks to sign in first", async () => {
    expect(await picker().propose(null, { name: "X Uni", countryCode: "JP", city: "" })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await picker().propose(
        { ...member("siti"), emailVerified: false },
        { name: "X Uni", countryCode: "JP", city: "" },
      ),
    ).toEqual({ ok: false, error: "verify" });
    expect(await picker().propose(member("siti"), { name: "x", countryCode: "J" })).toMatchObject({
      ok: false,
      error: "invalid",
    });
    for (const name of ["the univ of tokyo", "UTokyo"]) {
      expect(await picker().propose(member("siti"), { name, countryCode: "JP", city: "" })).toEqual(
        {
          ok: false,
          error: "duplicate",
          message:
            'This campus is already listed as "The University of Tokyo". Choose it from the list.',
        },
      );
    }
    // The same campus name in another country is a different campus.
    expect(
      await picker().propose(member("siti"), {
        name: "University of Tokyo",
        countryCode: "ID",
        city: "",
      }),
    ).toMatchObject({ ok: true });
    await picker().propose(member("siti"), {
      name: "Tokyo Univ",
      countryCode: "JP",
      city: "Tokyo",
    });
    expect(
      await picker().propose(member("budi"), {
        name: "tokyo university",
        countryCode: "JP",
        city: "",
      }),
    ).toEqual({
      ok: false,
      error: "duplicate",
      message: "This campus was already proposed and is waiting for review.",
    });
  });

  it("the profile keeps the chosen campus' own name; others' proposals and other countries are refused", async () => {
    const mine = await picker().propose(member("siti"), {
      name: "Tokyo Univ",
      countryCode: "JP",
      city: "",
    });
    const mineId = mine.ok ? mine.id : "";
    expect(
      await own().save(member("siti"), { version: null, profile: profileInput("057zh3y96_JP") }),
    ).toMatchObject({ ok: true });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      universityId: "057zh3y96_JP",
      university: "The University of Tokyo",
    });
    expect(
      await own().save(member("siti"), { version: 1, profile: profileInput(mineId) }),
    ).toMatchObject({
      ok: true,
    });
    for (const universityId of [mineId, "01tgyzw49_SG", "nope"]) {
      expect(
        await own().save(member("budi"), { version: null, profile: profileInput(universityId) }),
      ).toEqual({
        ok: false,
        error: "invalid",
        fields: { universityId: "Choose your campus from the list of your PPI country." },
      });
    }
    // Without a pick, the typed name is kept (e.g. before the ROR import).
    expect(
      await own().save(member("budi"), { version: null, profile: profileInput(null) }),
    ).toMatchObject({
      ok: true,
    });
    expect(await profiles.findByUserId("budi")).toMatchObject({
      universityId: null,
      university: "typed by the member",
    });
  });

  it("staff approve, merge (profiles follow, history kept) or reject (profiles must choose again)", async () => {
    const reviewer = staff(["universities.edit"]);
    const dup = await picker().propose(member("siti"), {
      name: "Tokyo Univ",
      countryCode: "JP",
      city: "",
    });
    const dupId = dup.ok ? dup.id : "";
    await own().save(member("siti"), { version: null, profile: profileInput(dupId) });

    expect(
      await review().review(...as(staff(["universities.read"])))({
        id: dupId,
        version: 1,
        decision: { type: "approve" },
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    const pending = await universities.listPending();
    expect(pending.map((u) => u.name)).toEqual(["Tokyo Univ"]);

    // Merge target must be an approved campus of the same country.
    expect(
      await review().review(...as(reviewer))({
        id: dupId,
        version: 1,
        decision: { type: "merge", into: "01tgyzw49_SG" },
      }),
    ).toMatchObject({ error: "refused" });
    expect(
      await review().review(...as(reviewer))({
        id: dupId,
        version: 1,
        decision: { type: "merge", into: "057zh3y96_JP" },
      }),
    ).toEqual({ ok: true, data: { version: 2 } });
    expect(await universities.get(dupId)).toMatchObject({
      status: "rejected",
      mergedInto: "057zh3y96_JP",
      reviewedBy: "reviewer",
      reviewedAt: now,
    });
    expect(await profiles.findByUserId("siti")).toMatchObject({
      universityId: "057zh3y96_JP",
      university: "The University of Tokyo",
    });
    const audit = [...fake.docs.entries()]
      .filter(([p]) => p.startsWith("auditLogs/"))
      .map(([, d]) => d);
    expect(audit.at(-1)).toMatchObject({
      module: "universities",
      action: "UPDATE",
      resourceType: "university",
      title: "Tokyo Univ",
      revertible: false,
    });
    // A decided proposal cannot be decided again.
    expect(
      await review().review(...as(reviewer))({
        id: dupId,
        version: 2,
        decision: { type: "approve" },
      }),
    ).toMatchObject({ error: "refused" });

    // Reject: the member's profile no longer points at it.
    const odd = await picker().propose(member("budi"), {
      name: "Odd Academy",
      countryCode: "JP",
      city: "",
    });
    const oddId = odd.ok ? odd.id : "";
    await own().save(member("budi"), { version: null, profile: profileInput(oddId) });
    expect(
      await review().review(...as(reviewer))({
        id: oddId,
        version: 1,
        decision: { type: "reject", note: "Not a higher-education institution." },
      }),
    ).toMatchObject({ ok: true });
    expect(await profiles.findByUserId("budi")).toMatchObject({ universityId: null });
    expect(await universities.get(oddId)).toMatchObject({
      status: "rejected",
      reviewNote: "Not a higher-education institution.",
    });

    // Approve: listed for everyone in that country.
    const fine = await picker().propose(member("budi"), {
      name: "Fine Institute",
      countryCode: "JP",
      city: "",
    });
    await review().review(...as(reviewer))({
      id: fine.ok ? fine.id : "",
      version: 1,
      decision: { type: "approve" },
    });
    expect((await choices(null, "JP")).map((u) => u.name)).toContain("Fine Institute");
    expect(
      await review().review(...as(reviewer))({
        id: "nope",
        version: 1,
        decision: { type: "approve" },
      }),
    ).toMatchObject({ error: "refused" });
  });
});
