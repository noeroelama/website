import { describe, expect, it } from "vitest";
import {
  approveProgram,
  assertCanCheckIn,
  BudgetsSchema,
  cancelProgram,
  checkinId,
  completeMilestone,
  finishProgram,
  formatMoney,
  HealthInputSchema,
  ProgramInputSchema,
  progressPercent,
  removeMilestone,
  returnProgram,
  setHealth,
  startProgram,
  upsertMilestone,
  weekStartUtc,
  type Program,
} from "@website/domain/programs";

const now = new Date("2026-11-04T03:00:00Z");
const program = (extra: Partial<Program> = {}): Program => ({
  id: "pr1",
  periodId: "p1",
  orgUnitId: "media",
  orgUnitPath: ["media"],
  objectiveId: null,
  keyResultId: null,
  name: "Webinar series",
  goal: "",
  description: "",
  plannedStart: null,
  plannedEnd: null,
  budgets: [],
  pics: ["pic"],
  status: "proposed",
  progressPercent: 0,
  milestones: [],
  health: null,
  reviewNote: null,
  approvedBy: null,
  approvedAt: null,
  startedAt: null,
  finishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdBy: "dir",
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});
const milestone = (title: string, weight: number, sort = 0) => ({
  title,
  weight,
  sort,
  dueOn: null,
});

describe("progress from weighted milestones (E2)", () => {
  it("none = 0, not 100; weights, not counts", () => {
    expect(progressPercent([])).toBe(0);
    let p = upsertMilestone(program(), "a", milestone("Committee", 1));
    p = upsertMilestone(p, "b", milestone("Hold the event", 3));
    expect(p.progressPercent).toBe(0);
    p = completeMilestone(p, "a", true, "pic", now);
    expect(p.progressPercent).toBe(25);
    p = completeMilestone(p, "b", true, "pic", now);
    expect(p.progressPercent).toBe(100);
  });

  it("is recomputed when a weight changes, a milestone is removed or opened again", () => {
    let p = upsertMilestone(program(), "a", milestone("Committee", 1));
    p = upsertMilestone(p, "b", milestone("Hold the event", 3));
    p = completeMilestone(p, "a", true, "pic", now);
    p = upsertMilestone(p, "a", milestone("Committee", 3));
    expect(p.progressPercent).toBe(50);
    expect(p.milestones.find((m) => m.id === "a")?.completedAt).toEqual(now);
    p = completeMilestone(p, "a", true, "other", new Date(0));
    expect(p.milestones.find((m) => m.id === "a")).toMatchObject({
      completedAt: now,
      completedBy: "pic",
    });
    p = removeMilestone(p, "b");
    expect(p.progressPercent).toBe(100);
    p = completeMilestone(p, "a", false, "pic", now);
    expect(p.progressPercent).toBe(0);
    expect(() => removeMilestone(p, "zz")).toThrow("does not exist");
  });

  it("keeps milestones in order (sort, then due date, undated last)", () => {
    let p = upsertMilestone(program(), "c", { ...milestone("C", 1, 1), dueOn: null });
    p = upsertMilestone(p, "b", { ...milestone("B", 1, 1), dueOn: "2026-12-01" });
    p = upsertMilestone(p, "a", milestone("A", 1, 0));
    p = upsertMilestone(p, "d", { ...milestone("D", 1, 1), dueOn: "2026-11-01" });
    expect(p.milestones.map((m) => m.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("at most 50 milestones; closed programmes never change", () => {
    let p = program();
    for (let i = 0; i < 50; i += 1) p = upsertMilestone(p, `m${i}`, milestone("M", 1));
    expect(() => upsertMilestone(p, "m51", milestone("M", 1))).toThrow("At most 50");
    const closed = program({ status: "finished", milestones: p.milestones });
    expect(() => upsertMilestone(closed, "m0", milestone("M", 2))).toThrow("closed");
    expect(() => completeMilestone(closed, "m0", true, "pic", now)).toThrow("closed");
    expect(() => removeMilestone(program({ status: "cancelled" }), "m0")).toThrow("closed");
  });
});

describe("status machine", () => {
  it("proposed → approved (needs a PIC) → running (needs a milestone) → finished", () => {
    expect(() => approveProgram(program({ pics: [] }), "boss", now)).toThrow("PIC");
    const approved = approveProgram(program({ reviewNote: "fix" }), "boss", now);
    expect(approved).toMatchObject({ status: "approved", approvedBy: "boss", reviewNote: null });
    expect(() => approveProgram(approved, "boss", now)).toThrow("Only proposals");
    expect(() => startProgram(approved, now)).toThrow("milestone");
    expect(() => startProgram(program(), now)).toThrow("Approve");
    const running = startProgram(upsertMilestone(approved, "a", milestone("A", 1)), now);
    expect(running).toMatchObject({ status: "running", startedAt: now });
    expect(startProgram({ ...running, status: "approved" }, new Date(0)).startedAt).toEqual(now);
    expect(() => finishProgram(approved, now)).toThrow("Only running");
    expect(finishProgram(running, now)).toMatchObject({ status: "finished", finishedAt: now });
  });

  it("return withdraws the approval and needs a note; cancel needs a reason", () => {
    const approved = approveProgram(program(), "boss", now);
    expect(() => returnProgram(approved, "  ")).toThrow("Say what");
    expect(returnProgram(approved, " Add the budget ")).toMatchObject({
      status: "proposed",
      reviewNote: "Add the budget",
      approvedBy: null,
      approvedAt: null,
    });
    expect(() => returnProgram(program({ status: "running" }), "x")).toThrow("Only proposals");
    expect(() => cancelProgram(approved, " ", now)).toThrow("reason");
    expect(cancelProgram(approved, "No venue", now)).toMatchObject({
      status: "cancelled",
      cancelReason: "No venue",
      cancelledAt: now,
    });
    expect(() => cancelProgram(program({ status: "finished" }), "x", now)).toThrow(
      "finished programme",
    );
  });
});

describe("health always has a reason", () => {
  it("is refused without a reason, also for on track", () => {
    expect(HealthInputSchema.safeParse({ health: "on_track", reason: "" }).success).toBe(false);
    const p = program({ status: "running" });
    expect(() => setHealth(p, "on_track", "   ", "pic", now)).toThrow("Say why");
    expect(setHealth(p, "at_risk", " Venue unsure ", "pic", now).health).toEqual({
      status: "at_risk",
      reason: "Venue unsure",
      at: now,
      by: "pic",
    });
    expect(() => setHealth(program(), "on_track", "ok", "pic", now)).toThrow("approved or running");
  });
});

describe("weekly check-in (E3)", () => {
  it("weeks start on Monday 00:00 UTC, whatever the local day", () => {
    expect(weekStartUtc(new Date("2026-11-04T03:00:00Z"))).toBe("2026-11-02"); // Wednesday
    expect(weekStartUtc(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02"); // Monday
    // Sunday 23:30 UTC is already Monday in Tokyo, but still last week for everyone.
    expect(weekStartUtc(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-02");
    expect(weekStartUtc(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    expect(checkinId("pr1", "2026-11-02")).toBe("pr1_2026-11-02");
  });

  it("only approved or running programmes check in", () => {
    expect(() => assertCanCheckIn({ status: "proposed" })).toThrow("approved or running");
    expect(() => assertCanCheckIn({ status: "approved" })).not.toThrow();
  });
});

describe("money display", () => {
  it("shows major units with the currency's own decimals, never converted", () => {
    expect(formatMoney({ amountMinor: 50000, currency: "JPY" })).toBe("JPY 50,000");
    expect(formatMoney({ amountMinor: 1250, currency: "AUD" })).toBe("AUD 12.50");
  });
});

describe("plan input", () => {
  const plan = { name: "Webinar series", orgUnitId: "media" };
  it("one budget line per currency, never mixed", () => {
    expect(
      BudgetsSchema.safeParse([
        { amountMinor: 100, currency: "JPY" },
        { amountMinor: 5, currency: "JPY" },
      ]).success,
    ).toBe(false);
    expect(BudgetsSchema.safeParse([{ amountMinor: 1.5, currency: "JPY" }]).success).toBe(false);
    expect(ProgramInputSchema.parse(plan).budgets).toEqual([]);
  });
  it("a key result comes with its objective; the end is not before the start", () => {
    expect(ProgramInputSchema.safeParse({ ...plan, objectiveId: "o1" }).success).toBe(false);
    expect(
      ProgramInputSchema.safeParse({
        ...plan,
        plannedStart: "2026-12-01",
        plannedEnd: "2026-11-01",
      }).success,
    ).toBe(false);
  });
});
