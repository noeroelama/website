import { addMoney, money, type Money } from "../shared";
import { objectivePercent, type Objective } from "./okr";
import { PROGRAM_STATUSES, type ProgramStatus } from "./programs";

/**
 * Period report card (E5), ported from PPIDK `RaporPeriode`: computed on request, nothing
 * stored (a stored report must be kept up to date, and the one nobody updated is the one read
 * at the evaluation meeting). Budgets are totalled per currency and never converted.
 */

/** Planned vs spent in one currency; absorption is null when nothing was planned in it. */
export interface BudgetRow {
  readonly currency: string;
  readonly planned: Money;
  readonly realized: Money;
  readonly absorptionPercent: number | null;
}

/**
 * Per-currency totals. `planned`: the budget lines of programmes that were approved (not
 * proposals, not cancelled); `realized`: money spent from APPROVED LPJs only (the treasurer has
 * checked those). `addMoney` refuses to add two currencies, so a total can never mix them.
 */
export function budgetAbsorption(
  planned: ReadonlyArray<readonly Money[]>,
  realized: ReadonlyArray<readonly Money[]>,
): BudgetRow[] {
  const total = (lines: ReadonlyArray<readonly Money[]>) => {
    const sums = new Map<string, Money>();
    for (const line of lines.flat()) {
      sums.set(line.currency, addMoney(sums.get(line.currency) ?? money(0, line.currency), line));
    }
    return sums;
  };
  const plan = total(planned);
  const spent = total(realized);
  return [...new Set([...plan.keys(), ...spent.keys()])].sort().map((currency) => {
    const p = plan.get(currency) ?? money(0, currency);
    const r = spent.get(currency) ?? money(0, currency);
    return {
      currency,
      planned: p,
      realized: r,
      absorptionPercent:
        p.amountMinor > 0 ? Math.round((r.amountMinor / p.amountMinor) * 100) : null,
    };
  });
}

/**
 * Finished ÷ programmes that were approved (approved, running, finished). Proposals and
 * cancelled ones are left out: a proposal never became a promise, and counting it punishes the
 * units that propose a lot. None = 0.
 */
export function completionPercent(counts: Readonly<Record<ProgramStatus, number>>): number {
  const promised = counts.approved + counts.running + counts.finished;
  return promised === 0 ? 0 : Math.round((counts.finished / promised) * 100);
}

/** Average achievement of the period's objectives (0 without any). */
export function okrAchievement(objectives: ReadonlyArray<Pick<Objective, "keyResults">>): number {
  if (objectives.length === 0) return 0;
  return Math.round(
    objectives.reduce((sum, o) => sum + objectivePercent(o), 0) / objectives.length,
  );
}

export interface PeriodReportCard {
  readonly okr: {
    readonly achievementPercent: number;
    readonly objectives: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
      readonly orgUnitId: string | null;
      readonly percent: number;
      readonly keyResults: number;
    }>;
  };
  readonly programmes: {
    readonly counts: Readonly<Record<ProgramStatus, number>>;
    readonly total: number;
    /** Approved or running with health at risk / off track. */
    readonly troubled: number;
    readonly completionPercent: number;
  };
  readonly budget: readonly BudgetRow[];
  readonly lpj: { readonly submitted: number; readonly approved: number; readonly overdue: number };
}

/** Builds the card from what the store counted and read. */
export function periodReportCard(input: {
  readonly objectives: readonly Objective[];
  readonly counts: Readonly<Record<ProgramStatus, number>>;
  readonly troubled: number;
  readonly plannedBudgets: ReadonlyArray<readonly Money[]>;
  readonly realized: ReadonlyArray<readonly Money[]>;
  readonly lpj: PeriodReportCard["lpj"];
}): PeriodReportCard {
  return {
    okr: {
      achievementPercent: okrAchievement(input.objectives),
      objectives: input.objectives.map((o) => ({
        id: o.id,
        title: o.title,
        orgUnitId: o.orgUnitId,
        percent: objectivePercent(o),
        keyResults: o.keyResults.length,
      })),
    },
    programmes: {
      counts: input.counts,
      total: PROGRAM_STATUSES.reduce((sum, s) => sum + input.counts[s], 0),
      troubled: input.troubled,
      completionPercent: completionPercent(input.counts),
    },
    budget: budgetAbsorption(input.plannedBudgets, input.realized),
    lpj: input.lpj,
  };
}
