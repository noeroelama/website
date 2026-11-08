import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  editLpj,
  extendLpjDue,
  isOverdue,
  missingLpjFields,
  openLpj,
  returnLpj,
  signLpj,
  submitLpj,
  type LpjReport,
  type Program,
} from "@website/domain/programs";

const now = new Date("2026-11-04T03:00:00Z");
const program = (extra: Partial<Program> = {}): Program => ({
  id: "pr1",
  periodId: "p1",
  orgUnitId: "media",
  orgUnitPath: ["dirs", "media"],
  objectiveId: null,
  keyResultId: null,
  name: "Webinar series",
  goal: "Share tips",
  description: "",
  plannedStart: "2026-10-01",
  plannedEnd: "2026-10-31",
  budgets: [{ amountMinor: 50000, currency: "JPY" }],
  pics: ["pic"],
  status: "finished",
  progressPercent: 75,
  milestones: [
    {
      id: "m1",
      title: "Committee",
      dueOn: null,
      weight: 1,
      sort: 0,
      completedAt: now,
      completedBy: "pic",
    },
    {
      id: "m2",
      title: "Recording",
      dueOn: null,
      weight: 1,
      sort: 1,
      completedAt: null,
      completedBy: null,
    },
  ],
  health: null,
  reviewNote: null,
  approvedBy: "boss",
  approvedAt: now,
  startedAt: now,
  finishedAt: now,
  cancelledAt: null,
  cancelReason: null,
  createdBy: "dir",
  version: 5,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});
const filled = {
  realization: "Held 3 webinars",
  obstacles: "Time zones",
  recommendations: "Record",
};
const lpj = (extra: Partial<LpjReport> = {}): LpjReport => ({
  ...openLpj(program(), "Direktorat Media", 14, now),
  id: "pr1",
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
const submitted = () =>
  submitLpj(lpj({ ...filled, realized: [{ amountMinor: 40000, currency: "JPY" }] }), "pic", now);

describe("opening the LPJ (E4)", () => {
  it("freezes the plan with the milestones' final state; due by the period policy", () => {
    const opened = lpj();
    expect(opened).toMatchObject({
      status: "draft",
      dueOn: "2026-11-18",
      pics: ["pic"],
      orgUnitPath: ["dirs", "media"],
      realized: null,
      revisionRound: 0,
    });
    expect(opened.plan).toMatchObject({
      name: "Webinar series",
      unitName: "Direktorat Media",
      progressPercent: 75,
      budgets: [{ amountMinor: 50000, currency: "JPY" }],
      milestones: [
        { title: "Committee", done: true, weight: 1, dueOn: null },
        { title: "Recording", done: false, weight: 1, dueOn: null },
      ],
      finishedAt: now,
    });
    expect(() => openLpj(program({ status: "running" }), "", 14, now)).toThrow("finished");
    expect(addDaysUtc(new Date("2026-12-25T23:00:00Z"), 14)).toBe("2027-01-08");
  });

  it("the snapshot is a copy: later programme changes do not reach it", () => {
    const source = program();
    const opened = openLpj(source, "Media", 14, now);
    (source.budgets as unknown as Array<{ amountMinor: number }>)[0]!.amountMinor = 1;
    (source.pics as string[]).push("someone");
    expect(opened.plan.budgets[0]?.amountMinor).toBe(50000);
    expect(opened.plan.pics).toEqual(["pic"]);
    expect(editLpj(lpj(), { ...filled, participantCount: 3, realized: [] }).plan).toEqual(
      lpj().plan,
    );
  });
});

describe("writing and submitting", () => {
  it("checks completeness at submit, not at save", () => {
    expect(missingLpjFields(lpj())).toEqual([
      "Realization",
      "Obstacles",
      "Recommendations",
      "Money spent",
    ]);
    expect(() => submitLpj(lpj(), "pic", now)).toThrow("Complete first");
    const sent = submitted();
    expect(sent).toMatchObject({ status: "submitted", submittedBy: "pic", submittedAt: now });
    expect(() => submitLpj(sent, "pic", now)).toThrow("already submitted");
    expect(() => editLpj(sent, { ...filled, participantCount: null, realized: [] })).toThrow(
      "submitted LPJ",
    );
  });
});

describe("separation of duties: three desks, three people, never the submitter", () => {
  it("reviews come in any order; approval needs both; then approved", () => {
    let report = signLpj(submitted(), "treasurer", "bendahara", now);
    expect(() => signLpj(report, "approval", "sekjen", now)).toThrow("Both reviews");
    report = signLpj(report, "secretariat", "sekre", now);
    expect(report.status).toBe("submitted");
    report = signLpj(report, "approval", "sekjen", now);
    expect(report).toMatchObject({ status: "approved", approval: { uid: "sekjen", at: now } });
    expect(() => signLpj(report, "approval", "other", now)).toThrow("Only a submitted");
  });

  it("refuses the submitter, a second desk for the same person and a desk signed twice", () => {
    expect(() => signLpj(submitted(), "secretariat", "pic", now)).toThrow("submitter");
    const once = signLpj(submitted(), "secretariat", "sekre", now);
    expect(() => signLpj(once, "treasurer", "sekre", now)).toThrow("two desks");
    expect(() => signLpj(once, "secretariat", "other", now)).toThrow("already signed");
    const both = signLpj(once, "treasurer", "bendahara", now);
    expect(() => signLpj(both, "approval", "bendahara", now)).toThrow("two desks");
    expect(() => signLpj(lpj(), "secretariat", "sekre", now)).toThrow("Only a submitted");
  });

  it("the treasurer refuses an LPJ without figures", () => {
    const blank = { ...submitted(), realized: null };
    expect(() => signLpj(blank, "treasurer", "bendahara", now)).toThrow("nothing to check");
  });
});

describe("return clears every desk", () => {
  it("needs a note, counts the round and clears all signatures", () => {
    const reviewed = signLpj(
      signLpj(submitted(), "secretariat", "sekre", now),
      "treasurer",
      "b",
      now,
    );
    expect(() => returnLpj(reviewed, " ")).toThrow("Say what");
    const back = returnLpj(reviewed, " Add receipts ");
    expect(back).toMatchObject({
      status: "returned",
      returnNote: "Add receipts",
      revisionRound: 1,
      secretariat: null,
      treasurer: null,
      approval: null,
    });
    expect(() => returnLpj(back, "again")).toThrow("Only a submitted");
    expect(
      submitLpj(editLpj(back, { ...filled, participantCount: 1, realized: [] }), "pic", now),
    ).toMatchObject({ status: "submitted", returnNote: null });
  });
});

describe("due date", () => {
  it("overdue is computed at read time; extendable until approved", () => {
    expect(isOverdue(lpj(), new Date("2026-11-18T23:59:00Z"))).toBe(false);
    expect(isOverdue(lpj(), new Date("2026-11-19T00:00:00Z"))).toBe(true);
    expect(isOverdue(lpj({ status: "approved" }), new Date("2027-01-01T00:00:00Z"))).toBe(false);
    expect(extendLpjDue(lpj(), "2026-12-01").dueOn).toBe("2026-12-01");
    expect(() => extendLpjDue(lpj({ status: "approved" }), "2026-12-01")).toThrow("approved");
  });
});
