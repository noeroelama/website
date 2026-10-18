import { beforeEach, describe, expect, it } from "vitest";
import { createFirestoreMemberProfileStore } from "@website/db/firestore";
import {
  INDONESIA_PROVINCES,
  isProfileComplete,
  PRIVACY_POLICY_VERSION,
} from "@website/domain/members";
import { createOwnProfile } from "../../apps/web/src/server/profile";
import { fakeFirestore } from "../support/fake-firestore";

type Db = Parameters<typeof createFirestoreMemberProfileStore>[0];
const now = new Date("2026-10-18T05:00:00Z");
const input = {
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
  addressIndonesia: { line1: "Jl. Merdeka No. 10", city: "Kota Bandung", province: "Jawa Barat" },
  whatsappNumber: "+6281234567890",
  emergencyContact: { phone: "+6281111111111" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, accepted: true },
};
const siti = { uid: "siti", email: "siti@example.org", emailVerified: true };

let fake: ReturnType<typeof fakeFirestore>;
let store: ReturnType<typeof createFirestoreMemberProfileStore>;
const own = () => createOwnProfile({ profiles: store, now: () => now });

beforeEach(() => {
  fake = fakeFirestore();
  store = createFirestoreMemberProfileStore(fake.db as unknown as Db);
  fake.docs.set("users/siti", { uid: "siti", status: "active", version: 3 });
  fake.docs.set("chapters/ch-jp", { countryCode: "JP", active: true, name: "PPI Jepang" });
  fake.docs.set("chapters/ch-kr", { countryCode: "KR", active: true, name: "PPI Korea" });
});

describe("member profile on the website (B3)", () => {
  it("a member saves their own profile once signed in with a verified e-mail", async () => {
    expect(await own().save(null, { version: null, profile: input })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await own().save({ ...siti, emailVerified: false }, { version: null, profile: input }),
    ).toEqual({ ok: false, error: "verify" });
    expect(await own().load(null)).toBeNull();

    expect(await own().save(siti, { version: null, profile: input })).toEqual({
      ok: true,
      version: 1,
    });
    const saved = await own().load(siti);
    expect(saved).toMatchObject({
      userId: "siti",
      email: "siti@example.org", // from the verified session, never typed
      fullName: "Siti Rahma",
      consent: { privacyPolicyVersion: PRIVACY_POLICY_VERSION, consentedAt: now },
      version: 1,
    });
    expect(isProfileComplete(saved)).toBe(true);
    // The account record learns the member's chapter (chapter-scoped staff lists, A2).
    expect(fake.docs.get("users/siti")).toMatchObject({ chapterId: "ch-jp", version: 3 });

    // Edits keep the first consent date unless the policy changed; a move updates the chapter.
    const later = createOwnProfile({ profiles: store, now: () => new Date("2026-11-01") });
    expect(await later.save(siti, { version: 1, profile: { ...input, ppiCountry: "KR" } })).toEqual(
      { ok: true, version: 2 },
    );
    expect(await store.findByUserId("siti")).toMatchObject({
      ppiCountry: "KR",
      consent: { consentedAt: now },
      createdAt: now,
    });
    expect(fake.docs.get("users/siti")).toMatchObject({ chapterId: "ch-kr" });
    // A country without an active chapter clears it.
    expect(await later.save(siti, { version: 2, profile: { ...input, ppiCountry: "AU" } })).toEqual(
      { ok: true, version: 3 },
    );
    expect(fake.docs.get("users/siti")).toMatchObject({ chapterId: null });
  });

  it("refuses bad fields, a stale version, an old policy and anything but the own profile", async () => {
    expect(
      await own().save(siti, { version: null, profile: { ...input, whatsappNumber: "0812" } }),
    ).toMatchObject({
      ok: false,
      error: "invalid",
      fields: { whatsappNumber: "Use international format, e.g. +6281234567890" },
    });
    expect(
      await own().save(siti, { version: null, profile: { ...input, userId: "someone-else" } }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await own().save(siti, {
        version: null,
        profile: { ...input, consent: { privacyPolicyVersion: "2020-01-01", accepted: true } },
      }),
    ).toEqual({ ok: false, error: "consent" });
    await own().save(siti, { version: null, profile: input });
    expect(await own().save(siti, { version: null, profile: input })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(await own().save(siti, { version: 7, profile: input })).toEqual({
      ok: false,
      error: "conflict",
    });
    expect(await own().save(siti, { profile: input })).toMatchObject({ error: "invalid" });
    // A consent to an older policy version makes the profile incomplete again.
    const stored = await store.findByUserId("siti");
    expect(
      isProfileComplete(
        stored && { ...stored, consent: { ...stored.consent, privacyPolicyVersion: "old" } },
      ),
    ).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
  });

  it("offers the 38 provinces and their regencies as pick-lists", () => {
    expect(INDONESIA_PROVINCES).toHaveLength(38);
    expect(INDONESIA_PROVINCES.reduce((n, p) => n + p.regencies.length, 0)).toBe(514);
    expect(INDONESIA_PROVINCES.find((p) => p.name === "Papua Pegunungan")?.regencies).toContain(
      "Kabupaten Jayawijaya",
    );
    expect(INDONESIA_PROVINCES.find((p) => p.name === "Jawa Barat")?.regencies).toContain(
      "Kota Bandung",
    );
  });
});
