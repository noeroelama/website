import { describe, expect, it } from "vitest";
import {
  cashEntryFromRequest,
  cashReport,
  CashEntryInputSchema,
  ReportRangeSchema,
  type CashEntry,
  type FinanceRequest,
} from "@website/domain/finance";

const at = new Date("2026-11-04T03:00:00Z");
let n = 0;
const entry = (fields: Partial<CashEntry>): CashEntry => ({
  id: `e${(n += 1)}`,
  periodId: "p1",
  orgUnitId: null,
  date: "2026-11-01",
  kind: "in",
  category: "dues",
  description: "Iuran",
  amountMinor: 100,
  currency: "IDR",
  source: "manual",
  requestId: null,
  proof: null,
  createdBy: "tina",
  createdAt: at,
  ...fields,
});

describe("cash book entries (I2)", () => {
  const paid = {
    id: "f1",
    periodId: "p1",
    orgUnitId: "media",
    category: "disbursement",
    title: "Webinar",
    currency: "JPY",
    payment: {
      uid: "tina",
      at,
      amountMinor: 5000,
      proof: { path: "p", name: "n", size: 1, sha256: "s" },
    },
  } as unknown as FinanceRequest;

  it("a paid request writes one line under its own id, with the amount actually paid", () => {
    expect(cashEntryFromRequest(paid)).toEqual({
      id: "f1",
      periodId: "p1",
      orgUnitId: "media",
      date: "2026-11-04",
      kind: "out",
      category: "disbursement",
      description: "Webinar",
      amountMinor: 5000,
      currency: "JPY",
      source: "request",
      requestId: "f1",
      proof: paid.payment?.proof,
      createdBy: "tina",
      createdAt: at,
    });
    expect(cashEntryFromRequest({ ...paid, category: "receipt" })).toMatchObject({
      kind: "in",
      category: "receipt",
    });
    expect(cashEntryFromRequest({ ...paid, category: "reimbursement" })).toMatchObject({
      kind: "out",
      category: "reimbursement",
    });
  });

  it("budget requests and unpaid requests write nothing", () => {
    expect(cashEntryFromRequest({ ...paid, category: "budget" })).toBeNull();
    expect(cashEntryFromRequest({ ...paid, payment: null })).toBeNull();
  });

  it("manual entries need a category of their kind and a positive amount", () => {
    const input = {
      date: "2026-11-01",
      kind: "in",
      category: "opening_balance",
      description: " Saldo awal ",
      amountMinor: 1,
      currency: "IDR",
    };
    expect(CashEntryInputSchema.parse(input)).toMatchObject({
      description: "Saldo awal",
      orgUnitId: null,
    });
    const ok = (patch: Record<string, unknown>) =>
      CashEntryInputSchema.safeParse({ ...input, ...patch }).success;
    expect(ok({ kind: "out" })).toBe(false);
    expect(ok({ kind: "out", category: "operational" })).toBe(true);
    expect(ok({ amountMinor: 0 })).toBe(false);
    expect(ok({ extra: true })).toBe(false);
  });
});

describe("cash report (I3)", () => {
  const entries = [
    entry({ date: "2026-10-30", amountMinor: 1000, category: "opening_balance" }),
    entry({ date: "2026-11-02", kind: "out", category: "operational", amountMinor: 300 }),
    entry({ date: "2026-11-01", amountMinor: 50, category: "interest" }),
    entry({ date: "2026-11-05", amountMinor: 999 }),
    entry({ date: "2026-11-01", currency: "JPY", amountMinor: 7000 }),
    entry({
      date: "2026-11-02",
      currency: "JPY",
      kind: "out",
      category: "activity",
      amountMinor: 2000,
    }),
  ];

  it("keeps one section per currency and never adds currencies together", () => {
    const report = cashReport(entries, { from: null, to: null });
    expect(report.map((r) => [r.currency, r.opening, r.totalIn, r.totalOut, r.closing])).toEqual([
      ["IDR", 0, 2049, 300, 1749],
      ["JPY", 0, 7000, 2000, 5000],
    ]);
  });

  it("filters by date range (both ends inclusive) and opens with the balance before it", () => {
    const [idr] = cashReport(entries, { from: "2026-11-01", to: "2026-11-02" });
    expect(idr).toMatchObject({
      currency: "IDR",
      opening: 1000,
      totalIn: 50,
      totalOut: 300,
      closing: 750,
      inByCategory: { interest: 50 },
      outByCategory: { operational: 300 },
    });
    expect(idr?.rows.map((r) => [r.entry.date, r.balance])).toEqual([
      ["2026-11-01", 1050],
      ["2026-11-02", 750],
    ]);
    const [later] = cashReport(entries, { from: "2026-11-03", to: null });
    expect(later).toMatchObject({ opening: 750, totalIn: 999, closing: 1749 });
    const [until] = cashReport(entries, { from: null, to: "2026-10-31" });
    expect(until).toMatchObject({ opening: 0, closing: 1000 });
    expect(cashReport([], { from: null, to: null })).toEqual([]);
  });

  it("orders same-day rows by creation, then id", () => {
    const early = entry({ id: "b", createdAt: new Date("2026-11-01T01:00:00Z") });
    const late = entry({ id: "a", createdAt: new Date("2026-11-01T02:00:00Z") });
    const tie = entry({ id: "c", createdAt: new Date("2026-11-01T02:00:00Z") });
    const [report] = cashReport([tie, late, early], { from: null, to: null });
    expect(report?.rows.map((r) => r.entry.id)).toEqual(["b", "a", "c"]);
  });

  it("refuses totals beyond safe integers and ranges that end before they start", () => {
    const huge = entry({ amountMinor: Number.MAX_SAFE_INTEGER });
    expect(() => cashReport([huge, huge], { from: null, to: null })).toThrow("too large");
    expect(ReportRangeSchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(
      false,
    );
    expect(ReportRangeSchema.safeParse({ from: "2026-11-01", to: null }).success).toBe(true);
  });
});
