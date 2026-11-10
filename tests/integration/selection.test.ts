import { beforeEach, describe, expect, it } from "vitest";
import {
  createSqlApplicationStore,
  createSqlRecruitmentStore,
  createSqlRecruitmentWebStore,
} from "@website/db/sql";
import { nextAction } from "@website/domain/recruitment";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createApplicationActions } from "../../apps/admin/src/server/applications";
import { createRecruitmentActions } from "../../apps/admin/src/server/recruitment";
import { createApplying } from "../../apps/web/src/server/recruitment";
import { fakeDb } from "../support/fake-db";
import { noRatification } from "../support/recruitment";

type Db = Parameters<typeof createSqlApplicationStore>[0];
let clock = new Date("2026-11-10T05:00:00Z");
const staff = (permissions: string[], userId = "committee-1"): Principal => ({
  kind: "user",
  userId,
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
const offerer = staff(["recruitment.offer"]);
const context = () =>
  Promise.resolve({ actorEmail: "oprec@example.org", requestId: "req-123456", authTime: null });
const as = (principal: Principal) => [() => Promise.resolve(principal), context] as const;

let fake: ReturnType<typeof fakeDb>;
const db = () => fake.db as unknown as Db;
const decisions = () =>
  createApplicationActions({
    applications: createSqlApplicationStore(db()),
    signedUrl: (path) => Promise.resolve(`https://signed.test/${path}`),
    ...noRatification,
    now: () => clock,
  });
const web = () => createSqlRecruitmentWebStore(db());
const applying = () =>
  createApplying({
    store: web(),
    profileComplete: () => Promise.resolve(true),
    storage: { save: () => Promise.resolve({ url: null }) },
    now: () => clock,
    uuid: () => "abcdef12-0000-4000-8000-000000000000",
  });
let recruitmentId = "";
const appId = (uid: string) => `${recruitmentId}_${uid}`;
const version = (uid: string) => fake.docs.get(`applications/${appId(uid)}`)?.["version"] as number;
const status = (uid: string) => fake.docs.get(`applications/${appId(uid)}`)?.["status"];
const seats = (unit: string) => fake.docs.get(`seatCounters/${recruitmentId}_${unit}`)?.["filled"];

const submitted = async (uid: string, units = ["finance"]) => {
  await applying().saveDraft({ uid }, { recruitmentId, choices: units, answers: { q_why: "Hi" } });
  const result = await applying().submit({ uid }, { recruitmentId });
  if (!result.ok) throw new Error(JSON.stringify(result));
};
const passAndOffer = async (uid: string, orgUnitId = "finance") => {
  await decisions().pass(...as(reviewer))({ id: appId(uid), version: version(uid) });
  const offered = await decisions().offer(...as(offerer))({
    id: appId(uid),
    version: version(uid),
    orgUnitId,
  });
  if (!offered.ok) throw new Error(JSON.stringify(offered));
};

beforeEach(async () => {
  clock = new Date("2026-11-10T05:00:00Z");
  fake = fakeDb();
  fake.docs.set("periods/p2026", { name: "2026/2027", status: "active", deletedAt: null });
  fake.docs.set("orgUnits/media", { periodId: "p2026", name: "Direktorat Media", deletedAt: null });
  fake.docs.set("orgUnits/finance", { periodId: "p2026", name: "Keuangan", deletedAt: null });
  fake.docs.set("forms/form1", { usage: "recruitment", currentVersion: 1, deletedAt: null });
  fake.docs.set("formVersions/form1_1", {
    formId: "form1",
    number: 1,
    answered: false,
    questions: [
      {
        id: "q_why",
        type: "short_text",
        label: "Why?",
        description: "",
        required: true,
        options: [],
        allowOther: false,
        maxSelections: null,
        min: null,
        max: null,
      },
    ],
  });
  const actions = createRecruitmentActions({
    recruitments: createSqlRecruitmentStore(db()),
    now: () => clock,
  });
  const committee = staff(["recruitment.edit"]);
  const created = await actions.save(...as(committee))({
    periodId: "p2026",
    title: "Oprec 2026",
    description: "",
    opensAt: "2026-11-01T00:00:00.000Z",
    closesAt: "2026-11-20T00:00:00.000Z",
    maxChoices: 2,
    offerDays: 3,
    formId: "form1",
    units: [
      { orgUnitId: "media", quota: 2, portfolioRequired: false },
      { orgUnitId: "finance", quota: 1, portfolioRequired: false },
    ],
    version: null,
  });
  recruitmentId = created.ok ? created.data.id : "";
  await actions.setPublished(...as(committee))({ id: recruitmentId, version: 1, published: true });
});

describe("review (recruitment.review): revision rounds, fail, pass", () => {
  it("keeps every revision round; the applicant resubmits", async () => {
    await submitted("ari");
    expect(
      await decisions().requestRevision(...as(offerer))({
        id: appId("ari"),
        version: version("ari"),
        request: "Add your experience.",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await decisions().requestRevision(...as(reviewer))({
        id: appId("ari"),
        version: version("ari"),
        request: "Add your experience.",
      }),
    ).toMatchObject({ ok: true, data: { status: "revision" } });
    expect(
      nextAction(
        {
          published: true,
          deletedAt: null,
          opensAt: new Date("2026-11-01"),
          closesAt: new Date("2026-11-20"),
        },
        { status: "revision", offer: null },
        clock,
      ),
    ).toBe("revise");
    const first = await web().ownRevisions(recruitmentId, "ari");
    expect(first).toMatchObject([
      {
        round: 1,
        request: "Add your experience.",
        requestedBy: "committee-1",
        resubmittedAt: null,
      },
    ]);
    clock = new Date("2026-11-11T05:00:00Z");
    expect(await applying().submit({ uid: "ari" }, { recruitmentId })).toMatchObject({
      ok: true,
      status: "submitted",
    });
    await decisions().requestRevision(...as(reviewer))({
      id: appId("ari"),
      version: version("ari"),
      request: "Shorter, please.",
    });
    const rounds = await createSqlApplicationStore(db()).revisions(appId("ari"));
    expect(rounds.map((r) => [r.round, r.request, r.resubmittedAt?.toISOString() ?? null])).toEqual(
      [
        [1, "Add your experience.", "2026-11-11T05:00:00.000Z"],
        [2, "Shorter, please.", null],
      ],
    );
    expect(fake.docs.get(`applications/${appId("ari")}`)).toMatchObject({ revisionRound: 2 });
    expect(
      (await createSqlApplicationStore(db()).revisionsForRecruitment(recruitmentId)).map((r) => [
        r.applicationId,
        r.round,
      ]),
    ).toEqual([
      [appId("ari"), 1],
      [appId("ari"), 2],
    ]);
  });

  it("no revision after the window closes; a stuck revision can still be closed", async () => {
    await submitted("ari");
    await submitted("budi");
    await decisions().requestRevision(...as(reviewer))({
      id: appId("budi"),
      version: version("budi"),
      request: "Add your experience.",
    });
    clock = new Date("2026-11-25T00:00:00Z");
    expect(
      await decisions().requestRevision(...as(reviewer))({
        id: appId("ari"),
        version: version("ari"),
        request: "Too late.",
      }),
    ).toMatchObject({ ok: false, error: "refused" });
    expect(status("ari")).toBe("submitted");
    expect(
      await decisions().fail(...as(reviewer))({ id: appId("budi"), version: version("budi") }),
    ).toMatchObject({ ok: true, data: { status: "admin_rejected" } });
  });

  it("fails or passes a submitted application; ends cannot move", async () => {
    await submitted("ari");
    await submitted("budi");
    expect(
      await decisions().fail(...as(reviewer))({ id: appId("ari"), version: version("ari") }),
    ).toMatchObject({ ok: true, data: { status: "admin_rejected" } });
    expect(
      await decisions().pass(...as(reviewer))({ id: appId("ari"), version: version("ari") }),
    ).toMatchObject({ error: "refused", issues: [expect.stringContaining("cannot move")] });
    expect(
      await decisions().pass(...as(reviewer))({ id: appId("budi"), version: 99 }),
    ).toMatchObject({ error: "conflict" });
    expect(
      await decisions().pass(...as(reviewer))({ id: "missing_app", version: 1 }),
    ).toMatchObject({ error: "refused" });
    expect(
      await decisions().pass(...as(reviewer))({ id: appId("budi"), version: version("budi") }),
    ).toMatchObject({ ok: true, data: { status: "interview" } });
    const entries = [...fake.docs.entries()]
      .filter(([p]) => p.startsWith("auditLogs/"))
      .map(([, d]) => d)
      .filter(
        (e) =>
          e["resourceType"] === "application" && (e["actor"] as { type: string }).type === "staff",
      );
    expect(entries.length).toBe(2);
    expect(JSON.stringify(entries)).not.toContain("Hi");
  });
});

describe("offers and seats (recruitment.offer; accept on the website)", () => {
  it("offers a unit of the recruitment with an expiry; only recruitment.offer may", async () => {
    await submitted("ari");
    await decisions().pass(...as(reviewer))({ id: appId("ari"), version: version("ari") });
    expect(
      await decisions().offer(...as(reviewer))({
        id: appId("ari"),
        version: version("ari"),
        orgUnitId: "finance",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await decisions().offer(...as(offerer))({
        id: appId("ari"),
        version: version("ari"),
        orgUnitId: "sports",
      }),
    ).toMatchObject({ error: "refused", issues: ["Offer one of the units of this recruitment."] });
    expect(
      await decisions().offer(...as(offerer))({
        id: appId("ari"),
        version: version("ari"),
        orgUnitId: "finance",
      }),
    ).toMatchObject({ ok: true, data: { status: "offered" } });
    expect((await web().ownApplication(recruitmentId, "ari"))?.offer).toEqual({
      orgUnitId: "finance",
      expiresAt: new Date("2026-11-13T05:00:00Z"),
    });
    expect(seats("finance")).toBe(0);
    expect(
      await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true }),
    ).toMatchObject({ ok: true, status: "accepted" });
    expect(seats("finance")).toBe(1);
  });

  it("never exceeds a quota with concurrent accepts (one counter, one transaction)", async () => {
    for (const uid of ["ari", "budi", "cici"]) {
      await submitted(uid);
      await passAndOffer(uid);
    }
    const results = await Promise.all(
      ["ari", "budi", "cici"].map((uid) =>
        applying().respondOffer({ uid }, { recruitmentId, accept: true }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "refused", message: "All seats of this unit are taken." },
      { ok: false, error: "refused", message: "All seats of this unit are taken." },
    ]);
    expect(seats("finance")).toBe(1);
    await submitted("dodi");
    await decisions().pass(...as(reviewer))({ id: appId("dodi"), version: version("dodi") });
    expect(
      await decisions().offer(...as(offerer))({
        id: appId("dodi"),
        version: version("dodi"),
        orgUnitId: "finance",
      }),
    ).toMatchObject({ error: "refused", issues: ["All seats of this unit are taken."] });
  });

  it("an expired offer cannot be answered and ends at read time; it can be offered again", async () => {
    await submitted("ari");
    await passAndOffer("ari");
    clock = new Date("2026-11-13T05:00:00Z");
    expect(await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true })).toEqual({
      ok: false,
      error: "refused",
      message: "This offer has expired.",
    });
    expect(seats("finance")).toBe(0);
    const application = await web().ownApplication(recruitmentId, "ari");
    expect(
      nextAction(
        {
          published: true,
          deletedAt: null,
          opensAt: new Date("2026-11-01"),
          closesAt: new Date("2026-11-20"),
        },
        application,
        clock,
      ),
    ).toBe("ended");
    expect(
      await decisions().offer(...as(offerer))({
        id: appId("ari"),
        version: version("ari"),
        orgUnitId: "media",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: false }),
    ).toMatchObject({ ok: true, status: "declined" });
    expect(seats("media")).toBe(0);
    expect(await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true })).toEqual({
      ok: false,
      error: "locked",
    });
  });

  it("a unit without a seat counter has no free seat", async () => {
    await submitted("ari");
    await passAndOffer("ari", "media");
    fake.docs.delete(`seatCounters/${recruitmentId}_media`);
    expect(
      await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true }),
    ).toMatchObject({ ok: false, message: "All seats of this unit are taken." });
    expect(
      await decisions().offer(...as(offerer))({
        id: appId("ari"),
        version: version("ari"),
        orgUnitId: "media",
      }),
    ).toMatchObject({ error: "refused", issues: ["All seats of this unit are taken."] });
  });

  it("rejecting an accepted applicant gives the seat back", async () => {
    await submitted("ari");
    await passAndOffer("ari");
    await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true });
    expect(seats("finance")).toBe(1);
    expect(
      await decisions().reject(...as(reviewer))({ id: appId("ari"), version: version("ari") }),
    ).toMatchObject({ ok: true, data: { status: "rejected" } });
    expect(seats("finance")).toBe(0);
    expect(status("ari")).toBe("rejected");
  });

  it("an approved placement keeps its seat", async () => {
    const confirmer = staff(["recruitment.confirm"]);
    await submitted("ari");
    await passAndOffer("ari");
    await applying().respondOffer({ uid: "ari" }, { recruitmentId, accept: true });
    expect(
      await decisions().approve(...as(confirmer))({ id: appId("ari"), version: version("ari") }),
    ).toMatchObject({ ok: true, data: { status: "approved" } });
    expect(seats("finance")).toBe(1);
  });

  it("the queue lists submitted applications; drafts stay private", async () => {
    await submitted("ari");
    clock = new Date("2026-11-10T06:00:00Z");
    await submitted("budi", ["media"]);
    await applying().saveDraft({ uid: "cici" }, { recruitmentId, choices: [], answers: {} });
    await applying().saveDraft({ uid: "eko" }, { recruitmentId, choices: [], answers: {} });
    await applying().withdraw({ uid: "eko" }, { recruitmentId });
    const store = createSqlApplicationStore(db());
    expect((await store.listForRecruitment(recruitmentId)).map((a) => a.userId)).toEqual([
      "eko",
      "ari",
      "budi",
    ]);
    expect(
      await applying().respondOffer({ uid: "nobody" }, { recruitmentId, accept: true }),
    ).toEqual({ ok: false, error: "locked" });
    expect(await store.get("a/b")).toBeNull();
    expect(await store.get("missing")).toBeNull();
    expect(await applying().respondOffer(null, { recruitmentId, accept: true })).toEqual({
      ok: false,
      error: "signin",
    });
    expect(
      await applying().respondOffer({ uid: "zed" }, { recruitmentId: "missing", accept: true }),
    ).toEqual({ ok: false, error: "closed" });
  });
});

describe("files of an application (recruitment.review)", () => {
  it("opens only the application's own portfolio or file answers", async () => {
    fake.docs.set(`applications/${recruitmentId}_ari`, {
      recruitmentId,
      userId: "ari",
      status: "submitted",
      choices: ["finance"],
      answers: {
        q_cv: {
          path: "forms/form1/ari_1.pdf",
          name: "cv.pdf",
          contentType: "application/pdf",
          size: 9,
        },
        q_why: "text",
      },
      portfolio: {
        path: "recruitment/r/ari/p.pdf",
        name: "p.pdf",
        contentType: "application/pdf",
        size: 9,
      },
      revisionRound: 0,
      offer: null,
      submittedAt: clock,
      version: 1,
      createdAt: clock,
      updatedAt: clock,
    });
    const open = (principal: Principal, path: string) =>
      decisions().fileUrl(...as(principal))({ id: appId("ari"), path });
    expect(await open(offerer, "recruitment/r/ari/p.pdf")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await open(reviewer, "recruitment/r/ari/p.pdf")).toEqual({
      ok: true,
      data: { url: "https://signed.test/recruitment/r/ari/p.pdf" },
    });
    expect(await open(reviewer, "forms/form1/ari_1.pdf")).toMatchObject({ ok: true });
    expect(await open(reviewer, "forms/form1/budi_1.pdf")).toMatchObject({ error: "refused" });
    expect(await decisions().fileUrl(...as(reviewer))({ id: "missing", path: "x" })).toMatchObject({
      error: "refused",
    });
  });
});
