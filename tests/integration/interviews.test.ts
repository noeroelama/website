import { beforeEach, describe, expect, it } from "vitest";
import {
  createFirestoreApplicationStore,
  createFirestoreInterviewStore,
  createFirestoreRecruitmentStore,
  createFirestoreRecruitmentWebStore,
} from "@website/db/firestore";
import { utcToWallTime } from "@website/domain/shared";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createApplicationActions } from "../../apps/admin/src/server/applications";
import { createInterviewActions } from "../../apps/admin/src/server/interviews";
import { createRecruitmentActions } from "../../apps/admin/src/server/recruitment";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { fakeFirestore } from "../support/fake-firestore";
import { noRatification } from "../support/recruitment";

type Db = Parameters<typeof createFirestoreInterviewStore>[0];
let clock = new Date("2026-11-10T05:00:00Z");
const staff = (permissions: string[]): Principal => ({
  kind: "user",
  userId: "committee-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(permissions)),
    },
  ],
});
const reviewer = staff(["recruitment.review"]);
const context = () =>
  Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeFirestore>;
const db = () => fake.db as unknown as Db;
const interviews = () =>
  createInterviewActions({ interviews: createFirestoreInterviewStore(db()), now: () => clock });
const web = () => createFirestoreRecruitmentWebStore(db());
const applying = () =>
  createApplying({
    store: web(),
    profileComplete: () => Promise.resolve(true),
    storage: { save: () => Promise.resolve({ url: null }) },
    now: () => clock,
    uuid: () => "abcdef12-0000-4000-8000-000000000000",
  });
let recruitmentId = "";
const plan = {
  date: "2026-11-15",
  timeZone: "Asia/Tokyo",
  startTime: "09:00",
  endTime: "10:00",
  durationMinutes: 30,
  gapMinutes: 0,
  breaks: [],
  capacity: 1,
  location: "https://meet.example/oprec",
};
const slots = () => createFirestoreInterviewStore(db()).listForRecruitment(recruitmentId);
const booked = (id: string) => fake.docs.get(`interviewSlots/${id}`)?.["booked"];

/** An application in "interview" for `uid`. */
const inInterview = async (uid: string) => {
  await applying().saveDraft({ uid }, { recruitmentId, choices: ["finance"], answers: {} });
  await applying().submit({ uid }, { recruitmentId });
  const version = fake.docs.get(`applications/${recruitmentId}_${uid}`)?.["version"] as number;
  await createApplicationActions({
    applications: createFirestoreApplicationStore(db()),
    signedUrl: () => Promise.resolve(""),
    ...noRatification,
    now: () => clock,
  }).pass(...as(reviewer))({ id: `${recruitmentId}_${uid}`, version });
};

beforeEach(async () => {
  clock = new Date("2026-11-10T05:00:00Z");
  fake = fakeFirestore();
  fake.docs.set("periods/p2026", { name: "2026/2027", status: "active", deletedAt: null });
  fake.docs.set("orgUnits/finance", { periodId: "p2026", name: "Keuangan", deletedAt: null });
  fake.docs.set("forms/form1", { usage: "recruitment", currentVersion: 1, deletedAt: null });
  fake.docs.set("formVersions/form1_1", {
    formId: "form1",
    number: 1,
    answered: false,
    questions: [],
  });
  const committee = staff(["recruitment.edit"]);
  const actions = createRecruitmentActions({
    recruitments: createFirestoreRecruitmentStore(db()),
    now: () => clock,
  });
  const created = await actions.save(...as(committee))({
    periodId: "p2026",
    title: "Oprec 2026",
    description: "",
    opensAt: "2026-11-01T00:00:00.000Z",
    closesAt: "2026-11-20T00:00:00.000Z",
    maxChoices: 1,
    offerDays: 3,
    formId: "form1",
    units: [{ orgUnitId: "finance", quota: 3, portfolioRequired: false }],
    version: null,
  });
  recruitmentId = created.ok ? created.data.id : "";
  await actions.setPublished(...as(committee))({ id: recruitmentId, version: 1, published: true });
});

describe("interview times (recruitment.review)", () => {
  it("creates UTC slots from a day plan; shown in the applicant's own zone", async () => {
    expect(
      await interviews().createPlan(...as(staff(["recruitment.offer"])))({ recruitmentId, plan }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toEqual({
      ok: true,
      data: { created: 2 },
    });
    const list = await slots();
    expect(list.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-11-15T00:00:00.000Z",
      "2026-11-15T00:30:00.000Z",
    ]);
    // 09:00 in Tokyo is 07:00 for an applicant in Jakarta.
    expect(utcToWallTime(list[0]!.startsAt, "Asia/Jakarta")).toBe("2026-11-15T07:00");
    expect(list[0]).toMatchObject({ capacity: 1, booked: 0, location: plan.location });
    const entry = [...fake.docs.values()].find((d) => d["resourceType"] === "interviewSlot");
    expect(entry).toMatchObject({ action: "CREATE", revertible: false });
  });

  it("skips past times and refuses a plan with none left, or an unknown recruitment", async () => {
    clock = new Date("2026-11-15T00:10:00Z");
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toEqual({
      ok: true,
      data: { created: 1 },
    });
    clock = new Date("2026-11-16T00:00:00Z");
    expect(await interviews().createPlan(...as(reviewer))({ recruitmentId, plan })).toMatchObject({
      error: "refused",
      issues: ["No interview time is in the future."],
    });
    expect(
      await interviews().createPlan(...as(reviewer))({ recruitmentId: "missing", plan }),
    ).toMatchObject({ error: "refused" });
  });
});

describe("booking an interview (applicant in `interview`)", () => {
  beforeEach(async () => {
    await interviews().createPlan(...as(reviewer))({ recruitmentId, plan });
  });

  it("only applicants in the interview step book", async () => {
    const [first] = await slots();
    await applying().saveDraft(
      { uid: "ari" },
      { recruitmentId, choices: ["finance"], answers: {} },
    );
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: first!.id }),
    ).toEqual({ ok: false, error: "locked" });
    expect(await applying().bookInterview(null, { recruitmentId, slotId: first!.id })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await applying().bookInterview({ uid: "nobody" }, { recruitmentId, slotId: first!.id }),
    ).toEqual({ ok: false, error: "locked" });
    expect(await interviews().removeSlot(...as(reviewer))({ id: "nope" })).toMatchObject({
      error: "refused",
      issues: ["This interview time does not exist."],
    });
    expect(
      await applying().bookInterview(
        { uid: "ari" },
        { recruitmentId: "missing", slotId: first!.id },
      ),
    ).toEqual({ ok: false, error: "closed" });
  });

  it("never exceeds a slot's capacity under concurrent bookings", async () => {
    const [first] = await slots();
    for (const uid of ["ari", "budi", "cici"]) await inInterview(uid);
    const results = await Promise.all(
      ["ari", "budi", "cici"].map((uid) =>
        applying().bookInterview({ uid }, { recruitmentId, slotId: first!.id }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "refused", message: "This interview time is full." },
      { ok: false, error: "refused", message: "This interview time is full." },
    ]);
    expect(booked(first!.id)).toBe(1);
  });

  it("keeps ONE active booking: re-booking frees the old time in the same transaction", async () => {
    const [first, second] = await slots();
    await inInterview("ari");
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: first!.id }),
    ).toMatchObject({ ok: true });
    // Booking the same time again changes nothing.
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: first!.id }),
    ).toMatchObject({ ok: true });
    expect(booked(first!.id)).toBe(1);
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: second!.id }),
    ).toMatchObject({ ok: true });
    expect([booked(first!.id), booked(second!.id)]).toEqual([0, 1]);
    expect((await web().ownApplication(recruitmentId, "ari"))?.interview).toEqual({
      slotId: second!.id,
      startsAt: second!.startsAt,
    });
    // A slot with a booking cannot be deleted; a free one can.
    expect(await interviews().removeSlot(...as(reviewer))({ id: second!.id })).toMatchObject({
      error: "refused",
      issues: ["Someone booked this time; it stays."],
    });
    expect(await interviews().removeSlot(...as(reviewer))({ id: first!.id })).toMatchObject({
      ok: true,
    });
    expect((await slots()).map((s) => s.id)).toEqual([second!.id]);
    expect(await interviews().removeSlot(...as(reviewer))({ id: first!.id })).toMatchObject({
      error: "refused",
    });
    // The deleted time cannot be booked.
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: first!.id }),
    ).toEqual({
      ok: false,
      error: "refused",
      message: "This interview time is no longer available.",
    });
  });

  it("refuses past times and times of another recruitment; a lost old slot is skipped", async () => {
    const [first, second] = await slots();
    await inInterview("ari");
    fake.docs.set("interviewSlots/foreign", {
      ...fake.docs.get(`interviewSlots/${first!.id}`),
      recruitmentId: "other",
    });
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: "foreign" }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: "nope" }),
    ).toMatchObject({ ok: false, error: "refused" });
    await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: first!.id });
    fake.docs.delete(`interviewSlots/${first!.id}`);
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: second!.id }),
    ).toMatchObject({ ok: true });
    expect((await web().slots(recruitmentId)).map((s) => s.id)).toEqual([second!.id]);
    clock = new Date("2026-11-15T00:30:00Z");
    expect(
      await applying().bookInterview({ uid: "ari" }, { recruitmentId, slotId: "foreign" }),
    ).toMatchObject({ ok: false, error: "refused" });
  });
});
