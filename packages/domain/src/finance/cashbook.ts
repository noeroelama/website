import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";
import { FINANCE_CURRENCIES, type FinanceFile, type FinanceRequest } from "./requests";

/**
 * Cash book (I2) and cash report (I3), ported from PPIDK `BukuKasService`. Money gets into the
 * book two ways only: a request marked paid (`cashEntries/{requestId}`, written in the same
 * transaction, at most one per request; budget requests move no money and write nothing) or a
 * manual treasurer entry (opening balance, dues, donations, bank interest, petty cash). Entries
 * from requests are never edited here: the request is their source of truth.
 */
export const CASH_KINDS = ["in", "out"] as const;
export type CashKind = (typeof CASH_KINDS)[number];

export const CASH_CATEGORIES = {
  in: ["opening_balance", "dues", "donation", "receipt", "interest", "other_in"],
  out: ["activity", "operational", "reimbursement", "disbursement", "other_out"],
} as const satisfies Record<CashKind, readonly string[]>;
export type CashCategory = (typeof CASH_CATEGORIES)[CashKind][number];
export const ALL_CASH_CATEGORIES: readonly CashCategory[] = [
  ...CASH_CATEGORIES.in,
  ...CASH_CATEGORIES.out,
];

/** Printed names (PPIDK `KATEGORI_MASUK` / `KATEGORI_KELUAR`). */
export const CASH_CATEGORY_LABELS: Readonly<Record<CashCategory, string>> = {
  opening_balance: "Opening balance",
  dues: "Member dues",
  donation: "Donation / sponsor",
  receipt: "Receipt of funds",
  interest: "Bank interest",
  other_in: "Other income",
  activity: "Activity / programme",
  operational: "Operational",
  reimbursement: "Reimbursement",
  disbursement: "Disbursement",
  other_out: "Other spending",
};

/** Manual entry (finance.cashbook). */
export const CashEntryInputSchema = z
  .object({
    date: z.iso.date(),
    kind: z.enum(CASH_KINDS),
    category: z.enum(ALL_CASH_CATEGORIES as [CashCategory, ...CashCategory[]]),
    description: safeText(200),
    amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(FINANCE_CURRENCIES),
    orgUnitId: safeId.nullable().default(null),
  })
  .strict()
  .refine((entry) => (CASH_CATEGORIES[entry.kind] as readonly string[]).includes(entry.category), {
    message: "This category does not belong to that kind of entry.",
    path: ["category"],
  });
export type CashEntryInput = z.infer<typeof CashEntryInputSchema>;

export interface CashEntry extends CashEntryInput {
  readonly id: string;
  readonly periodId: string;
  readonly source: "request" | "manual";
  readonly requestId: string | null;
  readonly proof: FinanceFile | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Request category → cash book line; budget is a plan, not a money movement. */
const FROM_REQUEST = {
  receipt: { kind: "in", category: "receipt" },
  disbursement: { kind: "out", category: "disbursement" },
  reimbursement: { kind: "out", category: "reimbursement" },
  budget: null,
} as const;

/**
 * The line a paid request writes (id = request id), or null for budget requests. The amount is
 * what was actually paid; the date is the payment day (UTC).
 */
export function cashEntryFromRequest(request: FinanceRequest): CashEntry | null {
  const line = FROM_REQUEST[request.category];
  const payment = request.payment;
  if (!line || !payment) return null;
  return {
    id: request.id,
    periodId: request.periodId,
    orgUnitId: request.orgUnitId,
    date: payment.at.toISOString().slice(0, 10),
    kind: line.kind,
    category: line.category,
    description: request.title,
    amountMinor: payment.amountMinor,
    currency: request.currency,
    source: "request",
    requestId: request.id,
    proof: payment.proof,
    createdBy: payment.uid,
    createdAt: payment.at,
  };
}

export const ReportRangeSchema = z
  .object({ from: z.iso.date().nullable(), to: z.iso.date().nullable() })
  .strict()
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  });
export type ReportRange = z.infer<typeof ReportRangeSchema>;

export interface CurrencyReport {
  readonly currency: string;
  /** Everything before `from`: the range continues from the real balance, not from zero. */
  readonly opening: number;
  readonly totalIn: number;
  readonly totalOut: number;
  readonly closing: number;
  readonly inByCategory: Readonly<Partial<Record<CashCategory, number>>>;
  readonly outByCategory: Readonly<Partial<Record<CashCategory, number>>>;
  readonly rows: readonly { readonly entry: CashEntry; readonly balance: number }[];
}

const delta = (e: CashEntry) => (e.kind === "in" ? e.amountMinor : -e.amountMinor);
const safe = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new RuleViolationError("The total is too large.");
  return n;
};

/**
 * The report for a date range (both ends inclusive, either may be open), recomputed from the
 * entries, one section per currency (never added together), rows by date then creation.
 */
export function cashReport(entries: readonly CashEntry[], range: ReportRange): CurrencyReport[] {
  const currencies = [...new Set(entries.map((e) => e.currency))].sort();
  return currencies.map((currency) => {
    const mine = entries
      .filter((e) => e.currency === currency)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    const before = mine.filter((e) => range.from && e.date < range.from);
    const inside = mine.filter(
      (e) => (!range.from || e.date >= range.from) && (!range.to || e.date <= range.to),
    );
    const opening = safe(before.reduce((sum, e) => sum + delta(e), 0));
    let balance = opening;
    const inByCategory: Partial<Record<CashCategory, number>> = {};
    const outByCategory: Partial<Record<CashCategory, number>> = {};
    const rows = inside.map((entry) => {
      balance = safe(balance + delta(entry));
      const totals = entry.kind === "in" ? inByCategory : outByCategory;
      totals[entry.category] = (totals[entry.category] ?? 0) + entry.amountMinor;
      return { entry, balance };
    });
    const sum = (kind: CashKind) =>
      safe(inside.filter((e) => e.kind === kind).reduce((n, e) => n + e.amountMinor, 0));
    return {
      currency,
      opening,
      totalIn: sum("in"),
      totalOut: sum("out"),
      closing: balance,
      inByCategory,
      outByCategory,
      rows,
    };
  });
}
