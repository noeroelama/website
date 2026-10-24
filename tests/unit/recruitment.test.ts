import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  applicationId,
  assertTransition,
  canTransition,
  checkChoices,
  formFilePath,
  isFinal,
  isPdf,
  isRecruitmentOpen,
  nextAction,
  offerExpired,
  portfolioPath,
  portfolioRequired,
  RecruitmentInputSchema,
  seatCounterId,
  TRANSITIONS,
} from "@website/domain/recruitment";

const now = new Date("2026-11-10T12:00:00Z");
const window = {
  published: true,
  deletedAt: null,
  opensAt: new Date("2026-11-01T00:00:00Z"),
  closesAt: new Date("2026-11-20T00:00:00Z"),
};
const units = [
  { orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: true },
  { orgUnitId: "finance", name: "Finance", quota: 1, portfolioRequired: false },
  { orgUnitId: "edu", name: "Education", quota: 3, portfolioRequired: false },
];
const input = {
  periodId: "p2026",
  title: "Oprec 2026",
  description: "",
  opensAt: "2026-11-01T00:00:00Z",
  closesAt: "2026-11-20T00:00:00Z",
  maxChoices: 2,
  offerDays: 3,
  formId: "form-1",
  units: [{ orgUnitId: "media", quota: 2, portfolioRequired: true }],
};

describe("recruitment set-up (C3)", () => {
  it("validates window, choices, units and offer validity", () => {
    expect(RecruitmentInputSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { closesAt: "2026-10-01T00:00:00Z" },
      { maxChoices: 0 },
      { maxChoices: 6 },
      { offerDays: 0 },
      { units: [] },
      { units: [input.units[0], input.units[0]] },
      { units: [{ orgUnitId: "media", quota: 0, portfolioRequired: false }] },
      { formId: "a/b" },
      { title: "ab" },
      { extra: true },
    ]) {
      expect(
        RecruitmentInputSchema.safeParse({ ...input, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("is open only when published, not deleted and inside the window", () => {
    expect(isRecruitmentOpen(window, now)).toBe(true);
    expect(isRecruitmentOpen({ ...window, published: false }, now)).toBe(false);
    expect(isRecruitmentOpen({ ...window, deletedAt: now }, now)).toBe(false);
    expect(isRecruitmentOpen(window, window.closesAt)).toBe(false);
    expect(isRecruitmentOpen(window, window.opensAt)).toBe(true);
    expect(isRecruitmentOpen(window, new Date("2026-10-31T23:59:59Z"))).toBe(false);
  });

  it("names applications and seat counters deterministically", () => {
    expect(applicationId("rec1", "uid9")).toBe("rec1_uid9");
    expect(seatCounterId("rec1", "media")).toBe("rec1_media");
  });
});

describe("application status machine (C3)", () => {
  it("has a rule for every status, and the ends lead nowhere", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...APPLICATION_STATUSES].sort());
    for (const status of [
      "admin_rejected",
      "declined",
      "confirmed",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(isFinal(status), status).toBe(true);
    }
    expect(isFinal("submitted")).toBe(false);
  });

  it("follows the C3 workflow", () => {
    const path = [
      ["draft", "submitted"],
      ["submitted", "revision"],
      ["revision", "submitted"],
      ["submitted", "interview"],
      ["interview", "offered"],
      ["offered", "accepted"],
      ["accepted", "approved"],
      ["approved", "pakta_review"],
      ["pakta_review", "approved"],
      ["pakta_review", "confirmed"],
    ] as const;
    for (const [from, to] of path) expect(canTransition(from, to), `${from}→${to}`).toBe(true);
    expect(canTransition("submitted", "offered")).toBe(false);
    expect(canTransition("draft", "interview")).toBe(false);
    expect(canTransition("confirmed", "withdrawn")).toBe(false);
    expect(() => assertTransition("submitted", "confirmed")).toThrow(/cannot move/);
    expect(() => assertTransition("submitted", "interview")).not.toThrow();
  });
});

describe("applying (C3 steps 1-2)", () => {
  const rec = { maxChoices: 2, units };

  it("takes 1..N distinct ordered choices from the recruitment's units", () => {
    expect(checkChoices(rec, ["finance", "media"])).toEqual(["finance", "media"]);
    expect(() => checkChoices(rec, [])).toThrow(/at least one/);
    expect(() => checkChoices(rec, "media")).toThrow(/at least one/);
    expect(() => checkChoices(rec, ["media", "finance", "edu"])).toThrow(/at most 2/);
    expect(() => checkChoices(rec, ["media", "media"])).toThrow(/once/);
    expect(() => checkChoices(rec, ["sports"])).toThrow(/units of this recruitment/);
  });

  it("asks for a portfolio only when a chosen unit is flagged", () => {
    expect(portfolioRequired(rec, ["finance", "edu"])).toBe(false);
    expect(portfolioRequired(rec, ["finance", "media"])).toBe(true);
    expect(portfolioPath("rec1", "uid9", now, "abcdef12-0000")).toBe(
      `recruitment/rec1/uid9/portfolio_${now.getTime()}_abcdef12.pdf`,
    );
    expect(formFilePath("form1", "uid9", now, "abcdef12-0000")).toBe(
      `forms/form1/uid9_${now.getTime()}_abcdef12.pdf`,
    );
    expect(isPdf(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(isPdf(new TextEncoder().encode("%PDF"))).toBe(false);
  });

  it("shows ONE next action per state", () => {
    const offer = { orgUnitId: "media", expiresAt: new Date("2026-11-11T00:00:00Z") };
    const at = (status: (typeof APPLICATION_STATUSES)[number]) =>
      nextAction(window, { status, offer: status === "offered" ? offer : null }, now);
    expect(nextAction(window, null, now)).toBe("start");
    expect(nextAction({ ...window, published: false }, null, now)).toBe("closed");
    expect(at("draft")).toBe("complete");
    expect(at("revision")).toBe("revise");
    expect(at("submitted")).toBe("wait_review");
    expect(at("interview")).toBe("interview");
    expect(at("offered")).toBe("respond_offer");
    expect(at("accepted")).toBe("wait_approval");
    expect(at("approved")).toBe("upload_pact");
    expect(at("pakta_review")).toBe("wait_ratification");
    expect(at("confirmed")).toBe("welcome");
    for (const s of ["admin_rejected", "declined", "rejected", "withdrawn"] as const) {
      expect(at(s)).toBe("ended");
    }
    // After the window a draft or a revision can no longer be sent.
    const after = new Date("2026-11-21T00:00:00Z");
    expect(nextAction(window, { status: "draft", offer: null }, after)).toBe("closed");
    expect(nextAction(window, { status: "revision", offer: null }, after)).toBe("closed");
    // An expired offer ends at read time (no job).
    expect(offerExpired(offer, offer.expiresAt)).toBe(true);
    expect(offerExpired(offer, now)).toBe(false);
    expect(offerExpired(null, now)).toBe(false);
    expect(nextAction(window, { status: "offered", offer }, new Date("2026-11-12T00:00:00Z"))).toBe(
      "ended",
    );
  });
});
