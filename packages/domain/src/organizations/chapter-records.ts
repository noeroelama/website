import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";

export type Quarter = string;
export const QuarterSchema = z.string().regex(/^\d{4}Q[1-4]$/, "Choose the quarter.");

export const REPORTS_FROM: Quarter = "2026Q3";

export const quarterOf = (day: string): Quarter =>
  `${day.slice(0, 4)}Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

export function shiftQuarter(quarter: Quarter, n: number): Quarter {
  const index = Number(quarter.slice(0, 4)) * 4 + Number(quarter.slice(5)) - 1 + n;
  return `${Math.floor(index / 4)}Q${(index % 4) + 1}`;
}

export function assertQuarterStarted(quarter: Quarter, today: string) {
  if (quarter > quarterOf(today)) {
    throw new RuleViolationError("This quarter has not started yet.");
  }
}

export const ChapterReportInputSchema = z
  .object({
    chapterId: safeId,
    quarter: QuarterSchema,
    activeMembers: z.number().int().min(0).max(100_000),
    activities: z.array(safeText(200).pipe(z.string().min(1))).max(30),
    obstacles: safeText(2000, { multiline: true, allowEmpty: true }),
  })
  .strict();
export type ChapterReportInput = z.infer<typeof ChapterReportInputSchema>;

export interface ChapterReport extends ChapterReportInput {
  readonly id: string;
  readonly submittedBy: string;
  readonly submittedAt: Date;
  readonly filledByCentre: boolean;
}

export const chapterReportId = (chapterId: string, quarter: Quarter) => `${chapterId}_${quarter}`;

export type ChapterSignal = "active" | "needs_checking" | "at_risk";
export const CHAPTER_SIGNAL_LABELS: Record<ChapterSignal, string> = {
  active: "Active",
  needs_checking: "Needs checking",
  at_risk: "At risk of vacancy",
};

export function chapterSignal(
  active: boolean,
  reported: ReadonlySet<Quarter>,
  today: string,
): { signal: ChapterSignal; reason: string } | null {
  if (!active) return null;
  const missed: Quarter[] = [];
  for (let q = shiftQuarter(quarterOf(today), -1); q >= REPORTS_FROM && !reported.has(q);) {
    missed.unshift(q);
    q = shiftQuarter(q, -1);
  }
  if (missed.length === 0) return { signal: "active", reason: "Reports are up to date." };
  return {
    signal: missed.length === 1 ? "needs_checking" : "at_risk",
    reason: `No report for ${missed.join(", ")}.`,
  };
}

export const ChapterOfficerSchema = z
  .object({
    name: safeText(120).pipe(z.string().min(2, "Name the officer.")),
    title: safeText(120).pipe(z.string().min(2, "Give the position.")),
    termEnd: z.iso.date().nullable(),
  })
  .strict();
export type ChapterOfficer = z.infer<typeof ChapterOfficerSchema>;

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function officerWarning(officer: ChapterOfficer, today: string): string | null {
  if (officer.termEnd === null) return "Term end unknown";
  if (officer.termEnd < today) return `Term ended ${officer.termEnd}`;
  return officer.termEnd <= addDays(today, 60) ? `Term ends ${officer.termEnd}` : null;
}
