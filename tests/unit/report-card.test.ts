import { describe, expect, it } from "vitest";
import {
  budgetAbsorption,
  completionPercent,
  okrAchievement,
  periodReportCard,
} from "@website/domain/programs";

const jpy = (amountMinor: number) => ({ amountMinor, currency: "JPY" });
const idr = (amountMinor: number) => ({ amountMinor, currency: "IDR" });
const counts = (c: Partial<Record<string, number>>) => ({
  proposed: 0,
  approved: 0,
  running: 0,
  finished: 0,
  cancelled: 0,
  ...c,
});

describe("period report card (E5)", () => {
  it("totals per currency are never mixed or converted", () => {
    const rows = budgetAbsorption(
      [[jpy(50000), idr(1_000_000)], [jpy(30000)], []],
      [[jpy(40000)], [{ amountMinor: 999, currency: "AUD" }]],
    );
    expect(rows).toEqual([
      {
        currency: "AUD",
        planned: { amountMinor: 0, currency: "AUD" },
        realized: { amountMinor: 999, currency: "AUD" },
        absorptionPercent: null,
      },
      {
        currency: "IDR",
        planned: idr(1_000_000),
        realized: idr(0),
        absorptionPercent: 0,
      },
      { currency: "JPY", planned: jpy(80000), realized: jpy(40000), absorptionPercent: 50 },
    ]);
    for (const row of rows) {
      expect(row.planned.currency).toBe(row.currency);
      expect(row.realized.currency).toBe(row.currency);
    }
    expect(budgetAbsorption([], [])).toEqual([]);
  });

  it("completion counts only programmes that were approved", () => {
    expect(completionPercent(counts({}))).toBe(0);
    expect(completionPercent(counts({ proposed: 9, cancelled: 3, running: 1, finished: 3 }))).toBe(
      75,
    );
  });

  it("OKR achievement averages the objectives", () => {
    expect(okrAchievement([])).toBe(0);
    const kr = (current: number) => ({
      id: "k",
      title: "K",
      unit: "",
      baseline: 0,
      target: 10,
      current,
      direction: "up" as const,
      sort: 0,
      measuredAt: null,
    });
    expect(okrAchievement([{ keyResults: [kr(10)] }, { keyResults: [kr(0)] }])).toBe(50);
  });

  it("builds the whole card from counts and documents", () => {
    const card = periodReportCard({
      objectives: [],
      counts: counts({ proposed: 1, finished: 2 }),
      troubled: 1,
      plannedBudgets: [[jpy(10)]],
      realized: [[jpy(5)]],
      lpj: { submitted: 1, approved: 1, overdue: 0 },
    });
    expect(card.programmes).toEqual({
      counts: counts({ proposed: 1, finished: 2 }),
      total: 3,
      troubled: 1,
      completionPercent: 100,
    });
    expect(card.budget[0]?.absorptionPercent).toBe(50);
  });
});
