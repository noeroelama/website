import { describe, expect, it } from "vitest";
import {
  assertQuarterStarted,
  chapterSignal,
  officerWarning,
  quarterOf,
  shiftQuarter,
} from "@website/domain/organizations";

describe("chapter records (H1-H3)", () => {
  it("quarter maths across the year boundary", () => {
    expect(quarterOf("2026-01-01")).toBe("2026Q1");
    expect(quarterOf("2026-09-30")).toBe("2026Q3");
    expect(quarterOf("2026-10-01")).toBe("2026Q4");
    expect(shiftQuarter("2026Q4", 1)).toBe("2027Q1");
    expect(shiftQuarter("2027Q1", -1)).toBe("2026Q4");
    expect(shiftQuarter("2026Q2", -6)).toBe("2024Q4");
  });

  it("refuses a quarter that has not started", () => {
    expect(() => assertQuarterStarted("2026Q4", "2026-11-07")).not.toThrow();
    expect(() => assertQuarterStarted("2027Q1", "2026-12-31")).toThrow("not started");
  });

  it("risk signal: from Q3 2026 only, consecutive misses, inactive not rated", () => {
    expect(chapterSignal(true, new Set(), "2026-09-01")).toMatchObject({ signal: "active" });
    expect(chapterSignal(true, new Set(), "2026-11-07")).toEqual({
      signal: "needs_checking",
      reason: "No report for 2026Q3.",
    });
    expect(chapterSignal(true, new Set(["2026Q3"]), "2026-11-07")).toMatchObject({
      signal: "active",
    });
    expect(chapterSignal(true, new Set(), "2027-01-15")).toEqual({
      signal: "at_risk",
      reason: "No report for 2026Q3, 2026Q4.",
    });
    expect(chapterSignal(true, new Set(["2026Q3"]), "2027-04-02")).toMatchObject({
      signal: "at_risk",
      reason: "No report for 2026Q4, 2027Q1.",
    });
    expect(chapterSignal(true, new Set(["2026Q4"]), "2027-01-15")).toMatchObject({
      signal: "active",
    });
    expect(chapterSignal(false, new Set(), "2027-01-15")).toBeNull();
  });

  it("officer terms: warning 60 days before the end; no end date is unknown, not expired", () => {
    const officer = (termEnd: string | null) => ({ name: "Rina", title: "Ketua", termEnd });
    expect(officerWarning(officer(null), "2026-11-07")).toBe("Term end unknown");
    expect(officerWarning(officer("2026-11-01"), "2026-11-07")).toBe("Term ended 2026-11-01");
    expect(officerWarning(officer("2027-01-06"), "2026-11-07")).toBe("Term ends 2027-01-06");
    expect(officerWarning(officer("2027-01-07"), "2026-11-07")).toBeNull();
  });
});
